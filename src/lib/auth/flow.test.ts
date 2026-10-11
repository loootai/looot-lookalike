import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as exportCsv } from "@/app/api/export/route";
import { POST as quote } from "@/app/api/quote/route";
import { POST as score } from "@/app/api/score/route";
import { POST as search } from "@/app/api/search/route";
import { POST as seeds } from "@/app/api/seeds/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { proxy } from "@/proxy";
import { resetLimits } from "./limits";
import { CSRF_HEADER, csrfToken, verifySession } from "./session";

const PW = "test-password-123456";
const H = { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json", "x-forwarded-for": "198.51.100.7" };
const KEYS = ["LOOKALIKE_ADMIN_PASSWORD", "LOOKALIKE_SESSION", "NEXT_PUBLIC_DEMO", "LOOOT_TOKEN"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

const post = (url: string, body: unknown, headers: Record<string, string> = {}) => new Request(`http://localhost:3000${url}`, { method: "POST", headers: { ...H, ...headers }, body: JSON.stringify(body) });
const cookieOf = (res: Response) => /lookalike_session=[^;]+/.exec(res.headers.get("set-cookie") ?? "")?.[0] ?? "";

beforeEach(() => {
  mkdirSync(join(process.cwd(), ".vitest"), { recursive: true });
  const dir = mkdtempSync(join(process.cwd(), ".vitest", "flow-"));
  process.env.LOOKALIKE_SESSION = join(dir, "session.json");
  process.env.LOOKALIKE_ADMIN_PASSWORD = PW;
  delete process.env.NEXT_PUBLIC_DEMO;
  delete process.env.LOOOT_TOKEN;
  resetLimits();
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function session() {
  const res = await login(post("/api/auth/login", { password: PW }));
  const cookie = cookieOf(res);
  const s = (await verifySession(process.env, cookie.split("=")[1]))!;
  return { cookie, token: await csrfToken(process.env, s.sid) };
}

describe("sign in", () => {
  it("a wrong password gets 401 and no cookie", async () => {
    const res = await login(post("/api/auth/login", { password: "nope-nope-nope-nope" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
  it("the right password sets a hardened cookie that opens admin routes", async () => {
    const res = await login(post("/api/auth/login", { password: PW }));
    expect(res.status).toBe(200);
    const sc = res.headers.get("set-cookie")!;
    expect(sc).toMatch(/HttpOnly/);
    expect(sc).toMatch(/SameSite=Lax/);
    expect(sc).toMatch(/Max-Age=/);
    const page = await proxy(new NextRequest("http://localhost:3000/scoring", { headers: { cookie: cookieOf(res) } }));
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toBe("no-store");
  });
  it("a form post redirects to the page asked for, and never off site", async () => {
    const form = (next: string) => new Request("http://localhost:3000/api/auth/login", { method: "POST", headers: { host: H.host, origin: H.origin, "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": H["x-forwarded-for"] }, body: new URLSearchParams({ password: PW, next }) });
    expect((await login(form("/scoring"))).headers.get("location")).toBe("/scoring");
    expect((await login(form("//evil.example"))).headers.get("location")).toBe("/");
    expect((await login(form("https://evil.example"))).headers.get("location")).toBe("/");
  });
  it("locks the address after 5 wrong passwords, and the right password does not help until the window ends", async () => {
    for (let i = 0; i < 5; i++) expect((await login(post("/api/auth/login", { password: `wrong-password-${i}-xx` }))).status).toBe(401);
    const locked = await login(post("/api/auth/login", { password: PW }));
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(locked.headers.get("set-cookie")).toBeNull();
  });
  it("refuses a sign-in posted from another site", async () => {
    expect((await login(post("/api/auth/login", { password: PW }, { origin: "https://evil.example" }))).status).toBe(403);
  });
  it("sign out clears the cookie, and only for a same-site request", async () => {
    expect((await logout(post("/api/auth/logout", {}))).headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect((await logout(post("/api/auth/logout", {}, { origin: "https://evil.example" }))).status).toBe(403);
  });
});

describe("CSRF on the paid and free routes", () => {
  const traits = { industries: [], technologies: [], keywords: [], countries: [], size: null };
  it("rejects a cross-site origin even with a valid session", async () => {
    const { cookie, token } = await session();
    expect((await score(post("/api/score", traits, { cookie, [CSRF_HEADER]: token, origin: "https://evil.example" }))).status).toBe(403);
  });
  it("rejects a same-origin request without the token, or with a wrong one", async () => {
    const { cookie } = await session();
    expect((await seeds(post("/api/seeds", { seeds: "acme.example", confirmedMaxMicros: 1 }, { cookie }))).status).toBe(403);
    expect((await search(post("/api/search", { confirmedMaxMicros: 1 }, { cookie, [CSRF_HEADER]: "AAAA" }))).status).toBe(403);
    expect((await score(post("/api/score", traits, { cookie }))).status).toBe(403);
  });
  it("accepts a same-origin request with the session token", async () => {
    const { cookie, token } = await session();
    // No session file yet, so the route answers 409 after the gate. Anything but 401 or 403 means the gate let it through.
    expect((await score(post("/api/score", traits, { cookie, [CSRF_HEADER]: token }))).status).toBe(409);
  });
  it("a request with no Origin and no fetch metadata is refused", async () => {
    const { cookie, token } = await session();
    const res = await score(new Request("http://localhost:3000/api/score", { method: "POST", headers: { host: H.host, cookie, [CSRF_HEADER]: token }, body: JSON.stringify(traits) }));
    expect(res.status).toBe(403);
  });
  it("every state-changing route is closed without a session", async () => {
    expect((await seeds(post("/api/seeds", { seeds: "acme.example", confirmedMaxMicros: 1 }))).status).toBe(401);
    expect((await search(post("/api/search", { confirmedMaxMicros: 1 }))).status).toBe(401);
    expect((await quote(post("/api/quote", { step: "seeds" }))).status).toBe(401);
    expect((await score(post("/api/score", traits))).status).toBe(401);
  });
});

describe("export", () => {
  it("is closed without a session and never cached with one", async () => {
    expect((await exportCsv(new Request("http://localhost:3000/api/export", { headers: { host: H.host } }))).status).toBe(401);
    const { cookie } = await session();
    const res = await exportCsv(new Request("http://localhost:3000/api/export", { headers: { host: H.host, cookie } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toMatch(/text\/csv/);
  });
});
