import type { Company } from "./types";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Lower-case host of a URL or bare domain, without "www.". null when there is no host. */
export function hostOf(text: unknown): string | null {
  if (typeof text !== "string" || text.trim() === "") return null;
  const t = text.trim().toLowerCase();
  try {
    const h = new URL(/^[a-z]+:\/\//.test(t) ? t : `https://${t}`).hostname.replace(/^www\./, "");
    return h.includes(".") ? h : null;
  } catch {
    return null;
  }
}

const COUNTRIES: Record<string, string> = {
  "united states": "US", usa: "US", "united states of america": "US", "united kingdom": "GB", uk: "GB", "great britain": "GB", germany: "DE", france: "FR", spain: "ES", italy: "IT", netherlands: "NL", belgium: "BE", switzerland: "CH", sweden: "SE", norway: "NO", denmark: "DK", finland: "FI", ireland: "IE", portugal: "PT", poland: "PL", austria: "AT", canada: "CA", australia: "AU", "new zealand": "NZ", india: "IN", singapore: "SG", japan: "JP", china: "CN", brazil: "BR", mexico: "MX", israel: "IL", "united arab emirates": "AE", "south africa": "ZA", morocco: "MA", turkey: "TR", estonia: "EE", lithuania: "LT", latvia: "LV", "czech republic": "CZ", czechia: "CZ", romania: "RO", ukraine: "UA", argentina: "AR", colombia: "CO", chile: "CL", "south korea": "KR",
};

/** Country as ISO alpha-2 when the text is a known name or code, else the lower-cased text. null when empty. */
export function countryKey(v: unknown): string | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  const t = v.trim().toLowerCase();
  if (COUNTRIES[t]) return COUNTRIES[t];
  if (/^[a-z]{2}$/.test(t)) return t.toUpperCase();
  return t;
}

/** An employee count from a number or a range such as "51-200", "201 to 500 employees", "1,001+". The midpoint stands for a range. */
export function parseEmployees(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
  if (typeof v !== "string") return null;
  const nums = (v.replace(/,/g, "").match(/\d+(\.\d+)?\s*[kK]?/g) ?? []).map((n) => (/[kK]/.test(n) ? parseFloat(n) * 1000 : parseFloat(n)));
  if (nums.length === 0) return null;
  if (nums.length >= 2 && /-|to|–/.test(v)) return Math.round((nums[0] + nums[1]) / 2);
  return Math.round(nums[0]);
}

function strings(v: unknown): string[] {
  if (typeof v === "string") return v.split(/[,;|]/).map((x) => x.trim());
  if (Array.isArray(v)) return v.flatMap((x) => (typeof x === "string" ? [x.trim()] : isObj(x) ? strings(x.name ?? x.label ?? x.title ?? x.slug) : []));
  if (isObj(v)) return strings(v.active ?? v.names ?? v.list ?? v.name);
  return [];
}

const clean = (xs: string[]) => [...new Set(xs.map((x) => x.toLowerCase().replace(/\s+/g, " ").trim()).filter((x) => x.length > 1 && x.length < 60))];
const first = (o: Obj, keys: string[]): unknown => keys.map((k) => o[k]).find((v) => v !== undefined && v !== null && v !== "");
const path = (o: Obj, ...keys: string[]): unknown => keys.reduce<unknown>((cur, k) => (isObj(cur) ? cur[k] : undefined), o);

/** The company object inside a provider answer: unwraps `data`, `company` and `result` wrappers. */
export function companyObject(result: unknown): Obj | null {
  let cur = result;
  for (let i = 0; i < 3 && isObj(cur); i++) {
    if (cur.domain || cur.name || cur.about || cur.category) return cur;
    const inner = cur.data ?? cur.company ?? cur.result;
    if (!isObj(inner)) return cur;
    cur = inner;
  }
  return isObj(cur) ? cur : null;
}

/** The midpoint of an AI Ark staff range such as { start: 2, end: 10 }. null when the range is missing. */
function staffRange(v: unknown): number | null {
  if (!isObj(v) || typeof v.start !== "number" || typeof v.end !== "number") return null;
  return Math.round((v.start + v.end) / 2);
}

/** Reads one company from a provider row. Looks under the field names the public docs use. null when there is no domain. */
export function normalizeCompany(row: unknown): Company | null {
  if (!isObj(row)) return null;
  const link = isObj(row.link) ? row.link : {};
  const summary = isObj(row.summary) ? row.summary : {};
  const domainRaw = isObj(row.domain) ? row.domain.domain : first(row, ["domain", "website", "url", "company_domain", "homepage"]);
  const domain = hostOf(domainRaw) ?? hostOf(path(row, "about", "website")) ?? hostOf(link.domain) ?? hostOf(link.website);
  if (!domain) return null;
  const about = isObj(row.about) ? row.about : {};
  const category = isObj(row.category) ? row.category : {};
  const location = isObj(row.location) ? row.location : {};
  const hq = isObj(path(row, "locations", "headquarters")) ? (path(row, "locations", "headquarters") as Obj) : {};
  const geo = isObj(row.geo) ? row.geo : {};
  const countryRaw = first(row, ["country", "country_code", "countryCode", "hq_country"]) ?? path(row, "location", "headquarter", "country") ?? path(location, "country", "code") ?? path(location, "country", "name") ?? location.country ?? first(geo, ["countryCode", "country"]) ?? path(hq, "country", "code") ?? path(hq, "country", "name") ?? hq.country;
  const employeesRaw = first(row, ["employees", "employee_count", "employeeCount", "totalEmployees", "employees_range", "employeesRange", "size", "headcount"]) ?? first(about, ["totalEmployees", "employees"]) ?? path(row, "metrics", "employees") ?? path(row, "metrics", "employeesRange") ?? staffRange(path(summary, "staff", "range"));
  const industries = [...strings(first(row, ["industries", "industry", "industry_name", "sector"])), ...strings(about.industries), ...strings(category.industry), ...strings(category.sector), ...strings(summary.industry)];
  const technologies = [...strings(first(row, ["technologies", "tech", "techStack", "tech_stack", "tech_tags"])), ...strings(path(row, "technologies", "active"))];
  const description = first(row, ["description", "about_us", "tagline"]) ?? path(row, "descriptions", "primary") ?? about.description ?? summary.description;
  return {
    domain,
    name: (first(row, ["name", "company_name", "legalName"]) ?? about.name ?? summary.name ?? null) as string | null,
    description: typeof description === "string" ? description.slice(0, 400) : null,
    industries: clean(industries),
    employees: parseEmployees(employeesRaw),
    country: countryKey(typeof countryRaw === "string" ? countryRaw : null),
    technologies: clean(technologies),
    keywords: clean([...strings(first(row, ["keywords", "tags", "specialties", "topics", "keyword_tags"])), ...strings(about.keywords)]),
  };
}

/** The rows of a search answer: the first array of objects, looking in the usual wrapper keys first. */
export function rowsOf(result: unknown): Obj[] {
  if (Array.isArray(result)) return result.filter(isObj);
  if (!isObj(result)) return [];
  for (const k of ["companies", "items", "results", "data", "organizations"]) {
    const v = result[k];
    if (Array.isArray(v)) return v.filter(isObj);
    if (isObj(v)) {
      const inner = rowsOf(v);
      if (inner.length > 0) return inner;
    }
  }
  for (const v of Object.values(result)) if (Array.isArray(v) && v.length > 0 && isObj(v[0])) return v.filter(isObj);
  return [];
}
