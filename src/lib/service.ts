import "server-only";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { FixtureRunner } from "@/demo/fixtureRunner";
import { DEMO_SEEDS } from "@/demo/fixtures";
import { IS_DEMO, now } from "./clock";
import { parseConfig, type LookalikeConfig } from "./config";
import { emptySession, enrichSeeds, InputError, parseSeeds, planEnrich, planSearch, planSeeds, planTotal, searchSimilar, type Ctx, type PlannedCall } from "./engine";
import { loootFromEnv } from "./looot";
import { toMicros } from "./money";
import { enrichCandidates } from "./engine";
import { rank, runPipeline } from "./pipeline";
import { FALLBACK_PRICES, fetchPrices } from "./prices";
import type { Scored, Session, Traits } from "./types";

const g = globalThis as unknown as { __lookalikeDemo?: Session };
const SESSION_FILE = () => resolve(/*turbopackIgnore: true*/ process.env.LOOKALIKE_SESSION ?? "data/session.json");

/** Weights file: LOOKALIKE_WEIGHTS, else weights.yaml, else weights.example.yaml. */
export function getConfig(): LookalikeConfig {
  const file = process.env.LOOKALIKE_WEIGHTS ?? (existsSync(resolve(/*turbopackIgnore: true*/ "weights.yaml")) ? "weights.yaml" : "weights.example.yaml");
  return parseConfig(readFileSync(resolve(/*turbopackIgnore: true*/ file), "utf8"));
}

/** Most one action may spend, in dollars. LOOKALIKE_CAP_USD changes it. */
export function capMicros(): number {
  return toMicros(process.env.LOOKALIKE_CAP_USD ?? "1");
}

async function save(s: Session): Promise<void> {
  if (IS_DEMO) {
    g.__lookalikeDemo = s;
    return;
  }
  mkdirSync(dirname(SESSION_FILE()), { recursive: true });
  writeFileSync(SESSION_FILE(), `${JSON.stringify(s, null, 1)}\n`);
}

/** The saved session. In demo mode the first read runs the sample seeds once on the fixtures. */
export async function getSession(): Promise<Session | null> {
  if (IS_DEMO) {
    if (!g.__lookalikeDemo) {
      const t = now();
      g.__lookalikeDemo = (await runPipeline(DEMO_SEEDS.map((s) => s.domain), getConfig(), { looot: new FixtureRunner(), prices: FALLBACK_PRICES, capMicros: capMicros(), now: t })).session;
    }
    return g.__lookalikeDemo;
  }
  return existsSync(SESSION_FILE()) ? (JSON.parse(readFileSync(SESSION_FILE(), "utf8")) as Session) : null;
}

export async function getRanked(session: Session | null, traits?: Traits): Promise<Scored[]> {
  if (!session) return [];
  const priced = await fetchPrices(undefined, { demo: IS_DEMO });
  return rank(session, getConfig(), priced.prices, traits);
}

export interface QuoteBody {
  step: "seeds" | "search";
  calls: Pick<PlannedCall, "endpointId" | "label" | "quotedMicros">[];
  totalMicros: number;
  capMicros: number;
  pricesAsOf: string;
  priceSource: string;
}

/** What a step would cost right now, from live catalog prices. Free, no token. */
export async function quote(step: QuoteBody["step"], seedsText?: string): Promise<QuoteBody> {
  const cfg = getConfig();
  const priced = await fetchPrices(undefined, { demo: IS_DEMO });
  let calls: PlannedCall[];
  if (step === "seeds") calls = planSeeds(parseSeeds(seedsText ?? ""), cfg, priced.prices, now());
  else {
    const s = await getSession();
    const usable = s?.seedResults.filter((r) => r.company).map((r) => r.domain) ?? [];
    if (usable.length < 2) throw new InputError("Enrich the seeds first.");
    calls = [...planSearch(usable, cfg, priced.prices, now())];
    if (cfg.enrichTop > 0) calls.push(...planEnrich(usable.slice(0, cfg.enrichTop), cfg, priced.prices, now()));
  }
  return { step, calls: calls.map((c) => ({ endpointId: c.endpointId, label: c.label, quotedMicros: c.quotedMicros })), totalMicros: planTotal(calls), capMicros: capMicros(), pricesAsOf: priced.pricesAsOf, priceSource: priced.source };
}

async function context(confirmedMaxMicros: number, total: number): Promise<Ctx | { error: string; code: "blocked_price" | "no_token" }> {
  if (total > confirmedMaxMicros) return { code: "blocked_price", error: `The price is now ${total} micro-dollars, above the ${confirmedMaxMicros} you confirmed. Nothing was called.` };
  const priced = await fetchPrices(undefined, { demo: IS_DEMO });
  const base = { prices: priced.prices, unpriced: priced.unread, capMicros: Math.min(capMicros(), confirmedMaxMicros), now: now() };
  if (IS_DEMO) return { ...base, looot: new FixtureRunner() };
  try {
    return { ...base, looot: loootFromEnv() };
  } catch {
    return { code: "no_token", error: "LOOOT_TOKEN is not set on the server." };
  }
}

export type StepResult = { ok: true; session: Session } | { ok: false; code: "blocked_price" | "no_token" | "input"; message: string };

/** Step 1. Enriches the seeds and derives the traits. Starts a new session. Refused when the live price is above what the user confirmed. */
export async function runSeeds(seedsText: string, confirmedMaxMicros: number): Promise<StepResult> {
  let seeds: string[];
  try {
    seeds = parseSeeds(seedsText);
  } catch (e) {
    return { ok: false, code: "input", message: (e as Error).message };
  }
  const cfg = getConfig();
  const priced = await fetchPrices(undefined, { demo: IS_DEMO });
  const ctx = await context(confirmedMaxMicros, planTotal(planSeeds(seeds, cfg, priced.prices, now())));
  if ("error" in ctx) return { ok: false, code: ctx.code, message: ctx.error };
  const session = await enrichSeeds(emptySession(seeds, ctx.now), cfg, ctx);
  await save(session);
  return { ok: true, session };
}

/** Step 2. Searches every source and (when configured) enriches the top candidates. */
export async function runSearch(confirmedMaxMicros: number): Promise<StepResult> {
  const cfg = getConfig();
  const session = await getSession();
  if (!session?.traits) return { ok: false, code: "input", message: "Enrich the seeds first." };
  const q = await quote("search");
  const ctx = await context(confirmedMaxMicros, q.totalMicros);
  if ("error" in ctx) return { ok: false, code: ctx.code, message: ctx.error };
  let next = await searchSimilar({ ...session, candidates: [] }, cfg, ctx);
  if (cfg.enrichTop > 0) {
    const top = rank(next, cfg, ctx.prices).slice(0, cfg.enrichTop).map((r) => r.candidate.domain);
    next = await enrichCandidates(next, top, cfg, { ...ctx, capMicros: Math.max(0, ctx.capMicros - (next.spentMicros - session.spentMicros)) });
  }
  await save(next);
  return { ok: true, session: next };
}

/** Saves edited traits on the session. Free. */
export async function saveTraits(traits: Traits): Promise<Session | null> {
  const s = await getSession();
  if (!s) return null;
  const next = { ...s, traits };
  await save(next);
  return next;
}
