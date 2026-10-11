import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { Budget, DEFAULT_LIMITS, HARD_EXPIRY_MS, RESERVE_TTL_MS } from "./budget";
import { parseConfig } from "./config";
import { emptySession, enrichSeeds, type Ctx } from "./engine";
import { LoootError, type LoootRun, type LoootRunner } from "./looot";
import { FALLBACK_PRICES } from "./prices";

const now = new Date("2026-10-10T09:00:00Z");
const cfg = parseConfig(readFileSync(join(process.cwd(), "weights.example.yaml"), "utf8"));
const SEEDS = ["a.example", "b.example", "c.example"];
let dir: string;
let file: string;
const open = () => new Budget(file);

beforeEach(() => {
  mkdirSync(join(process.cwd(), ".vitest"), { recursive: true });
  dir = mkdtempSync(join(process.cwd(), ".vitest", "budget-"));
  file = join(dir, "budget.json");
});

function runner(answer: (n: number) => LoootRun | Promise<LoootRun>) {
  const calls: string[] = [];
  const looot: LoootRunner = {
    async runAndWait(_endpointId, input) {
      calls.push(String(input.domain));
      return answer(calls.length);
    },
    async getRun() {
      throw new Error("not used");
    },
  };
  return { looot, calls };
}
const completed = (cost: number): LoootRun => ({ runId: "run_ok", status: "completed", result: { name: "Acme", industries: ["software"], employees: 40, country: "US" }, actualCost: cost });
const ctx = (looot: LoootRunner, ledger: Budget, extra: Partial<Ctx> = {}): Ctx => ({ looot, prices: FALLBACK_PRICES, capMicros: 5_000_000, now, ledger, ...extra });

describe("period budget", () => {
  it("has a default daily and monthly limit that the owner can change", async () => {
    const b = open();
    expect((await b.status(now)).limits).toEqual(DEFAULT_LIMITS);
    await b.setLimits({ dailyMicros: 2_000_000, monthlyMicros: 9_000_000 });
    expect((await open().status(now)).limits).toEqual({ dailyMicros: 2_000_000, monthlyMicros: 9_000_000 });
  });

  it("lets exactly one of two concurrent reservations through when their sum is over the budget", async () => {
    await open().setLimits({ dailyMicros: 1_000_000, monthlyMicros: 5_000_000 });
    const out = await Promise.all([open().reserve("k1", 700_000, now), open().reserve("k2", 700_000, now)]);
    expect(out.filter((r) => r.ok)).toHaveLength(1);
    expect(out.filter((r) => !r.ok)).toHaveLength(1);
    expect((await open().status(now)).day.reservedMicros).toBe(700_000);
  });

  it("holds under 25 concurrent reservations from separate handles", async () => {
    await open().setLimits({ dailyMicros: 1_000_000, monthlyMicros: 5_000_000 });
    const out = await Promise.all(Array.from({ length: 25 }, (_, i) => open().reserve(`k${i}`, 100_000, now)));
    expect(out.filter((r) => r.ok)).toHaveLength(10);
    const s = await open().status(now);
    expect(s.day.reservedMicros).toBe(1_000_000);
    expect(s.day.remainingMicros).toBe(0);
  });

  it("stops many small runs at the budget and says which limit it hit", async () => {
    await open().setLimits({ dailyMicros: 300_000, monthlyMicros: 300_000 });
    const b = open();
    let ok = 0;
    let last = "";
    for (let i = 0; i < 10; i++) {
      const r = await b.reserve(`s${i}`, 100_000, now);
      if (r.ok) ok++;
      else last = r.message;
    }
    expect(ok).toBe(3);
    expect(last).toMatch(/budget is reached/i);
  });

  it("counts a settled run against the day and the month, and a new day starts clean", async () => {
    const b = open();
    await b.setLimits({ dailyMicros: 1_000_000, monthlyMicros: 5_000_000 });
    await b.reserve("a", 400_000, now);
    await b.settle("a", "fp", 350_000, now);
    const s = await b.status(now);
    expect(s.day.usedMicros).toBe(350_000);
    expect(s.month.usedMicros).toBe(350_000);
    const s2 = await b.status(new Date("2026-10-11T09:00:00Z"));
    expect(s2.day.usedMicros).toBe(0);
    expect(s2.month.usedMicros).toBe(350_000);
  });

  it("releases a reservation", async () => {
    const b = open();
    await b.reserve("a", 400_000, now);
    await b.release("a");
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });

  it("rejects limits that are not positive or put the day above the month", async () => {
    const b = open();
    await expect(b.setLimits({ dailyMicros: 0, monthlyMicros: 1_000_000 })).rejects.toThrow();
    await expect(b.setLimits({ dailyMicros: 5_000_000, monthlyMicros: 1_000_000 })).rejects.toThrow(/daily/i);
    await expect(b.setLimits({ dailyMicros: Number.NaN, monthlyMicros: 1_000_000 })).rejects.toThrow();
  });

  it("takes the starting limits from the environment until the owner saves some", async () => {
    const b = new Budget(file, undefined);
    expect((await b.status(now)).limits).toEqual(DEFAULT_LIMITS);
  });
});

