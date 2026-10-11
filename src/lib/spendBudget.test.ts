import { mkdirSync, mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetLimits } from "./auth/limits";
import { FALLBACK_PRICES } from "./prices";
import { runSeeds } from "./service";

// These tests use only the service entry points, so they run the same before and after the budget change.
const KEYS = ["LOOOT_TOKEN", "LOOOT_API_URL", "LOOKALIKE_SESSION", "LOOKALIKE_CAP_USD", "LOOKALIKE_DAILY_USD", "LOOKALIKE_MONTHLY_USD", "NEXT_PUBLIC_DEMO"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
let server: Server;
let paidRuns = 0;
let delayMs = 0;

const THREE = (tag: string) => `a-${tag}.example\nb-${tag}.example\nc-${tag}.example`;
const company = (domain: string) => ({ domain, name: domain, industries: ["software"], employees: 40, country: "US" });

beforeAll(async () => {
  // A stand-in for api.looot.ai. The catalog answers with the dated list prices. Every POST is a paid run.
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.method !== "POST") {
        const id = decodeURIComponent((req.url ?? "").split("/").pop() ?? "");
        res.statusCode = FALLBACK_PRICES[id] === undefined ? 404 : 200;
        return void res.end(JSON.stringify({ price: { state: "known", amountMicros: FALLBACK_PRICES[id], unit: "call" } }));
      }
      paidRuns++;
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}") as { input?: { domain?: string } };
      setTimeout(() => res.end(JSON.stringify({ runId: `r${paidRuns}`, status: "completed", result: company(body.input?.domain ?? "x.example"), actualCost: 0.0098 })), delayMs);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.LOOOT_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.LOOOT_TOKEN = "lt_test_token";
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
beforeEach(() => {
  mkdirSync(join(process.cwd(), ".vitest"), { recursive: true });
  process.env.LOOKALIKE_SESSION = join(mkdtempSync(join(process.cwd(), ".vitest", "spend-budget-")), "session.json");
  delete process.env.LOOKALIKE_CAP_USD;
  delete process.env.LOOKALIKE_DAILY_USD;
  delete process.env.LOOKALIKE_MONTHLY_USD;
  delete process.env.NEXT_PUBLIC_DEMO;
  paidRuns = 0;
  delayMs = 0;
  resetLimits();
});

describe("a repeated identical request", () => {
  it("is answered from the stored result, with no second call and no second charge", async () => {
    const a = await runSeeds(THREE("same"), 1_000_000, "s1");
    expect(a.ok).toBe(true);
    expect(paidRuns).toBe(3);
    const b = await runSeeds(THREE("same"), 1_000_000, "s1");
    expect(b.ok).toBe(true);
    expect(paidRuns).toBe(3);
    if (a.ok && b.ok) expect(b.session.seedResults.map((r) => r.company?.domain)).toEqual(a.session.seedResults.map((r) => r.company?.domain));
  });
});

describe("the period budget", () => {
  it("stops many small runs at the budget and says so", async () => {
    process.env.LOOKALIKE_DAILY_USD = "0.09";
    process.env.LOOKALIKE_MONTHLY_USD = "0.09";
    // One 3-seed run quotes $0.0294. Three fit in $0.09, the fourth does not.
    const results = [];
    for (const tag of ["1", "2", "3", "4", "5"]) results.push(await runSeeds(THREE(tag), 1_000_000, "s1"));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    const refused = results.filter((r) => !r.ok);
    expect(refused).toHaveLength(2);
    expect(refused[0]).toMatchObject({ ok: false, code: "budget" });
    expect(!refused[0].ok && refused[0].message).toMatch(/budget/i);
    expect(paidRuns).toBe(9);
  });

  it("never lets two concurrent runs spend more than the budget between them", async () => {
    // Each run quotes $0.0294 for 3 seeds, $0.0588 together, and the budget is $0.04. Calls cost $0.0098 each.
    process.env.LOOKALIKE_DAILY_USD = "0.04";
    process.env.LOOKALIKE_MONTHLY_USD = "0.04";
    delayMs = 40;
    const out = await Promise.all([runSeeds(THREE("x"), 1_000_000, "s1"), runSeeds(THREE("y"), 1_000_000, "s2")]);
    // Six calls were planned. Four fit in $0.04, so two are skipped, and the money never passes the budget.
    expect(paidRuns).toBeLessThanOrEqual(4);
    const skipped = out.flatMap((r) => (r.ok ? r.session.calls.filter((c) => c.status === "skipped_budget") : []));
    expect(skipped.length).toBeGreaterThanOrEqual(2);
    expect(skipped[0].error).toMatch(/budget/i);
  });
});
