import "server-only";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { FixtureRunner } from "@/demo/fixtureRunner";
import { DEMO_SEEDS } from "@/demo/fixtures";
import { IS_DEMO, now } from "./clock";
import { parseConfig, type LookalikeConfig } from "./config";
import { callFingerprint, emptySession, enrichSeeds, InputError, parseSeeds, planEnrich, planSearch, planSeeds, planTotal, searchSimilar, type Ctx, type PlannedCall } from "./engine";
import { loootFromEnv } from "./looot";
import { enrichCandidates } from "./engine";
import { rank, runPipeline } from "./pipeline";
import { FALLBACK_PRICES, fetchPrices } from "./prices";
import type { Scored, Session, Traits } from "./types";
import { allow, retryAfter } from "./auth/limits";
import { Budget, type BudgetStatus } from "./budget";
import { toMicros, usd } from "./money";

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

/** The period budget file, next to the session file. */
export function getBudget(): Budget {
  return new Budget();
}

/** Used, reserved and remaining for today and this month. */
export async function budgetStatus(now: Date = new Date()): Promise<BudgetStatus> {
  return getBudget().status(now);
}

/** Owner only (the route checks the session and the CSRF token). Saves the daily and monthly budget in dollars. */
export async function setBudget(input: { dailyUsd: unknown; monthlyUsd: unknown }): Promise<BudgetStatus> {
  if (IS_DEMO) throw new Error("Demo mode has no budget to change.");
  const b = getBudget();
  await b.setLimits({ dailyMicros: toMicros(Number(input.dailyUsd)), monthlyMicros: toMicros(Number(input.monthlyUsd)) });
  return b.status();
}

/** Paid steps one session may start in a window. */
export const SPEND_STEPS_PER_WINDOW = 6;
export const SPEND_WINDOW_MS = 10 * 60_000;

export class SpendLimitError extends Error {}

/** Throws when this session has started too many paid steps. Counts one. */
function limitSpend(sid: string | undefined): void {
  const key = `spend:${sid ?? "demo"}`;
  if (!allow(key, SPEND_STEPS_PER_WINDOW, SPEND_WINDOW_MS)) throw new SpendLimitError(`Too many paid steps from this session. Try again in ${retryAfter(key)} seconds.`);
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

async function planStep(step: QuoteBody["step"], seedsText: string | undefined, prices: Record<string, number>): Promise<PlannedCall[]> {
  const cfg = getConfig();
  if (step === "seeds") return planSeeds(parseSeeds(seedsText ?? ""), cfg, prices, now());
  const s = await getSession();
  const usable = s?.seedResults.filter((r) => r.company).map((r) => r.domain) ?? [];
  if (usable.length < 2) throw new InputError("Enrich the seeds first.");
  const calls = [...planSearch(usable, cfg, prices, now())];
  if (cfg.enrichTop > 0) calls.push(...planEnrich(usable.slice(0, cfg.enrichTop), cfg, prices, now()));
  return calls;
}

/** What a step would cost right now, from live catalog prices. Free, no token. */
export async function quote(step: QuoteBody["step"], seedsText?: string): Promise<QuoteBody> {
  const priced = await fetchPrices(undefined, { demo: IS_DEMO });
  const calls = await planStep(step, seedsText, priced.prices);
  return { step, calls: calls.map((c) => ({ endpointId: c.endpointId, label: c.label, quotedMicros: c.quotedMicros })), totalMicros: planTotal(calls), capMicros: capMicros(), pricesAsOf: priced.pricesAsOf, priceSource: priced.source };
}

type StepCode = "blocked_price" | "no_token" | "budget";

async function context(confirmedMaxMicros: number, calls: PlannedCall[]): Promise<Ctx | { error: string; code: StepCode }> {
  const total = planTotal(calls);
  if (total > confirmedMaxMicros) return { code: "blocked_price", error: `The price is now ${total} micro-dollars, above the ${confirmedMaxMicros} you confirmed. Nothing was called.` };
  const priced = await fetchPrices(undefined, { demo: IS_DEMO });
  const base = { prices: priced.prices, unpriced: priced.unread, capMicros: Math.min(capMicros(), confirmedMaxMicros), now: now() };
  if (IS_DEMO) return { ...base, looot: new FixtureRunner() };
  let looot;
  try {
    looot = loootFromEnv();
  } catch {
    return { code: "no_token", error: "LOOOT_TOKEN is not set on the server." };
  }
  // Check order: quote, per-run cap (above and in the engine), period budget, then the calls. Runs that ended since last time settle first.
  const budget = getBudget();
  await budget.reconcile(looot);
  const room = await budget.status();
  const session = await getSession();
  let needed = 0;
  for (const c of calls) {
    const stored = await budget.recall(c.idempotencyKey, callFingerprint(c.endpointId, c.input), base.now);
    if (!stored && !session?.pending[c.idempotencyKey]) needed += c.quotedMicros;
  }
  if (needed > room.remainingMicros) {
    return { code: "budget", error: `The quote (${usd(needed)}) is above what is left of the budget (${usd(room.remainingMicros)}: ${usd(room.day.remainingMicros)} today, ${usd(room.month.remainingMicros)} this month). Nothing was called. Raise the budget on the Costs page, or wait for the period to roll over.` };
  }
  return { ...base, looot, ledger: budget };
}

export type StepResult = { ok: true; session: Session } | { ok: false; code: StepCode | "input"; message: string };

/** Step 1. Enriches the seeds and derives the traits. Starts a new session. Refused when the live price is above what the user confirmed. */
export async function runSeeds(seedsText: string, confirmedMaxMicros: number, sid?: string): Promise<StepResult> {
  limitSpend(sid);
  let seeds: string[];
  try {
    seeds = parseSeeds(seedsText);
  } catch (e) {
    return { ok: false, code: "input", message: (e as Error).message };
  }
  const cfg = getConfig();
  const priced = await fetchPrices(undefined, { demo: IS_DEMO });
  const ctx = await context(confirmedMaxMicros, planSeeds(seeds, cfg, priced.prices, now()));
  if ("error" in ctx) return { ok: false, code: ctx.code, message: ctx.error };
  const session = await enrichSeeds(emptySession(seeds, ctx.now), cfg, ctx);
  await save(session);
  return { ok: true, session };
}

/** Step 2. Searches every source and (when configured) enriches the top candidates. */
export async function runSearch(confirmedMaxMicros: number, sid?: string): Promise<StepResult> {
  limitSpend(sid);
  const cfg = getConfig();
  const session = await getSession();
  if (!session?.traits) return { ok: false, code: "input", message: "Enrich the seeds first." };
  const priced = await fetchPrices(undefined, { demo: IS_DEMO });
  const ctx = await context(confirmedMaxMicros, await planStep("search", undefined, priced.prices));
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