describe("reconciling reservations", () => {
  async function pendingReservation() {
    const b = open();
    await b.reserve("p", 10_000, now);
    await b.attach("p", "run_p");
    return b;
  }

  it("settles a late completion to the real cost", async () => {
    const b = await pendingReservation();
    await b.reconcile({ getRun: async () => ({ runId: "run_p", status: "completed", result: { x: 1 }, actualCost: 0.0031 }) }, new Date(now.getTime() + 60_000));
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(0);
    expect(s.day.usedMicros).toBe(3_100);
  });

  it("keeps the reservation while the run is still going, however old", async () => {
    const b = await pendingReservation();
    await b.reconcile({ getRun: async () => ({ runId: "run_p", status: "running" }) }, new Date(now.getTime() + 2 * RESERVE_TTL_MS));
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(10_000);
    expect(s.day.usedMicros).toBe(0);
  });

  it("releases when the run ended failed with no charge", async () => {
    const b = await pendingReservation();
    await b.reconcile({ getRun: async () => ({ runId: "run_p", status: "failed", actualCost: 0 }) }, new Date(now.getTime() + 60_000));
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(0);
    expect(s.day.usedMicros).toBe(0);
  });

  it("reconciles an expired reservation against the real run status", async () => {
    const b = await pendingReservation();
    await b.reconcile({ getRun: async () => ({ runId: "run_p", status: "completed", result: {}, actualCost: 0.002 }) }, new Date(now.getTime() + 2 * RESERVE_TTL_MS));
    const s = await b.status(now);
    expect(s.day.reservedMicros).toBe(0);
    expect(s.day.usedMicros).toBe(2_000);
  });

  it("keeps an unfetchable run reserved until the hard expiry, then releases it", async () => {
    const b = await pendingReservation();
    const broken = { getRun: async (): Promise<LoootRun> => { throw new LoootError("down", 503); } };
    await b.reconcile(broken, new Date(now.getTime() + 2 * RESERVE_TTL_MS));
    expect((await b.status(now)).day.reservedMicros).toBe(10_000);
    await b.reconcile(broken, new Date(now.getTime() + HARD_EXPIRY_MS + 1));
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });

  it("keeps a reservation that never got a run id until the hard expiry", async () => {
    const b = open();
    await b.reserve("crash", 10_000, now);
    const never = { getRun: async (): Promise<LoootRun> => { throw new Error("not called"); } };
    await b.reconcile(never, new Date(now.getTime() + 2 * RESERVE_TTL_MS));
    expect((await b.status(now)).day.reservedMicros).toBe(10_000);
    await b.reconcile(never, new Date(now.getTime() + HARD_EXPIRY_MS + 1));
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });
});

