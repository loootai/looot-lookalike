// Finds companies like your best customers. Seeds in, ranked list out. No UI, no database, no sign-in.
//   npm run lookalike -- --seeds seeds.txt --out results-out [--cap 1] [--dry-run]
//   npm run lookalike -- --domains a.com,b.com,c.com
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { FixtureRunner } from "@/demo/fixtureRunner";
import { DEMO_SEEDS } from "@/demo/fixtures";
import { Budget } from "@/lib/budget";
import { ConfigError, parseConfig } from "@/lib/config";
import { InputError, parseSeeds } from "@/lib/engine";
import { toCsv, toMarkdown } from "@/lib/export";
import { LoootError, loootFromEnv } from "@/lib/looot";
import { toMicros, usd, usdPrecise } from "@/lib/money";
import { planPipeline, runPipeline } from "@/lib/pipeline";
import { FALLBACK_PRICES, fetchPrices } from "@/lib/prices";
import { PRICES_AS_OF } from "@/lib/sources";

const HELP = `Usage: npm run lookalike -- (--seeds <file> | --domains <a,b,c>) [options]

  --seeds <file>     Text file with 3 to 20 domains, one per line or comma separated
  --domains <list>   The same, on the command line
  --weights <file>   Scoring weights and options (YAML). Default: weights.yaml, else weights.example.yaml
  --out <dir>        Where results go. Default: results-out
  --top <n>          Entries in the markdown report. Default: 25
  --cap <usd>        Most the whole run may spend. Default: 1.00
  --partial          Run until the cap or the period budget is reached, even when the quote is above what is left
  --dry-run          Print the calls and the list-price cost. Makes no call and writes nothing.
  --demo             Use the bundled sample companies. No token, no network.

Needs LOOOT_TOKEN in the environment, except with --dry-run or --demo.
The period budget (daily and monthly) lives in data/budget.json next to the web app's session file. LOOKALIKE_DAILY_USD and
LOOKALIKE_MONTHLY_USD set the starting amounts (default 10 and 50) until the owner saves new ones in the web UI.`;

