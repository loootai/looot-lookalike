import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const run = (args: string[]) => spawnSync("node_modules/.bin/tsx", ["src/cli.ts", ...args], { encoding: "utf8", env: { ...process.env, LOOOT_TOKEN: "" } });

describe("cli", () => {
  it("--dry-run prints the cost and writes nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "lookalike-cli-"));
    const r = run(["--dry-run", "--domains", "a.io,b.io,c.io", "--out", join(dir, "out")]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Total at most $0.1844 for 5 calls");
    expect(r.stdout).toContain("no looot call was made");
    expect(existsSync(join(dir, "out"))).toBe(false);
  });
  it("--demo writes json, csv and md with a ranked list", () => {
    const dir = mkdtempSync(join(tmpdir(), "lookalike-cli-"));
    const r = run(["--demo", "--out", join(dir, "out")]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/16 ranked companies/);
    const files = readdirSync(join(dir, "out"));
    expect(files.map((f) => f.split(".").pop()).sort()).toEqual(["csv", "json", "md"]);
    const json = JSON.parse(readFileSync(join(dir, "out", files.find((f) => f.endsWith(".json"))!), "utf8"));
    expect(json.ranked[0].lines).toHaveLength(6);
  });
  it("reads seeds from a file", () => {
    const dir = mkdtempSync(join(tmpdir(), "lookalike-cli-"));
    writeFileSync(join(dir, "seeds.txt"), "a.io\nb.io\nc.io\n");
    expect(run(["--dry-run", "--seeds", join(dir, "seeds.txt")]).status).toBe(0);
  });
  it("rejects two seeds, a missing token and a bad weights file", () => {
    expect(run(["--dry-run", "--domains", "a.io,b.io"]).status).toBe(2);
    const noToken = run(["--domains", "a.io,b.io,c.io"]);
    expect(noToken.status).toBe(2);
    expect(noToken.stderr).toContain("LOOOT_TOKEN is not set");
    const dir = mkdtempSync(join(tmpdir(), "lookalike-cli-"));
    writeFileSync(join(dir, "w.yaml"), "weights: {industry: 1}");
    expect(run(["--dry-run", "--domains", "a.io,b.io,c.io", "--weights", join(dir, "w.yaml")]).status).toBe(2);
  });
});