describe("enrichSeeds with the budget", () => {
  it("does not charge a repeated identical request twice", async () => {
    const b = open();
    const first = runner(() => completed(0.0098));
    const s1 = await enrichSeeds(emptySession(SEEDS, now), cfg, ctx(first.looot, b));
    const second = runner(() => completed(0.0098));
    const s2 = await enrichSeeds(emptySession(SEEDS, now), cfg, ctx(second.looot, b));
    expect(first.calls).toHaveLength(3);
    expect(second.calls).toHaveLength(0);
    expect(s2.spentMicros).toBe(0);
    expect(s2.seedResults.every((r) => r.status === "completed")).toBe(true);
    expect((await b.status(now)).day.usedMicros).toBe(s1.spentMicros);
  });

  it("answers two identical requests started together with one charge", async () => {
    const slow = () => runner(async () => { await new Promise((r) => setTimeout(r, 20)); return completed(0.0098); });
    const a = slow();
    const c = slow();
    await Promise.all([enrichSeeds(emptySession(SEEDS, now), cfg, ctx(a.looot, open())), enrichSeeds(emptySession(SEEDS, now), cfg, ctx(c.looot, open()))]);
    // Both handles call looot with the same key, and looot replays the stored run. The budget counts the spend once.
    expect(a.calls.length + c.calls.length).toBeGreaterThanOrEqual(3);
    const s = await open().status(now);
    expect(s.day.usedMicros).toBe(29_400);
    expect(s.day.reservedMicros).toBe(0);
  });

  it("skips calls that would pass the budget and says so", async () => {
    const b = open();
    await b.setLimits({ dailyMicros: 20_000, monthlyMicros: 20_000 });
    const { looot, calls } = runner(() => completed(0.0098));
    const s = await enrichSeeds(emptySession(SEEDS, now), cfg, ctx(looot, b));
    expect(calls).toHaveLength(2);
    expect(s.calls.filter((c) => c.status === "skipped_budget")).toHaveLength(1);
    expect(s.calls.find((c) => c.status === "skipped_budget")?.error).toMatch(/budget/i);
  });

  it("keeps the reservation of a pending call and never records it failed at zero", async () => {
    const b = open();
    const { looot } = runner(() => ({ runId: "run_slow", status: "running" }));
    const s = await enrichSeeds(emptySession(SEEDS, now), cfg, ctx(looot, b));
    expect(s.calls.every((c) => c.status === "pending")).toBe(true);
    const st = await b.status(now);
    expect(st.day.reservedMicros).toBe(29_400);
    expect(st.day.usedMicros).toBe(0);
  });

  it("releases the reservation of a failed call", async () => {
    const b = open();
    const { looot } = runner(() => { throw new LoootError("bad input", 400, "invalid_input"); });
    await enrichSeeds(emptySession(SEEDS, now), cfg, ctx(looot, b));
    const st = await b.status(now);
    expect(st.day.reservedMicros).toBe(0);
    expect(st.day.usedMicros).toBe(0);
  });

  it("releases a run looot reports failed at no charge", async () => {
    const b = open();
    const { looot } = runner(() => ({ runId: "r", status: "failed", actualCost: 0, error: { code: "provider_error" } }));
    await enrichSeeds(emptySession(SEEDS, now), cfg, ctx(looot, b));
    expect((await b.status(now)).day.reservedMicros).toBe(0);
  });

  it("keeps the reservation when the network fails and the outcome is unknown", async () => {
    const b = open();
    const { looot } = runner(() => { throw new TypeError("fetch failed"); });
    await enrichSeeds(emptySession(SEEDS, now), cfg, ctx(looot, b));
    expect((await b.status(now)).day.reservedMicros).toBe(29_400);
  });

  it("makes no budget file when there is no ledger", async () => {
    const { looot } = runner(() => completed(0));
    await enrichSeeds(emptySession(SEEDS, now), cfg, { looot, prices: FALLBACK_PRICES, capMicros: 5_000_000, now });
    expect(() => readFileSync(file, "utf8")).toThrow();
  });
});

describe("the budget file", () => {
  it("survives a damaged file by falling back to the defaults", async () => {
    writeFileSync(file, "{not json");
    expect((await open().status(now)).limits).toEqual(DEFAULT_LIMITS);
  });
});
