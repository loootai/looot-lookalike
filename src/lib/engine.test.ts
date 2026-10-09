import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { FixtureRunner } from "@/demo/fixtureRunner";
import { DEMO_SEEDS, fixtureBody } from "@/demo/fixtures";
import { ConfigError, parseConfig } from "./config";
import { InputError, parseSeeds, planSearch, planSeeds, planTotal } from "./engine";
import { toCsv, toMarkdown } from "./export";
import type { LoootRun, LoootRunner } from "./looot";
import { planPipeline, rank, runPipeline } from "./pipeline";
import { FALLBACK_PRICES } from "./prices";

const NOW = new Date("2026-10-10T09:00:00.000Z");
const cfg = parseConfig(readFileSync("weights.example.yaml", "utf8"));
const seeds = DEMO_SEEDS.map((s) => s.domain);
const ctx = (looot: LoootRunner, capMicros = 1_000_000, extra = {}) => ({ looot, prices: FALLBACK_PRICES, capMicros, now: NOW, ...extra });

describe("parseSeeds", () => {
  it("cleans urls, dedupes, accepts newlines and commas", () => {
    expect(parseSeeds("https://www.A.io/x\nb.io, c.io; a.io")).toEqual(["a.io", "b.io", "c.io"]);
  });
  it("needs 3 to 20 domains", () => {
    expect(() => parseSeeds("a.io, b.io")).toThrow(/at least 3/);
    expect(() => parseSeeds(Array.from({ length: 21 }, (_, i) => `d${i}.io`).join(","))).toThrow(/at most 20/);
    expect(() => parseSeeds("a.io, b.io, notadomain")).toThrow(InputError);
  });
});

describe("config", () => {
  it("reads the example and rejects bad files", () => {
    expect(cfg.weights.industry).toBe(0.3);
    expect(cfg.searchSources).toEqual(["thecompaniesapi_similar", "ai_ark_lookalike"]);
    expect(() => parseConfig("weights: {industry: 1}")).toThrow(ConfigError);
    expect(() => parseConfig("{{")).toThrow(/not valid YAML/);
  });
});

describe("quotes", () => {
  it("prices seeds per call and searches at the row limit", () => {
    expect(planTotal(planSeeds(seeds, cfg, FALLBACK_PRICES, NOW))).toBe(6 * 9800);
    expect(planSearch(seeds, cfg, FALLBACK_PRICES, NOW).map((c) => [c.endpointId, c.quotedMicros])).toEqual([["thecompaniesapi-companies-similar", 95_000], ["ai-ark-companies", 60_000]]);
    expect(planPipeline(seeds, cfg, FALLBACK_PRICES, NOW).totalMicros).toBe(58_800 + 155_000);
  });
  it("keeps idempotency keys stable for the same input and changes them with the month", () => {
    const a = planSeeds(seeds, cfg, FALLBACK_PRICES, NOW).map((c) => c.idempotencyKey);
    expect(a).toEqual(planSeeds(seeds, cfg, FALLBACK_PRICES, new Date("2026-10-30T00:00:00Z")).map((c) => c.idempotencyKey));
    expect(a).not.toEqual(planSeeds(seeds, cfg, FALLBACK_PRICES, new Date("2026-11-02T00:00:00Z")).map((c) => c.idempotencyKey));
    expect(new Set(a).size).toBe(seeds.length);
    // the AI Ark call only sends 5 domains, so its input differs from the other source
    const s = planSearch(seeds, cfg, FALLBACK_PRICES, NOW);
    expect((s[1].input.lookalikeDomains as string[]).length).toBe(5);
    expect(s[0].idempotencyKey).not.toBe(s[1].idempotencyKey);
  });
});

