import type { Company, TraitValue, Traits } from "./types";

/** Values that at least `minShare` of the seeds that have data for the field share, strongest first. */
function shared(seeds: Company[], pick: (c: Company) => string[], minShare: number, max: number): TraitValue[] {
  const withData = seeds.filter((c) => pick(c).length > 0);
  if (withData.length === 0) return [];
  const count = new Map<string, number>();
  for (const c of withData) for (const v of new Set(pick(c))) count.set(v, (count.get(v) ?? 0) + 1);
  return [...count.entries()]
    .map(([value, n]) => ({ value, share: Math.round((n / withData.length) * 100) / 100 }))
    .filter((t) => t.share >= minShare)
    .sort((a, b) => b.share - a.share || a.value.localeCompare(b.value))
    .slice(0, max);
}

/** Derives the shared traits of the seeds. Industry, technology, keyword and country must appear in `minSeedShare` of the seeds that report them. */
export function deriveTraits(seeds: Company[], minSeedShare = 0.4): Traits {
  const sizes = seeds.map((c) => c.employees).filter((n): n is number => n !== null && n > 0);
  return {
    industries: shared(seeds, (c) => c.industries, minSeedShare, 6),
    technologies: shared(seeds, (c) => c.technologies, minSeedShare, 10),
    keywords: shared(seeds, (c) => c.keywords, minSeedShare, 10),
    countries: shared(seeds, (c) => (c.country ? [c.country] : []), minSeedShare, 5),
    size: sizes.length > 0 ? { min: Math.min(...sizes), max: Math.max(...sizes) } : null,
  };
}
