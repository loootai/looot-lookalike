import { mkdirSync, mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as budgetGet, PUT as budgetPut } from "@/app/api/budget/route";
import { POST as seeds } from "@/app/api/seeds/route";
import { resetLimits } from "@/lib/auth/limits";
import { FALLBACK_PRICES } from "@/lib/prices";
import { CSRF_HEADER, csrfToken, verifySession } from "@/lib/auth/session";

const PW = "test-password-123456";
const KEYS = ["LOOOT_TOKEN", "LOOOT_API_URL", "LOOKALIKE_SESSION", "LOOKALIKE_ADMIN_PASSWORD", "LOOKALIKE_DAILY_USD", "LOOKALIKE_MONTHLY_USD", "LOOKALIKE_CAP_USD", "NEXT_PUBLIC_DEMO"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
let server: Server;
let paidRuns = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.method !== "POST") {
      const id = decodeURIComponent((req.url ?? "").split("/").pop() ?? "");
      return void res.end(JSON.stringify({ price: { state: "known", amountMicros: FALLBACK_PRICES[id] ?? 1, unit: "call" } }));
    }
    paidRuns++;
    res.end(JSON.stringify({ runId: "r", status: "completed", result: { domain: "x.example", name: "X", industries: ["software"], employees: 40, country: "US" }, actualCost: 0.0098 }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.LOOOT_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
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
  process.env.LOOKALIKE_SESSION = join(mkdtempSync(join(process.cwd(), ".vitest", "budget-route-")), "session.json");
  process.env.LOOKALIKE_ADMIN_PASSWORD = PW;
  process.env.LOOOT_TOKEN = "lt_test_token";
  delete process.env.NEXT_PUBLIC_DEMO;
  delete process.env.LOOKALIKE_DAILY_USD;
  delete process.env.LOOKALIKE_MONTHLY_USD;
  delete process.env.LOOKALIKE_CAP_USD;
  paidRuns = 0;
  resetLimits();
});

const H = { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json", "x-forwarded-for": "198.51.100.7" };
async function session() {
  const res = await login(new Request("http://localhost:3000/api/auth/login", { method: "POST", headers: H, body: JSON.stringify({ password: PW }) }));
  const cookie = /lookalike_session=[^;]+/.exec(res.headers.get("set-cookie") ?? "")![0];
  const s = (await verifySession(process.env, cookie.split("=")[1]))!;
  return { cookie, token: await csrfToken(process.env, s.sid) };
}
type S = Awaited<ReturnType<typeof session>>;
const call = (fn: (r: Request) => Promise<Response>, method: string, path: string, body: unknown, s: S) => fn(new Request(`http://localhost:3000${path}`, { method, headers: { ...H, cookie: s.cookie, [CSRF_HEADER]: s.token }, body: body === undefined ? undefined : JSON.stringify(body) }));
const read = async (s: S) => (await (await budgetGet(new Request("http://localhost:3000/api/budget", { headers: { ...H, cookie: s.cookie } }))).json()) as { limits: { dailyMicros: number; monthlyMicros: number }; day: { limitMicros: number; usedMicros: number; reservedMicros: number; remainingMicros: number } };

describe("budget over HTTP", () => {
  it("shows used, reserved and remaining", async () => {
    const j = await read(await session());
    expect(j.day.remainingMicros).toBe(j.day.limitMicros);
  });

  it("refuses to change the budget without the session", async () => {
    const res = await budgetPut(new Request("http://localhost:3000/api/budget", { method: "PUT", headers: H, body: JSON.stringify({ dailyUsd: 1000, monthlyUsd: 5000 }) }));
    expect(res.status).toBe(401);
  });

  it("lets the signed-in owner change the budget", async () => {
    const s = await session();
    expect((await call(budgetPut, "PUT", "/api/budget", { dailyUsd: 1, monthlyUsd: 3 }, s)).status).toBe(200);
    expect((await read(s)).limits).toEqual({ dailyMicros: 1_000_000, monthlyMicros: 3_000_000 });
  });

  it("ignores a budget sent in a run request: it is refused and nothing is called", async () => {
    const s = await session();
    await call(budgetPut, "PUT", "/api/budget", { dailyUsd: 0.001, monthlyUsd: 0.002 }, s);
    const res = await call(seeds, "POST", "/api/seeds", { seeds: "a1.example\nb2.example\nc3.example", confirmedMaxMicros: 1_000_000, dailyUsd: 1e9, monthlyUsd: 1e9, budget: { dailyUsd: 1e9 }, limits: { dailyMicros: 1e15 } }, s);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/budget/i);
    expect(paidRuns).toBe(0);
    expect((await read(s)).limits.dailyMicros).toBe(1_000);
  });

  it("refuses a run above the owner's budget even when the caller confirms a large total", async () => {
    const s = await session();
    await call(budgetPut, "PUT", "/api/budget", { dailyUsd: 0.01, monthlyUsd: 0.01 }, s);
    const res = await call(seeds, "POST", "/api/seeds", { seeds: "a1.example\nb2.example\nc3.example", confirmedMaxMicros: 999_000_000 }, s);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/budget/i);
    expect(paidRuns).toBe(0);
  });

  it("does not charge a repeated identical request twice", async () => {
    const s = await session();
    const body = { seeds: "a1.example\nb2.example\nc3.example", confirmedMaxMicros: 1_000_000 };
    expect((await call(seeds, "POST", "/api/seeds", body, s)).status).toBe(200);
    expect(paidRuns).toBe(3);
    expect((await call(seeds, "POST", "/api/seeds", body, s)).status).toBe(200);
    expect(paidRuns).toBe(3);
  });
});
