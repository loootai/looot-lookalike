import { describe, expect, it } from "vitest";
import { parseConfig } from "./config";
import { rankCandidates, scoreCandidate, sizeSimilarity } from "./score";
import { deriveTraits } from "./traits";
import type { Candidate, Company, Traits } from "./types";
import { readFileSync } from "node:fs";

const cfg = parseConfig(readFileSync("weights.example.yaml", "utf8"));
const PRICES = { "src-a": 1900, "src-b": 1200 };
const co = (over: Partial<Company>): Company => ({ domain: "x.io", name: null, description: null, industries: [], employees: null, country: null, technologies: [], keywords: [], ...over });
const seeds = [co({ domain: "s1.io", industries: ["software"], employees: 100, country: "US", technologies: ["react", "stripe"], keywords: ["crm"] }), co({ domain: "s2.io", industries: ["software"], employees: 200, country: "US", technologies: ["react"], keywords: ["crm", "outbound"] }), co({ domain: "s3.io", industries: ["marketing"], employees: 50, country: "GB", technologies: ["react", "hubspot"], keywords: ["outbound"] })];
const traits = deriveTraits(seeds, 0.4);
const cand = (over: Partial<Candidate>): Candidate => ({ ...co({ domain: "c.io" }), found: [{ endpointId: "src-a", rank: 1, of: 10 }], fieldSource: { industry: "src-a", size: "src-a", technology: "src-a", keywords: "src-b", region: "src-a" }, enriched: false, ...over });

describe("deriveTraits", () => {
  it("keeps values shared by enough seeds, with their share", () => {
    expect(traits.industries).toEqual([{ value: "software", share: 0.67 }, { value: "marketing", share: 0.33 }].filter((t) => t.share >= 0.4));
    expect(traits.technologies[0]).toEqual({ value: "react", share: 1 });
    expect(traits.technologies.map((t) => t.value)).not.toContain("stripe");
    expect(traits.size).toEqual({ min: 50, max: 200 });
    expect(traits.countries).toEqual([{ value: "US", share: 0.67 }]);
  });
  it("is empty and has no size when seeds report nothing", () => {
    expect(deriveTraits([co({}), co({})])).toEqual({ industries: [], technologies: [], keywords: [], countries: [], size: null });
  });
});

describe("sizeSimilarity", () => {
  it("is 1 inside the range and 0 at ten times outside", () => {
    expect(sizeSimilarity(100, { min: 50, max: 200 })).toBe(1);
    expect(sizeSimilarity(2000, { min: 50, max: 200 })).toBeCloseTo(0, 5);
    expect(sizeSimilarity(400, { min: 50, max: 200 })).toBeCloseTo(0.699, 2);
    expect(sizeSimilarity(5, { min: 50, max: 200 })).toBeCloseTo(0, 5);
  });
});

describe("scoreCandidate", () => {
  it("scores a full match as 100 with every line sourced", () => {
    const t: Traits = { industries: [{ value: "software", share: 1 }], technologies: [{ value: "react", share: 1 }], keywords: [{ value: "crm", share: 1 }], countries: [{ value: "US", share: 1 }], size: { min: 50, max: 200 } };
    const s = scoreCandidate(cand({ industries: ["software"], employees: 80, country: "US", technologies: ["react"], keywords: ["crm"] }), t, cfg.weights, PRICES);
    expect(s.score).toBeCloseTo(100, 0);
    expect(s.coverage).toBe(1);
    expect(s.lines.find((l) => l.feature === "keywords")).toMatchObject({ provider: "src-b", costMicros: 1200 });
    expect(s.lines.every((l) => l.provider)).toBe(true);
  });
  it("leaves out features with no data and divides by the weights that had data", () => {
    const s = scoreCandidate(cand({ industries: ["software"], employees: 80 }), traits, cfg.weights, PRICES);
    const avail = s.lines.filter((l) => l.available).map((l) => l.feature);
    expect(avail).toEqual(["industry", "size", "agreement"]);
    expect(s.coverage).toBeCloseTo((0.3 + 0.2 + 0.05) / 1, 2);
    // industry 0.3*1 + size 0.2*1 + agreement 0.05*1 over 0.55
    expect(s.score).toBeCloseTo(((0.3 + 0.2 + 0.05 * 1) / 0.55) * 100, 0);
    expect(s.lines.find((l) => l.feature === "technology")).toMatchObject({ available: false, points: 0 });
  });
  it("points add up to the score", () => {
    const s = scoreCandidate(cand({ industries: ["marketing"], employees: 500, country: "GB", technologies: ["react", "hubspot"], keywords: ["outbound"] }), traits, cfg.weights, PRICES);
    expect(s.lines.reduce((n, l) => n + l.points, 0)).toBeCloseTo(s.score, 0);
  });
  it("scores a mismatch low and says why", () => {
    const s = scoreCandidate(cand({ industries: ["logistics"], employees: 5000, country: "FR", technologies: ["sap"], keywords: ["freight"] }), traits, cfg.weights, PRICES);
    expect(s.score).toBeLessThan(15);
    expect(s.lines.find((l) => l.feature === "industry")?.detail).toContain("is not among");
  });
  it("uses the weights file: a zero weight removes the feature", () => {
    const s = scoreCandidate(cand({ industries: ["logistics"], employees: 80, country: "US", technologies: ["react"], keywords: ["crm"] }), traits, { ...cfg.weights, industry: 0 }, PRICES);
    expect(s.lines.find((l) => l.feature === "industry")?.points).toBe(0);
    expect(s.score).toBeGreaterThan(70);
  });
});

describe("rankCandidates", () => {
  it("orders by score and drops low coverage", () => {
    const good = cand({ domain: "good.io", industries: ["software"], employees: 90, country: "US", technologies: ["react"], keywords: ["crm"] });
    const weak = cand({ domain: "weak.io", industries: ["logistics"], employees: 9000, country: "FR", technologies: ["sap"], keywords: ["freight"] });
    const thin = cand({ domain: "thin.io", found: [], fieldSource: {}, keywords: ["crm"] });
    const ranked = rankCandidates([weak, thin, good], traits, cfg, PRICES);
    expect(ranked.map((r) => r.candidate.domain)).toEqual(["good.io", "weak.io"]);
  });
});
