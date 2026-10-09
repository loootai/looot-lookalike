import type { LookalikeConfig } from "./config";
import { LoootError, TERMINAL_STATUSES, type LoootRun, type LoootRunner } from "./looot";
import { toMicros } from "./money";
import { companyObject, hostOf, normalizeCompany, rowsOf } from "./normalize";
import type { PriceMap } from "./prices";
import { ENRICH, SEARCH } from "./sources";
import { deriveTraits } from "./traits";
import type { CallLog, Candidate, Company, Feature, Session } from "./types";
import { hash } from "./utils";

export const MIN_SEEDS = 3;
export const MAX_SEEDS = 20;

export class InputError extends Error {}

/** Cleans a pasted list of domains or URLs: one per line or comma separated, deduped, 3 to 20 of them. Throws InputError otherwise. */
export function parseSeeds(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(/[\s,;]+/)) {
    if (!part) continue;
    const h = hostOf(part);
    if (!h) throw new InputError(`"${part}" is not a domain.`);
    seen.add(h);
  }
  const seeds = [...seen];
  if (seeds.length < MIN_SEEDS) throw new InputError(`Give at least ${MIN_SEEDS} seed domains. You gave ${seeds.length}.`);
  if (seeds.length > MAX_SEEDS) throw new InputError(`Give at most ${MAX_SEEDS} seed domains. You gave ${seeds.length}.`);
  return seeds;
}

export function emptySession(seeds: string[], now: Date): Session {
  return { version: 1, createdAt: now.toISOString(), seeds, seedResults: [], traits: null, candidates: [], calls: [], spentMicros: 0, pending: {} };
}

export interface PlannedCall {
  step: CallLog["step"];
  endpointId: string;
  label: string;
  input: Record<string, unknown>;
  quotedMicros: number;
  /** Same input, same month, same key: looot replays the stored run and never charges twice. */
  idempotencyKey: string;
}

const monthKey = (d: Date) => d.toISOString().slice(0, 7);

function call(step: PlannedCall["step"], endpointId: string, unit: "call" | "result", rows: number, label: string, input: Record<string, unknown>, prices: PriceMap, now: Date, fallback: number): PlannedCall {
  const price = prices[endpointId] ?? fallback;
  return { step, endpointId, label, input, quotedMicros: unit === "result" ? price * rows : price, idempotencyKey: `looot-lookalike:${step}:${endpointId}:${hash(JSON.stringify(input))}:${monthKey(now)}` };
}

/** One enrich call per seed. */
export function planSeeds(seeds: string[], cfg: LookalikeConfig, prices: PriceMap, now: Date): PlannedCall[] {
  const def = ENRICH[cfg.seedEnrich];
  return seeds.map((d) => call("seed", def.endpointId, def.unit, 1, d, { domain: d }, prices, now, def.fallbackMicros));
}

/** One call per search source. Result-priced calls are quoted at candidatesPerSource rows. */
export function planSearch(seedDomains: string[], cfg: LookalikeConfig, prices: PriceMap, now: Date): PlannedCall[] {
  return cfg.searchSources.map((id) => {
    const def = SEARCH[id];
    const input = id === "thecompaniesapi_similar" ? { domains: seedDomains.slice(0, 20), size: cfg.candidatesPerSource } : { lookalikeDomains: seedDomains.slice(0, 5), page: 0, size: cfg.candidatesPerSource };
    return call("similar", def.endpointId, def.unit, cfg.candidatesPerSource, def.label, input, prices, now, def.fallbackMicros);
  });
}

/** One enrich call per domain, to fill the gaps of the top candidates. */
export function planEnrich(domains: string[], cfg: LookalikeConfig, prices: PriceMap, now: Date): PlannedCall[] {
  const def = ENRICH[cfg.seedEnrich];
  return domains.map((d) => call("enrich", def.endpointId, def.unit, 1, d, { domain: d }, prices, now, def.fallbackMicros));
}