describe("runPipeline", () => {
  it("enriches seeds, derives traits, searches, merges and ranks", async () => {
    const looot = new FixtureRunner();
    const { session, ranked } = await runPipeline(seeds, cfg, ctx(looot));
    expect(session.traits?.industries[0].value).toBe("software development");
    expect(looot.calls.filter((c) => c.endpointId === "companyenrich-companies-enrich-get")).toHaveLength(6);
    expect(session.candidates.some((c) => c.found.length === 2)).toBe(true);
    expect(session.candidates.some((c) => seeds.includes(c.domain))).toBe(false);
    expect(ranked[0].candidate.domain).toBe("forgepoint.example");
    expect(ranked[0].score).toBeGreaterThan(ranked.at(-1)!.score);
    expect(session.spentMicros).toBe(6 * 9800 + 13 * 1900 + 11 * 1200);
  });

  it("re-scoring with edited traits makes no call", async () => {
    const looot = new FixtureRunner();
    const { session } = await runPipeline(seeds, cfg, ctx(looot));
    const before = looot.calls.length;
    const edited = { ...session.traits!, industries: [{ value: "marketing technology", share: 1 }], countries: [{ value: "GB", share: 1 }] };
    const ranked = rank(session, cfg, FALLBACK_PRICES, edited);
    expect(looot.calls).toHaveLength(before);
    expect(ranked[0].candidate.industries).toContain("marketing technology");
  });

  it("stops calling when the cap is reached", async () => {
    const looot = new FixtureRunner();
    const { session } = await runPipeline(seeds, cfg, ctx(looot, 70_000));
    // 6 seeds cost 58,800, which leaves 11,200. Both search quotes (95,000 and 60,000) are over that.
    expect(session.calls.filter((c) => c.status === "skipped_budget").map((c) => c.endpointId)).toEqual(["thecompaniesapi-companies-similar", "ai-ark-companies"]);
    expect(looot.calls.some((c) => c.endpointId === "thecompaniesapi-companies-similar")).toBe(false);
  });

  it("fails clearly when fewer than two seeds resolve", async () => {
    const looot: LoootRunner = { runAndWait: vi.fn(async (): Promise<LoootRun> => ({ runId: "r", status: "failed", error: { code: "not_found", message: "no company" }, actualCost: 0 })), getRun: vi.fn() };
    await expect(runPipeline(seeds, cfg, ctx(looot))).rejects.toThrow(/Only 0 of 6 seeds/);
  });

  it("continues when one seed fails", async () => {
    const looot: LoootRunner = {
      runAndWait: vi.fn(async (e: string, input: Record<string, unknown>): Promise<LoootRun> => (input.domain === "pipewell.example" ? { runId: "x", status: "failed", error: { code: "not_found", message: "no company" } } : { runId: "ok", status: "completed", result: fixtureBody(e, input), actualCost: 0.0098 })),
      getRun: vi.fn(),
    };
    const { session } = await runPipeline(seeds, cfg, ctx(looot));
    expect(session.seedResults.find((r) => r.domain === "pipewell.example")).toMatchObject({ status: "failed", costMicros: 0 });
    expect(session.seedResults.filter((r) => r.company)).toHaveLength(5);
  });

  it("marks a seed still running as pending, and reads it again on the next run", async () => {
    let first = true;
    const looot: LoootRunner = {
      runAndWait: vi.fn(async (e: string, input: Record<string, unknown>): Promise<LoootRun> => (input.domain === "ledgerly.example" && first ? { runId: "slow", status: "running" } : { runId: `r-${String(input.domain)}`, status: "completed", result: fixtureBody(e, input), actualCost: 0.0098 })),
      getRun: vi.fn(async (): Promise<LoootRun> => ({ runId: "slow", status: "completed", result: fixtureBody("companyenrich-companies-enrich-get", { domain: "ledgerly.example" }), actualCost: 0.0098 })),
    };
    const one = await runPipeline(seeds, cfg, ctx(looot));
    first = false;
    expect(one.session.seedResults[0].status).toBe("pending");
    expect(Object.keys(one.session.pending)).toHaveLength(1);
    // The next run starts from the stored session, so pending runs are read through getRun.
    const two = await runPipeline(seeds, cfg, ctx(looot), { ...one.session, calls: [], candidates: [], seedResults: [] });
    expect(looot.getRun).toHaveBeenCalledWith("slow");
    expect(two.session.seedResults[0].status).toBe("completed");
    expect(two.session.pending).toEqual({});
  });

  it("fills gaps with enrichTop and credits the enrich provider", async () => {
    const withEnrich = { ...cfg, enrichTop: 3 };
    const looot = new FixtureRunner();
    const { session, ranked } = await runPipeline(seeds, withEnrich, ctx(looot));
    expect(looot.calls.filter((c) => c.endpointId === "companyenrich-companies-enrich-get")).toHaveLength(6 + 3);
    expect(ranked.some((r) => r.candidate.enriched)).toBe(true);
    expect(session.calls.filter((c) => c.step === "enrich")).toHaveLength(3);
  });
});

describe("export", () => {
  it("writes csv with the reason and stops formulas", async () => {
    const { session, ranked } = await runPipeline(seeds, cfg, ctx(new FixtureRunner()));
    const csv = toCsv(ranked);
    expect(csv.split("\n")[0]).toBe("rank,domain,name,score,coverage,industry,employees,country,why_similar");
    expect(csv).toContain("forgepoint.example");
    expect(toCsv([{ ...ranked[0], candidate: { ...ranked[0].candidate, name: "=SUM(1)" } }])).toContain("'=SUM(1)");
    const md = toMarkdown(session, ranked, 2);
    expect(md).toContain("### 1. Forgepoint");
    expect(md).toContain("From thecompaniesapi-companies-similar");
    expect(md).not.toContain("### 3.");
  });
});
