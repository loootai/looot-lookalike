import { mkdirSync, mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetLimits } from "./auth/limits";
import { runSeeds, SPEND_STEPS_PER_WINDOW, SpendLimitError } from "./service";

const KEYS = ["LOOOT_TOKEN", "LOOOT_API_URL", "LOOKALIKE_SESSION", "LOOKALIKE_CAP_USD", "NEXT_PUBLIC_DEMO"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
let server: Server;
let paidRuns = 0;

beforeAll(async () => {
  // A stand-in for api.looot.ai. The catalog answers 404, so prices fall back to the dated list. Every POST is a paid run.
  server = createServer((req, res) => {
    if (req.method === "POST") paidRuns++;
    res.statusCode = req.method === "POST" ? 200 : 404;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ runId: "r", status: "completed", result: {}, actualCost: 0.01 }));
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
  process.env.LOOKALIKE_SESSION = join(mkdtempSync(join(process.cwd(), ".vitest", "spend-")), "session.json");
  delete process.env.LOOKALIKE_CAP_USD;
  delete process.env.NEXT_PUBLIC_DEMO;
  paidRuns = 0;
  resetLimits();
});

describe("a paid step is bounded by the server cap", () => {
  it("never calls looot past LOOKALIKE_CAP_USD, whatever total the caller confirms", async () => {
    process.env.LOOKALIKE_CAP_USD = "0.0001";
    const r = await runSeeds("a1.example\nb2.example\nc3.example\nd4.example\ne5.example", 999_000_000, "s1");
    expect(r.ok).toBe(true);
    expect(paidRuns).toBe(0);
  });
  it("refuses when the live price is above the total the caller confirmed", async () => {
    const r = await runSeeds("a1.example\nb2.example\nc3.example\nd4.example\ne5.example", 1, "s1");
    expect(r).toMatchObject({ ok: false, code: "blocked_price" });
    expect(paidRuns).toBe(0);
  });
});

describe("paid steps are limited per session", () => {
  it("answers with a limit error after the window's worth, and another session still works", async () => {
    process.env.LOOKALIKE_CAP_USD = "0.0001";
    for (let i = 0; i < SPEND_STEPS_PER_WINDOW; i++) await runSeeds("a1.example\nb2.example\nc3.example\nd4.example\ne5.example", 1_000_000, "same");
    await expect(runSeeds("a1.example\nb2.example\nc3.example\nd4.example\ne5.example", 1_000_000, "same")).rejects.toBeInstanceOf(SpendLimitError);
    await expect(runSeeds("a1.example\nb2.example\nc3.example\nd4.example\ne5.example", 1_000_000, "other")).resolves.toBeDefined();
  });
});
