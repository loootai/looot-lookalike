import { parse } from "yaml";
import { z } from "zod";
import { FEATURES } from "./types";

export class ConfigError extends Error {}

const ConfigSchema = z.object({
  weights: z.object(Object.fromEntries(FEATURES.map((f) => [f, z.number().min(0).max(10)])) as Record<(typeof FEATURES)[number], z.ZodNumber>).refine((w) => Object.values(w).some((v) => v > 0), "at least one weight must be above 0"),
  minSeedShare: z.number().min(0).max(1).default(0.4),
  minCoverage: z.number().min(0).max(1).default(0.35),
  candidatesPerSource: z.number().int().min(1).max(100).default(50),
  searchSources: z.array(z.enum(["thecompaniesapi_similar", "ai_ark_lookalike"])).min(1).default(["thecompaniesapi_similar", "ai_ark_lookalike"]),
  seedEnrich: z.enum(["companyenrich", "hunter"]).default("companyenrich"),
  enrichTop: z.number().int().min(0).max(50).default(0),
});

export type LookalikeConfig = z.infer<typeof ConfigSchema>;

/** Parses the weights file. Throws ConfigError with the first problem. */
export function parseConfig(text: string): LookalikeConfig {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (e) {
    throw new ConfigError(`The weights file is not valid YAML: ${(e as Error).message}`);
  }
  const res = ConfigSchema.safeParse(raw);
  if (!res.success) {
    const i = res.error.issues[0];
    throw new ConfigError(`${i.path.join(".") || "config"}: ${i.message}`);
  }
  return res.data;
}