function fail(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

async function main(): Promise<void> {
  let args;
  try {
    args = parseArgs({ options: { seeds: { type: "string" }, domains: { type: "string" }, weights: { type: "string" }, out: { type: "string", default: "results-out" }, top: { type: "string", default: "25" }, cap: { type: "string", default: "1" }, "dry-run": { type: "boolean", default: false }, demo: { type: "boolean", default: false }, partial: { type: "boolean", default: false }, help: { type: "boolean", default: false } } }).values;
  } catch (e) {
    fail(`${(e as Error).message}\n\n${HELP}`, 2);
  }
  if (args.help) return console.log(HELP);

  let seeds: string[];
  try {
    const raw = args.demo && !args.seeds && !args.domains ? DEMO_SEEDS.map((s) => s.domain).join(",") : args.domains ?? (args.seeds ? readFileSync(resolve(args.seeds), "utf8") : null);
    if (raw === null) fail(`Give --seeds or --domains.\n\n${HELP}`, 2);
    seeds = parseSeeds(raw);
  } catch (e) {
    if (e instanceof InputError) fail(e.message, 2);
    fail(`Cannot read the seeds: ${(e as Error).message}`, 2);
  }
  let cfg;
  try {
    const file = args.weights ?? (existsSync("weights.yaml") ? "weights.yaml" : "weights.example.yaml");
    cfg = parseConfig(readFileSync(resolve(file), "utf8"));
  } catch (e) {
    if (e instanceof ConfigError) fail(e.message, 2);
    fail(`Cannot read the weights file: ${(e as Error).message}`, 2);
  }
  const capMicros = toMicros(args.cap);
  if (capMicros <= 0) fail("--cap must be a positive dollar amount.", 2);
  const now = new Date();

  const print = (calls: ReturnType<typeof planPipeline>["calls"], total: number, note: string) => {
    console.log(`Calls this run (${note}):`);
    for (const c of calls) console.log(`  ${c.step.padEnd(8)} ${c.endpointId.padEnd(38)} ${usdPrecise(c.quotedMicros).padStart(9)}  ${c.label}`);
    console.log(`Total at most ${usdPrecise(total)} for ${calls.length} calls. Cap ${usd(capMicros)}.`);
    if (cfg.enrichTop > 0) console.log(`The ${cfg.enrichTop} "top-candidate" lines are the optional enrich step; their domains are only known after the search.`);
  };

  if (args["dry-run"]) {
    const plan = planPipeline(seeds, cfg, FALLBACK_PRICES, now);
    print(plan.calls, plan.totalMicros, `list prices dated ${PRICES_AS_OF}`);
    console.log("Dry run: no looot call was made and nothing was written.");
    return;
  }

  let looot;
  let prices = FALLBACK_PRICES;
  let unpriced: string[] = [];
  if (args.demo) looot = new FixtureRunner();
  else {
    try {
      looot = loootFromEnv();
    } catch (e) {
      if (e instanceof LoootError) fail("LOOOT_TOKEN is not set. Create an agent token at https://looot.ai/settings, or use --dry-run or --demo.", 2);
      throw e;
    }
    const priced = await fetchPrices();
    prices = priced.prices;
    unpriced = priced.unread;
  }
  const plan = planPipeline(seeds, cfg, prices, now);
  print(plan.calls, plan.totalMicros, args.demo ? "demo, no charge" : unpriced.length > 0 ? `live prices; unread: ${unpriced.join(", ")}` : "live prices from the looot catalog");

  // Check order: quote, per-run cap, period budget, then the calls. Runs that ended since last time settle first.
  const budget = args.demo ? undefined : new Budget();
  if (budget && "getRun" in looot) {
    await budget.reconcile(looot);
    const room = await budget.status();
    console.log(`Budget left: ${usd(room.remainingMicros)} (${usd(room.day.remainingMicros)} today, ${usd(room.month.remainingMicros)} this month, ${usd(room.day.reservedMicros)} reserved).`);
    if (plan.totalMicros > room.remainingMicros && !args.partial) fail("Refused: the quote is above what is left of the period budget. Wait for the period to roll over, raise the budget on the Costs page of the web UI, or pass --partial to run until it is reached.", 2);
  }

  let result;
  try {
    result = await runPipeline(seeds, cfg, { looot, prices, unpriced, capMicros, now, ledger: budget });
  } catch (e) {
    if (e instanceof InputError) fail(e.message, 1);
    throw e;
  }
  const { session, ranked } = result;
  const outDir = resolve(args.out);
  mkdirSync(outDir, { recursive: true });
  const stamp = now.toISOString().replace(/[-:]/g, "").slice(0, 15);
  const files = [
    [`lookalikes-${stamp}.json`, `${JSON.stringify({ seeds: session.seeds, traits: session.traits, spentMicros: session.spentMicros, ranked }, null, 1)}\n`],
    [`lookalikes-${stamp}.csv`, toCsv(ranked)],
    [`lookalikes-${stamp}.md`, toMarkdown(session, ranked, Number(args.top) || 25)],
  ] as const;
  for (const [name, text] of files) writeFileSync(join(outDir, name), text);

  console.log(`\n${ranked.length} ranked companies from ${session.candidates.length} candidates. Spent ${usd(session.spentMicros)} of ${usd(capMicros)}.`);
  ranked.slice(0, 5).forEach((s, i) => console.log(`  ${i + 1}. ${s.candidate.domain.padEnd(28)} ${String(s.score).padStart(5)}  coverage ${Math.round(s.coverage * 100)}%`));
  for (const c of session.calls.filter((c) => c.status !== "completed")) console.log(`  ${c.step} ${c.label}: ${c.status}${c.error ? `, ${c.error}` : ""}`);
  for (const [name] of files) console.log(`Wrote ${join(outDir, name)}`);
}

main().catch((e) => fail(e instanceof Error ? (e.stack ?? e.message) : String(e)));
