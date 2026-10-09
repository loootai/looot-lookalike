import type { LookalikeConfig } from "./config";
import { rowPrice } from "./sources";
import { FEATURES, type Candidate, type Feature, type ScoreLine, type Scored, type TraitValue, type Traits } from "./types";

type Weights = LookalikeConfig["weights"];
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Weighted overlap: the share of the traits' weight that the candidate has. */
function overlap(traits: TraitValue[], has: string[]): { sim: number; hit: string[] } {
  const set = new Set(has);
  const total = traits.reduce((n, t) => n + t.share, 0);
  const hit = traits.filter((t) => set.has(t.value));
  return { sim: total > 0 ? hit.reduce((n, t) => n + t.share, 0) / total : 0, hit: hit.map((t) => t.value) };
}

/** Size similarity: 1 inside the seeds' range, falling to 0 at ten times outside it (log scale). */
export function sizeSimilarity(employees: number, range: { min: number; max: number }): number {
  if (employees >= range.min && employees <= range.max) return 1;
  const factor = employees < range.min ? range.min / Math.max(1, employees) : employees / range.max;
  return Math.max(0, 1 - Math.log10(factor));
}

function line(feature: Feature, weight: number, available: boolean, similarity: number, detail: string, provider: string | null, cost: number): ScoreLine {
  return { feature, weight, available, similarity: available ? similarity : 0, points: 0, detail, provider, costMicros: cost };
}

/** Scores one candidate against the traits. Every line names the provider that supplied the value and what that row cost. */
export function scoreCandidate(c: Candidate, traits: Traits, weights: Weights, prices: Record<string, number>, rowsBy: Record<string, number> = {}): Scored {
  const cost = (feature: Feature) => {
    const id = c.fieldSource[feature];
    return id ? rowPrice(id, prices, rowsBy[id] ?? 1) : 0;
  };
  const src = (feature: Feature) => c.fieldSource[feature] ?? null;
  const lines: ScoreLine[] = [];

  const ind = overlap(traits.industries, c.industries);
  const indAvail = c.industries.length > 0 && traits.industries.length > 0;
  const topShare = traits.industries[0]?.share ?? 1;
  const indSim = ind.hit.length > 0 ? Math.min(1, Math.max(...traits.industries.filter((t) => ind.hit.includes(t.value)).map((t) => t.share)) / topShare) : 0;
  lines.push(line("industry", weights.industry, indAvail, indSim, !indAvail ? "No industry on this side." : ind.hit.length > 0 ? `${ind.hit.join(", ")} (seeds share ${traits.industries.filter((t) => ind.hit.includes(t.value)).map((t) => pct(t.share)).join(", ")})` : `${c.industries.slice(0, 2).join(", ")} is not among ${traits.industries.map((t) => t.value).join(", ")}`, src("industry"), cost("industry")));

  const sizeAvail = c.employees !== null && traits.size !== null;
  const sizeSim = sizeAvail ? sizeSimilarity(c.employees!, traits.size!) : 0;
  lines.push(line("size", weights.size, sizeAvail, sizeSim, !sizeAvail ? "No employee count on this side." : `${c.employees} employees against a seed range of ${traits.size!.min} to ${traits.size!.max}`, src("size"), cost("size")));

  const tech = overlap(traits.technologies, c.technologies);
  const techAvail = c.technologies.length > 0 && traits.technologies.length > 0;
  lines.push(line("technology", weights.technology, techAvail, tech.sim, !techAvail ? "No technologies on this side." : `${tech.hit.length} of ${traits.technologies.length} shared technologies${tech.hit.length > 0 ? `: ${tech.hit.slice(0, 5).join(", ")}` : ""}`, src("technology"), cost("technology")));

  const kw = overlap(traits.keywords, c.keywords);
  const kwAvail = c.keywords.length > 0 && traits.keywords.length > 0;
  lines.push(line("keywords", weights.keywords, kwAvail, kw.sim, !kwAvail ? "No keywords on this side." : `${kw.hit.length} of ${traits.keywords.length} shared keywords${kw.hit.length > 0 ? `: ${kw.hit.slice(0, 5).join(", ")}` : ""}`, src("keywords"), cost("keywords")));

  const regAvail = c.country !== null && traits.countries.length > 0;
  const reg = traits.countries.find((t) => t.value === c.country);
  lines.push(line("region", weights.region, regAvail, reg ? Math.min(1, reg.share / (traits.countries[0]?.share || 1)) : 0, !regAvail ? "No country on this side." : reg ? `${c.country}, where ${pct(reg.share)} of the seeds are` : `${c.country} is not among ${traits.countries.map((t) => t.value).join(", ")}`, src("region"), cost("region")));

  // Agreement: how many of the search providers returned it, and how high. Not available for a company that was not searched for.
  const found = c.found;
  const agreeSim = found.length === 0 ? 0 : found.reduce((n, f) => n + (1 - (f.rank - 1) / Math.max(1, f.of)), 0) / found.length;
  lines.push(line("agreement", weights.agreement, found.length > 0, agreeSim, found.length === 0 ? "Not returned by a search." : `Returned by ${found.length} source${found.length > 1 ? "s" : ""}: ${found.map((f) => `#${f.rank} of ${f.of} on ${f.endpointId}`).join(", ")}`, found[0]?.endpointId ?? null, 0));

  const totalWeight = FEATURES.reduce((n, f) => n + weights[f], 0);
  const availWeight = lines.filter((l) => l.available).reduce((n, l) => n + l.weight, 0);
  for (const l of lines) l.points = l.available && availWeight > 0 ? Math.round(((l.weight * l.similarity) / availWeight) * 1000) / 10 : 0;
  const score = Math.round(lines.reduce((n, l) => n + l.points, 0) * 10) / 10;
  const providers = new Set(lines.filter((l) => l.available && l.provider).map((l) => l.provider));
  const costMicros = [...providers].reduce((n, p) => n + rowPrice(p!, prices, rowsBy[p!] ?? 1), 0);
  return { candidate: c, score, coverage: totalWeight > 0 ? Math.round((availWeight / totalWeight) * 100) / 100 : 0, lines, costMicros };
}

/** Scores and ranks candidates. Drops those under minCoverage. Highest score first; ties go to more coverage. */
export function rankCandidates(candidates: Candidate[], traits: Traits, cfg: Pick<LookalikeConfig, "weights" | "minCoverage">, prices: Record<string, number>, rowsBy: Record<string, number> = {}): Scored[] {
  return candidates
    .map((c) => scoreCandidate(c, traits, cfg.weights, prices, rowsBy))
    .filter((s) => s.coverage >= cfg.minCoverage)
    .sort((a, b) => b.score - a.score || b.coverage - a.coverage || a.candidate.domain.localeCompare(b.candidate.domain));
}
