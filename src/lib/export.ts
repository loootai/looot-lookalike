import { usd, usdPrecise } from "./money";
import type { Scored, Session, Traits } from "./types";

function cell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  // A leading = + - @ makes a spreadsheet read the cell as a formula. A quote in front stops that.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The ranked list as CSV, with the reason for each score in one column. */
export function toCsv(ranked: Scored[]): string {
  const head = ["rank", "domain", "name", "score", "coverage", "industry", "employees", "country", "why_similar"];
  const lines = ranked.map((s, i) => [i + 1, s.candidate.domain, s.candidate.name, s.score, s.coverage, s.candidate.industries.join("; "), s.candidate.employees, s.candidate.country, s.lines.filter((l) => l.available && l.points > 0).map((l) => `${l.feature}: ${l.detail}`).join(" | ")].map(cell).join(","));
  return `${head.join(",")}\n${lines.join("\n")}${lines.length > 0 ? "\n" : ""}`;
}

/** A short text of the traits, for the summary line and the markdown report. */
export function traitsText(t: Traits): string[] {
  const list = (xs: { value: string; share: number }[]) => xs.map((x) => `${x.value} (${Math.round(x.share * 100)}%)`).join(", ") || "none shared";
  return [`Industry: ${list(t.industries)}`, `Size: ${t.size ? `${t.size.min} to ${t.size.max} employees` : "no size reported"}`, `Technology: ${list(t.technologies)}`, `Keywords: ${list(t.keywords)}`, `Region: ${list(t.countries)}`];
}

/** The ranked list as markdown, each entry with its breakdown, provider and cost. */
export function toMarkdown(session: Session, ranked: Scored[], top = 25): string {
  const out = [`# Lookalike companies, ${session.createdAt.slice(0, 10)}`, "", `Seeds: ${session.seeds.join(", ")}`, `Spent ${usd(session.spentMicros)}.`, ""];
  if (session.traits) out.push("## Shared traits", "", ...traitsText(session.traits).map((l) => `- ${l}`), "");
  out.push(`## Ranked results (${ranked.length})`, "");
  ranked.slice(0, top).forEach((s, i) => {
    out.push(`### ${i + 1}. ${s.candidate.name ?? s.candidate.domain} (${s.candidate.domain}), score ${s.score}`, "", `Coverage ${Math.round(s.coverage * 100)}% of the weights had data. Row cost ${usdPrecise(s.costMicros)}.`, "");
    for (const l of s.lines) out.push(`- ${l.feature}: ${l.available ? `${l.points} points (similarity ${Math.round(l.similarity * 100)}%, weight ${l.weight}). ${l.detail}. From ${l.provider ?? "n/a"}.` : `not available. ${l.detail}`}`);
    out.push("");
  });
  const bad = session.calls.filter((c) => c.status !== "completed");
  if (bad.length > 0) out.push("## Calls that did not complete", "", ...bad.map((c) => `- ${c.step} ${c.label} on ${c.endpointId}: ${c.status}${c.error ? `. ${c.error}` : ""}`), "");
  return `${out.join("\n")}\n`;
}
