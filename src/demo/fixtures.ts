// Sample provider answers for demo mode and tests. Every company is made up and uses the reserved .example domain.
// Shapes follow each provider's public docs as far as the catalog describes them; no real response was captured.
type Row = { name: string; domain: string; industry: string; employees: number; country: string; tech: string[]; kw: string[] };

const COUNTRY_NAME: Record<string, string> = { US: "United States", GB: "United Kingdom", DE: "Germany", FR: "France", CA: "Canada", NL: "Netherlands" };
const SW = "software development";
const MT = "marketing technology";

/** The seed customers the demo starts with. */
export const DEMO_SEEDS: Row[] = [
  { name: "Ledgerly", domain: "ledgerly.example", industry: SW, employees: 85, country: "US", tech: ["hubspot", "stripe", "segment", "react"], kw: ["revenue operations", "billing", "crm"] },
  { name: "Northgrid", domain: "northgrid.example", industry: SW, employees: 140, country: "US", tech: ["salesforce", "stripe", "segment", "react"], kw: ["sales automation", "revenue operations", "outbound"] },
  { name: "Pipewell", domain: "pipewell.example", industry: MT, employees: 60, country: "GB", tech: ["hubspot", "segment", "react", "snowflake"], kw: ["outbound", "sales automation", "crm"] },
  { name: "Cadence Works", domain: "cadenceworks.example", industry: SW, employees: 210, country: "US", tech: ["salesforce", "hubspot", "stripe"], kw: ["revenue operations", "crm", "forecasting"] },
  { name: "Brightlane", domain: "brightlane.example", industry: MT, employees: 45, country: "US", tech: ["hubspot", "segment", "stripe", "react"], kw: ["outbound", "sales automation"] },
  { name: "Quillstone", domain: "quillstone.example", industry: SW, employees: 320, country: "GB", tech: ["salesforce", "snowflake", "react"], kw: ["revenue operations", "forecasting", "crm"] },
];

/** Companies the two search providers can return. */
export const DEMO_CANDIDATES: Row[] = [
  { name: "Forgepoint", domain: "forgepoint.example", industry: SW, employees: 120, country: "US", tech: ["hubspot", "stripe", "segment", "react"], kw: ["revenue operations", "sales automation", "crm"] },
  { name: "Tallyhouse", domain: "tallyhouse.example", industry: SW, employees: 95, country: "US", tech: ["salesforce", "stripe", "react"], kw: ["revenue operations", "billing", "crm"] },
  { name: "Orbitline", domain: "orbitline.example", industry: MT, employees: 70, country: "GB", tech: ["hubspot", "segment", "snowflake"], kw: ["outbound", "sales automation"] },
  { name: "Meridian Labs", domain: "meridianlabs.example", industry: SW, employees: 180, country: "US", tech: ["salesforce", "hubspot", "segment"], kw: ["forecasting", "revenue operations"] },
  { name: "Sparkwright", domain: "sparkwright.example", industry: MT, employees: 55, country: "US", tech: ["hubspot", "stripe", "react"], kw: ["outbound", "crm", "sales automation"] },
  { name: "Lanternfly", domain: "lanternfly.example", industry: SW, employees: 260, country: "GB", tech: ["salesforce", "snowflake", "react"], kw: ["crm", "forecasting"] },
  { name: "Harborstack", domain: "harborstack.example", industry: SW, employees: 40, country: "CA", tech: ["stripe", "react"], kw: ["billing", "developer tools"] },
  { name: "Wrenfield", domain: "wrenfield.example", industry: "financial services", employees: 900, country: "US", tech: ["salesforce"], kw: ["lending", "compliance"] },
  { name: "Copperkite", domain: "copperkite.example", industry: SW, employees: 150, country: "DE", tech: ["hubspot", "segment", "react"], kw: ["revenue operations", "outbound"] },
  { name: "Mosaic Cloud", domain: "mosaiccloud.example", industry: SW, employees: 2400, country: "US", tech: ["salesforce", "snowflake"], kw: ["enterprise", "crm"] },
  { name: "Pinpoint Pay", domain: "pinpointpay.example", industry: "financial services", employees: 75, country: "FR", tech: ["stripe"], kw: ["payments", "billing"] },
  { name: "Daybreak HR", domain: "daybreakhr.example", industry: "hr tech", employees: 110, country: "US", tech: ["hubspot", "react"], kw: ["payroll", "recruiting"] },
  { name: "Saltmarsh", domain: "saltmarsh.example", industry: MT, employees: 35, country: "NL", tech: ["hubspot", "segment"], kw: ["outbound", "email"] },
  { name: "Ironbark", domain: "ironbark.example", industry: SW, employees: 130, country: "US", tech: ["salesforce", "hubspot", "stripe", "react"], kw: ["sales automation", "crm", "forecasting"] },
  { name: "Glasshouse", domain: "glasshouse.example", industry: SW, employees: 65, country: "GB", tech: ["segment", "snowflake", "react"], kw: ["analytics", "revenue operations"] },
  { name: "Tidewater", domain: "tidewater.example", industry: "logistics", employees: 480, country: "US", tech: [], kw: ["freight"] },
];

const FIRST_SOURCE = [0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 13, 14, 15];
const SECOND_SOURCE = [1, 0, 4, 2, 13, 8, 11, 12, 3, 7, 14];

const band = (n: number) => (n < 11 ? "1-10" : n < 51 ? "11-50" : n < 201 ? "51-200" : n < 501 ? "201-500" : n < 1001 ? "501-1000" : "1001+");

function flat(r: Row) {
  return { name: r.name, domain: r.domain, industry: r.industry, employees: band(r.employees), location: { country: { code: r.country } }, technologies: r.tech, keywords: r.kw, description: `${r.name} sells ${r.kw[0] ?? "software"} software.` };
}

/** A provider-shaped answer for one endpoint. */
export function fixtureBody(endpointId: string, input: Record<string, unknown>): unknown {
  const everyone = [...DEMO_SEEDS, ...DEMO_CANDIDATES];
  if (endpointId === "companyenrich-companies-enrich-get" || endpointId === "hunter-companies-find") {
    const hit = everyone.find((r) => r.domain === input.domain);
    if (!hit) return {};
    return endpointId === "hunter-companies-find" ? { data: { name: hit.name, domain: hit.domain, category: { industry: hit.industry }, metrics: { employees: hit.employees }, geo: { country: COUNTRY_NAME[hit.country] ?? hit.country }, tech: hit.tech, tags: hit.kw } } : flat(hit);
  }
  const size = typeof input.size === "number" ? input.size : 50;
  if (endpointId === "thecompaniesapi-companies-similar") {
    return {
      companies: FIRST_SOURCE.slice(0, size).map((i) => {
        const r = DEMO_CANDIDATES[i];
        return { domain: { domain: r.domain }, about: { name: r.name, industries: [r.industry], totalEmployees: band(r.employees) }, locations: { headquarters: { country: { name: COUNTRY_NAME[r.country] ?? r.country } } }, technologies: { active: r.tech } };
      }),
      meta: { total: FIRST_SOURCE.length },
    };
  }
  if (endpointId === "ai-ark-companies") {
    // This provider returns no technologies in the search answer, so the demo shows gaps being scored as "not available".
    return { data: SECOND_SOURCE.slice(0, size).map((i) => { const r = DEMO_CANDIDATES[i]; return { name: r.name, website: `https://www.${r.domain}`, industry: r.industry, employees: r.employees, country: COUNTRY_NAME[r.country] ?? r.country, keywords: r.kw }; }) };
  }
  return {};
}