export const planTotal = (calls: PlannedCall[]) => calls.reduce((n, c) => n + c.quotedMicros, 0);

export interface Ctx {
  looot: LoootRunner;
  prices: PriceMap;
  unpriced?: string[];
  /** Most this action may spend, in micros. */
  capMicros: number;
  now: Date;
}

interface Outcome {
  log: CallLog;
  result?: unknown;
}

const cleanError = (e: unknown) => (e instanceof LoootError ? `${e.code ?? e.status}: ${e.message}` : (e as Error).message);

/** Runs planned calls in order under one cap. Pending runs are read again for free. Mutates the session's log, pending map and spend. */
async function execAll(session: Session, calls: PlannedCall[], ctx: Ctx): Promise<Outcome[]> {
  const done = new Set(session.calls.filter((c) => c.status === "completed" && c.runId).map((c) => c.label + c.endpointId));
  let spent = 0;
  const out: Outcome[] = [];
  for (const c of calls) {
    const log: CallLog = { step: c.step, endpointId: c.endpointId, label: c.label, status: "completed", runId: null, quotedMicros: c.quotedMicros, costMicros: 0, rows: 0 };
    out.push({ log });
    try {
      const waiting = session.pending[c.idempotencyKey];
      if (!waiting && ctx.unpriced?.includes(c.endpointId)) {
        log.status = "skipped_price";
        log.error = "The live price could not be read, so the call was not made.";
        continue;
      }
      if (!waiting && spent + c.quotedMicros > ctx.capMicros) {
        log.status = "skipped_budget";
        log.error = "The cap would be exceeded.";
        continue;
      }
      const replay = done.has(c.label + c.endpointId);
      const run: LoootRun = waiting ? await ctx.looot.getRun(waiting.runId) : await ctx.looot.runAndWait(c.endpointId, c.input, c.idempotencyKey);
      log.runId = run.runId;
      if (!TERMINAL_STATUSES.has(run.status)) {
        log.status = "pending";
        session.pending[c.idempotencyKey] = { runId: run.runId, step: c.step, endpointId: c.endpointId, label: c.label };
        if (!waiting) spent += c.quotedMicros;
        continue;
      }
      delete session.pending[c.idempotencyKey];
      const cost = replay || waiting ? 0 : run.actualCost !== undefined && run.actualCost !== null ? toMicros(run.actualCost) : run.status === "completed" ? c.quotedMicros : 0;
      log.costMicros = cost;
      spent += cost;
      if (run.status !== "completed") {
        log.status = "failed";
        log.error = run.error ? `${run.error.code ?? run.status}: ${run.error.message ?? ""}`.trim() : run.status;
        continue;
      }
      out.at(-1)!.result = run.result;
    } catch (e) {
      log.status = "failed";
      log.error = cleanError(e);
    }
  }
  session.spentMicros += spent;
  return out;
}

/** Enriches the seeds, then derives the shared traits. Needs at least two seeds that resolve. */
export async function enrichSeeds(session: Session, cfg: LookalikeConfig, ctx: Ctx): Promise<Session> {
  const calls = planSeeds(session.seeds, cfg, ctx.prices, ctx.now);
  const outcomes = await execAll(session, calls, ctx);
  const seedResults = outcomes.map((o, i): Session["seedResults"][number] => {
    const domain = session.seeds[i];
    let company: Company | null = null;
    if (o.log.status === "completed") {
      const obj = companyObject(o.result);
      const n = obj ? normalizeCompany({ ...obj, domain: obj.domain ?? domain }) : null;
      company = n ? { ...n, domain } : null;
      if (!company || (company.industries.length === 0 && company.employees === null && company.technologies.length === 0 && company.keywords.length === 0 && !company.country)) {
        o.log.status = "failed";
        o.log.error = "The provider returned nothing usable for this domain.";
        company = null;
      }
    }
    return { domain, status: o.log.status, company, runId: o.log.runId, costMicros: o.log.costMicros, error: o.log.error };
  });
  const good = seedResults.flatMap((r) => (r.company ? [r.company] : []));
  return { ...session, seedResults, traits: good.length >= 2 ? deriveTraits(good, cfg.minSeedShare) : null, calls: [...session.calls, ...outcomes.map((o) => o.log)] };
}

