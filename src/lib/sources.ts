export const PRICES_AS_OF = "2026-10-10";

export type SeedEnrichId = "companyenrich" | "hunter";
export type SearchSourceId = "thecompaniesapi_similar" | "ai_ark_lookalike";

export interface EndpointDef {
  /** looot job id, the catalog reference. */
  jobId: string;
  /** The pinned looot endpoint this app runs. No fallback routing, so the price is the one quoted. */
  endpointId: string;
  unit: "call" | "result";
  /** Micro-dollars, read from the public catalog on PRICES_AS_OF. */
  fallbackMicros: number;
  label: string;
}

export const ENRICH: Record<SeedEnrichId, EndpointDef> = {
  companyenrich: { jobId: "company.enrich", endpointId: "companyenrich-companies-enrich-get", unit: "call", fallbackMicros: 9800, label: "CompanyEnrich, by domain" },
  hunter: { jobId: "company.enrich", endpointId: "hunter-companies-find", unit: "call", fallbackMicros: 4900, label: "Hunter, by domain" },
};

export const SEARCH: Record<SearchSourceId, EndpointDef> = {
  thecompaniesapi_similar: { jobId: "company.similar", endpointId: "thecompaniesapi-companies-similar", unit: "result", fallbackMicros: 1900, label: "TheCompaniesAPI, similar to domains" },
  ai_ark_lookalike: { jobId: "company.lookalike", endpointId: "ai-ark-companies", unit: "result", fallbackMicros: 1200, label: "AI Ark, lookalike search (up to 5 domains)" },
};

/** Every endpoint this app can call, with its dated list price. */
export const ALL_ENDPOINTS: EndpointDef[] = [...Object.values(ENRICH), ...Object.values(SEARCH)];
export const FALLBACK_PRICES: Record<string, number> = Object.fromEntries(ALL_ENDPOINTS.map((e) => [e.endpointId, e.fallbackMicros]));

/** Price of one returned row from an endpoint, in micros. Call-priced endpoints spread the call over `rows`. */
export function rowPrice(endpointId: string, prices: Record<string, number>, rows: number): number {
  const def = ALL_ENDPOINTS.find((e) => e.endpointId === endpointId);
  const unit = prices[endpointId] ?? def?.fallbackMicros ?? 0;
  return def?.unit === "result" ? unit : Math.round(unit / Math.max(1, rows));
}
