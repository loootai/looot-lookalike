import type { Metadata } from "next";
import { Badge, Table, Td, Th } from "@/components/ui/misc";
import { usd, usdPrecise } from "@/lib/money";
import { getConfig, getSession } from "@/lib/service";
import { ALL_ENDPOINTS, PRICES_AS_OF } from "@/lib/sources";

export const metadata: Metadata = { title: "Scoring and spend" };
export const dynamic = "force-dynamic";

const WHAT: Record<string, string> = {
  industry: "A candidate industry the seeds share. Full marks for the most common seed industry.",
  size: "Employee count inside the seed range scores 1. It falls to 0 at ten times outside the range.",
  technology: "Share of the seeds' shared technologies the candidate also uses, weighted by how many seeds use each.",
  keywords: "Same overlap rule, on keywords.",
  region: "The candidate's country is one the seeds share.",
  agreement: "How many search providers returned the company, and how high they ranked it.",
};

export default async function ScoringPage() {
  const cfg = getConfig();
  const session = await getSession();
  const total = Object.values(cfg.weights).reduce((a, b) => a + b, 0);
  return (
    <div className="max-w-4xl">
      <h1 className="text-20 font-medium tracking-tight">Scoring and spend</h1>
      <p className="mt-1 text-13 text-mute">The weights live in a file you edit (weights.yaml, copied from weights.example.yaml). A signal with no data is left out and the rest are scaled up to fill 100, so a thin record is marked with its coverage, not scored as a miss.</p>

      <div className="mt-4 overflow-x-auto rounded-panel border border-line bg-panel">
        <Table>
          <thead>
            <tr>
              <Th>Signal</Th>
              <Th className="text-right">Weight</Th>
              <Th className="text-right">Share</Th>
              <Th>How it is scored</Th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(cfg.weights).map(([k, w]) => (
              <tr key={k}>
                <Td className="font-medium capitalize">{k}</Td>
                <Td className="num text-right">{w}</Td>
                <Td className="num text-right">{total > 0 ? `${Math.round((w / total) * 100)}%` : "0%"}</Td>
                <Td className="text-12 text-mute">{WHAT[k]}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
      <p className="mt-2 text-12 text-mute">Candidates with less than {Math.round(cfg.minCoverage * 100)}% of the weights available are left out. A trait needs {Math.round(cfg.minSeedShare * 100)}% of the seeds that report it.</p>

      <h2 className="mt-8 text-14 font-medium">looot endpoints and list prices</h2>
      <p className="mt-1 text-12 text-mute">Read from the public catalog on {PRICES_AS_OF}. Search endpoints are billed per returned row.</p>
      <div className="mt-2 overflow-x-auto rounded-panel border border-line bg-panel">
        <Table>
          <thead>
            <tr>
              <Th>Endpoint</Th>
              <Th>Job</Th>
              <Th>Used for</Th>
              <Th className="text-right">Price</Th>
            </tr>
          </thead>
          <tbody>
            {ALL_ENDPOINTS.map((e) => (
              <tr key={e.endpointId}>
                <Td className="num text-12">{e.endpointId}</Td>
                <Td className="num text-12">{e.jobId}</Td>
                <Td className="text-12">{e.label}</Td>
                <Td className="num text-right">
                  {usdPrecise(e.fallbackMicros)} <span className="text-11 text-mute">per {e.unit}</span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>

      <h2 className="mt-8 text-14 font-medium">This session</h2>
      {!session ? (
        <p className="mt-1 text-13 text-mute">No session yet.</p>
      ) : (
        <>
          <p className="mt-1 text-13 text-mute">
            Spent <span className="num">{usd(session.spentMicros)}</span>. {Object.keys(session.pending).length} calls pending. A call still waiting on the provider is pending, never failed, and is read again for free.
          </p>
          <div className="mt-2 overflow-x-auto rounded-panel border border-line bg-panel">
            <Table>
              <thead>
                <tr>
                  <Th>Step</Th>
                  <Th>Endpoint</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Rows</Th>
                  <Th className="text-right">Cost</Th>
                </tr>
              </thead>
              <tbody>
                {session.calls.map((c, i) => (
                  <tr key={i}>
                    <Td>
                      {c.step}
                      <span className="block text-11 text-mute">{c.label}</span>
                    </Td>
                    <Td className="num text-12">{c.endpointId}</Td>
                    <Td>
                      <Badge tone={c.status === "completed" ? "brand" : c.status === "failed" ? "high" : "amber"}>{c.status.replace("_", " ")}</Badge>
                      {c.error ? <span className="mt-0.5 block text-11 text-mute">{c.error}</span> : null}
                    </Td>
                    <Td className="num text-right">{c.rows}</Td>
                    <Td className="num text-right">{usdPrecise(c.costMicros)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