const FIELDS: [Feature, (c: Company) => boolean][] = [
  ["industry", (c) => c.industries.length > 0],
  ["size", (c) => c.employees !== null],
  ["technology", (c) => c.technologies.length > 0],
  ["keywords", (c) => c.keywords.length > 0],
  ["region", (c) => c.country !== null],
];

/** Adds a company row to the candidate map. Fields the candidate lacks are filled from this row and credited to its endpoint. */
export function mergeRow(map: Map<string, Candidate>, row: Company, endpointId: string, found?: { rank: number; of: number }): void {
  const cur = map.get(row.domain) ?? { ...row, industries: [], employees: null, country: null, technologies: [], keywords: [], name: null, description: null, found: [], fieldSource: {}, enriched: false };
  for (const [feature, has] of FIELDS) {
    if (has(cur) || !has(row)) continue;
    cur.fieldSource[feature] = endpointId;
    if (feature === "industry") cur.industries = row.industries;
    if (feature === "size") cur.employees = row.employees;
    if (feature === "technology") cur.technologies = row.technologies;
    if (feature === "keywords") cur.keywords = row.keywords;
    if (feature === "region") cur.country = row.country;
  }
  cur.name = cur.name ?? row.name;
  cur.description = cur.description ?? row.description;
  if (found) cur.found = [...cur.found, { endpointId, ...found }];
  map.set(row.domain, cur);
}

/** Searches every configured source for companies like the seeds. Seeds themselves are removed. */
export async function searchSimilar(session: Session, cfg: LookalikeConfig, ctx: Ctx): Promise<Session> {
  const usable = session.seedResults.filter((r) => r.company).map((r) => r.domain);
  if (usable.length < 2) throw new InputError("Fewer than two seeds were enriched, so there is nothing to search with.");
  const calls = planSearch(usable, cfg, ctx.prices, ctx.now);
  const outcomes = await execAll(session, calls, ctx);
  const map = new Map(session.candidates.map((c) => [c.domain, c]));
  const seedSet = new Set(session.seeds);
  outcomes.forEach((o) => {
    if (o.log.status !== "completed") return;
    const rows = rowsOf(o.result).map((r) => normalizeCompany(r)).filter((c): c is Company => c !== null && !seedSet.has(c.domain));
    o.log.rows = rows.length;
    rows.forEach((row, i) => mergeRow(map, row, o.log.endpointId, { rank: i + 1, of: rows.length }));
  });
  return { ...session, candidates: [...map.values()], calls: [...session.calls, ...outcomes.map((o) => o.log)] };
}

/** Enriches the given candidate domains and fills their empty fields. */
export async function enrichCandidates(session: Session, domains: string[], cfg: LookalikeConfig, ctx: Ctx): Promise<Session> {
  const outcomes = await execAll(session, planEnrich(domains, cfg, ctx.prices, ctx.now), ctx);
  const map = new Map(session.candidates.map((c) => [c.domain, c]));
  outcomes.forEach((o, i) => {
    const cand = map.get(domains[i]);
    if (o.log.status !== "completed" || !cand) return;
    const obj = companyObject(o.result);
    const n = obj ? normalizeCompany({ ...obj, domain: obj.domain ?? domains[i] }) : null;
    if (!n) {
      o.log.status = "failed";
      o.log.error = "The provider returned nothing usable for this domain.";
      return;
    }
    mergeRow(map, { ...n, domain: domains[i] }, o.log.endpointId);
    map.get(domains[i])!.enriched = true;
    o.log.rows = 1;
  });
  return { ...session, candidates: [...map.values()], calls: [...session.calls, ...outcomes.map((o) => o.log)] };
}
