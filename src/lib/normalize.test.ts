import { describe, expect, it } from "vitest";
import { companyObject, countryKey, hostOf, normalizeCompany, parseEmployees, rowsOf } from "./normalize";

describe("parseEmployees", () => {
  it("reads numbers, ranges and plus signs", () => {
    expect(parseEmployees(85)).toBe(85);
    expect(parseEmployees("51-200")).toBe(126);
    expect(parseEmployees("201 to 500 employees")).toBe(351);
    expect(parseEmployees("1,001+")).toBe(1001);
    expect(parseEmployees("2k")).toBe(2000);
    expect(parseEmployees("many")).toBeNull();
    expect(parseEmployees(null)).toBeNull();
  });
});

describe("countryKey and hostOf", () => {
  it("maps names and codes to one key", () => {
    expect(countryKey("United States")).toBe("US");
    expect(countryKey("us")).toBe("US");
    expect(countryKey("Narnia")).toBe("narnia");
    expect(countryKey("")).toBeNull();
  });
  it("reads a host", () => {
    expect(hostOf("https://www.Acme.io/x")).toBe("acme.io");
    expect(hostOf("nodots")).toBeNull();
  });
});

describe("normalizeCompany", () => {
  it("reads a flat row", () => {
    expect(normalizeCompany({ name: "Acme", domain: "acme.io", industry: "Software Development", employees: "51-200", location: { country: { code: "US" } }, technologies: ["HubSpot", { name: "Stripe" }], keywords: "crm, outbound" })).toMatchObject({ domain: "acme.io", name: "Acme", industries: ["software development"], employees: 126, country: "US", technologies: ["hubspot", "stripe"], keywords: ["crm", "outbound"] });
  });
  it("reads a nested row with the domain as an object", () => {
    const c = normalizeCompany({ domain: { domain: "acme.io" }, about: { name: "Acme", industries: ["Fintech"], totalEmployees: "11-50" }, locations: { headquarters: { country: { name: "Germany" } } }, technologies: { active: ["React"] } });
    expect(c).toMatchObject({ domain: "acme.io", name: "Acme", industries: ["fintech"], employees: 31, country: "DE", technologies: ["react"] });
  });
  it("reads a clearbit style row", () => {
    expect(normalizeCompany({ domain: "acme.io", category: { industry: "Software" }, metrics: { employees: 40 }, geo: { country: "United Kingdom" }, tech: ["segment"], tags: ["saas"] })).toMatchObject({ industries: ["software"], employees: 40, country: "GB", technologies: ["segment"], keywords: ["saas"] });
  });
  it("returns null without a domain and leaves unknown fields empty", () => {
    expect(normalizeCompany({ name: "No domain" })).toBeNull();
    expect(normalizeCompany({ domain: "a.io" })).toMatchObject({ industries: [], employees: null, country: null, technologies: [], keywords: [] });
  });
});

describe("rows and wrappers", () => {
  it("finds rows in the usual wrappers", () => {
    expect(rowsOf({ companies: [{ a: 1 }] })).toHaveLength(1);
    expect(rowsOf({ data: { items: [{ a: 1 }, { a: 2 }] } })).toHaveLength(2);
    expect(rowsOf(null)).toEqual([]);
  });
  it("unwraps a company answer", () => {
    expect(companyObject({ data: { name: "A", domain: "a.io" } })).toMatchObject({ name: "A" });
    expect(companyObject("x")).toBeNull();
  });
});
