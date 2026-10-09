/** One company, normalized from whatever a provider returned. Empty fields stay empty; nothing is guessed. */
export interface Company {
  domain: string;
  name: string | null;
  description: string | null;
  industries: string[];
  employees: number | null;
  /** ISO 3166 alpha-2 when the country is known, else the lower-cased text. */
  country: string | null;
  technologies: string[];
  keywords: string[];
}

export type Feature = "industry" | "size" | "technology" | "keywords" | "region" | "agreement";
export const FEATURES: Feature[] = ["industry", "size", "technology", "keywords", "region", "agreement"];

/** A value shared by seeds, with the share of seeds that have it (0 to 1). */
export interface TraitValue {
  value: string;
  share: number;
}

/** What the seeds have in common. The user can edit every field before the search. */
export interface Traits {
  industries: TraitValue[];
  technologies: TraitValue[];
  keywords: TraitValue[];
  countries: TraitValue[];
  /** Employee range of the seeds. null when no seed gave a size. */
  size: { min: number; max: number } | null;
}

/** A candidate with where each field came from. */
export interface Candidate extends Company {
  /** Endpoint ids that returned this company, with the rank (1 is best) each gave it. */
  found: { endpointId: string; rank: number; of: number }[];
  /** Endpoint that supplied each field, for the "provider" column of the breakdown. */
  fieldSource: Partial<Record<Feature, string>>;
  enriched: boolean;
}

export interface ScoreLine {
  feature: Feature;
  /** Weight from the config file. */
  weight: number;
  /** false when the candidate has no value for this feature. Its weight is left out of the score. */
  available: boolean;
  /** 0 to 1. */
  similarity: number;
  /** Points this line adds to the 0 to 100 score. */
  points: number;
  detail: string;
  provider: string | null;
  /** List price of one row from that provider, in micros. */
  costMicros: number;
}

export interface Scored {
  candidate: Candidate;
  score: number;
  /** Share of the total weight that had data. */
  coverage: number;
  lines: ScoreLine[];
  costMicros: number;
}

export interface SeedResult {
  domain: string;
  status: "completed" | "failed" | "pending" | "skipped_budget" | "skipped_price";
  company: Company | null;
  runId: string | null;
  costMicros: number;
  error?: string;
}

export interface CallLog {
  step: "seed" | "similar" | "enrich";
  endpointId: string;
  label: string;
  status: SeedResult["status"];
  runId: string | null;
  quotedMicros: number;
  costMicros: number;
  rows: number;
  error?: string;
}

/** Everything one lookalike session knows. One JSON file. */
export interface Session {
  version: 1;
  createdAt: string;
  seeds: string[];
  seedResults: SeedResult[];
  traits: Traits | null;
  candidates: Candidate[];
  calls: CallLog[];
  spentMicros: number;
  /** Idempotency key to run id for calls still in progress. */
  pending: Record<string, { runId: string; step: CallLog["step"]; endpointId: string; label: string }>;
}
