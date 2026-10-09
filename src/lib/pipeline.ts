import type { LookalikeConfig } from "./config";
import { emptySession, enrichCandidates, enrichSeeds, InputError, planEnrich, planSearch, planSeeds, planTotal, searchSimilar, type Ctx, type PlannedCall } from "./engine";
import { rankCandidates } from "./score";
import type { PriceMap } from "./prices";
import type { Scored, Session, Traits } from "./types";

/** Rows each search source returned, by endpoint id. Call-priced rows are priced per returned row. */
export function rowsByEndpoint(session: Session): Record<string, number> {
  const rows: Record<string, number> = {};
  for (const c of session.calls) if (c.step === "similar" && c.status === "completed") rows[c.endpointId] = c.rows;
  return rows;
}

/** Scores the session's candidates against the given traits (the session's own when none are given). Free: no looot call. */
export function rank(session: Session, cfg: LookalikeConfig, prices: PriceMap, traits?: Traits): Scored[] {
  const t = traits ?? session.traits;
  return t ? rankCandidates(session.candidates, t, cfg, prices, rowsByEndpoint(session)) : [];
}

/** Every call the whole pipeline could make, with the quote. Makes no request. */
export function planPipeline(seeds: string[], cfg: LookalikeConfig, prices: PriceMap, now: Date): { calls: PlannedCall[]; totalMicros: number } {
  const calls = [...planSeeds(seeds, cfg, prices, now), ...planSearch(seeds, cfg, prices, now), ...planEnrich(Array.from({ length: cfg.enrichTop }, (_, i) => `top-candidate-${i + 1}`), cfg, prices, now)];
  return { calls, totalMicros: planTotal(calls) };
}

/**
 * Seeds, then traits, then search, then (optionally) enrich the top candidates, then rank. One cap covers all of it:
 * each step gets what is left. Returns the session and the ranked list.
 */
export async function runPipeline(seeds: string[], cfg: LookalikeConfig, ctx: Ctx, start?: Session): Promise<{ session: Session; ranked: Scored[] }> {
  const base = start ?? emptySession(seeds, ctx.now);
  const spentAtStart = base.spentMicros;
  const left = (s: Session) => ({ ...ctx, capMicros: Math.max(0, ctx.capMicros - (s.spentMicros - spentAtStart)) });
  let session = await enrichSeeds(base, cfg, left(base));
  if (!session.traits) throw new InputError(`Only ${session.seedResults.filter((r) => r.company).length} of ${seeds.length} seeds could be enriched. At least 2 are needed.`);
  session = await searchSimilar(session, cfg, left(session));
  let ranked = rank(session, cfg, ctx.prices);
  if (cfg.enrichTop > 0 && ranked.length > 0) {
    const gaps = ranked.filter((r) => !r.candidate.enriched).slice(0, cfg.enrichTop).map((r) => r.candidate.domain);
    session = await enrichCandidates(session, gaps, cfg, left(session));
    ranked = rank(session, cfg, ctx.prices);
  }
  return { session, ranked };
}
