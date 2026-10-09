"use client";

import * as React from "react";
import { AlertCircle, CheckCircle2, ChevronRight, Clock, Download, Play, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChipInput } from "@/components/ui/chips";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { usd, usdPrecise } from "@/lib/money";
import type { QuoteBody } from "@/lib/service";
import type { Scored, Session, TraitValue, Traits } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  demo: boolean;
  initialSession: Session | null;
  initialRanked: Scored[];
  defaultSeeds: string;
  /** Opens the first result, for screenshots and links. */
  openFirst?: boolean;
}

const EMPTY: Traits = { industries: [], technologies: [], keywords: [], countries: [], size: null };

/** Turns the chips back into trait values, keeping the share of values that were already there. */
function withShares(values: string[], before: TraitValue[]): TraitValue[] {
  return values.map((v) => before.find((b) => b.value === v) ?? { value: v, share: 1 });
}

export function Workbench({ demo, initialSession, initialRanked, defaultSeeds, openFirst }: Props) {
  const toast = useToast();
  const dialog = React.useRef<HTMLDialogElement>(null);
  const [session, setSession] = React.useState(initialSession);
  const [ranked, setRanked] = React.useState(initialRanked);
  const [traits, setTraits] = React.useState<Traits>(initialSession?.traits ?? EMPTY);
  const [seedsText, setSeedsText] = React.useState(initialSession ? initialSession.seeds.join("\n") : defaultSeeds);
  const [quote, setQuote] = React.useState<QuoteBody | null>(null);
  const [pendingStep, setPendingStep] = React.useState<"seeds" | "search">("seeds");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const timer = React.useRef<number | undefined>(undefined);

  const openQuote = async (step: "seeds" | "search") => {
    setError(null);
    setQuote(null);
    setPendingStep(step);
    const res = await fetch("/api/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step, seeds: seedsText }) });
    const body = (await res.json()) as QuoteBody & { error?: string };
    if (!res.ok) {
      setError(body.error ?? "Could not read the prices.");
      return;
    }
    setQuote(body);
    dialog.current?.showModal();
  };

  const confirm = async () => {
    if (!quote) return;
    setBusy(true);
    const res = await fetch(pendingStep === "seeds" ? "/api/seeds" : "/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seeds: seedsText, confirmedMaxMicros: quote.totalMicros }) });
    const body = (await res.json()) as { session?: Session; ranked?: Scored[]; error?: string };
    setBusy(false);
    dialog.current?.close();
    if (!res.ok || !body.session) {
      setError(body.error ?? "The step failed.");
      return;
    }
    setSession(body.session);
    setRanked(body.ranked ?? []);
    if (body.session.traits) setTraits(body.session.traits);
    toast({ text: pendingStep === "seeds" ? `${body.session.seedResults.filter((r) => r.company).length} of ${body.session.seeds.length} seeds enriched.` : `${body.ranked?.length ?? 0} companies ranked.` });
  };

  const rescore = (next: Traits) => {
    setTraits(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      const res = await fetch("/api/score", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      const body = (await res.json()) as { ranked?: Scored[]; error?: string };
      if (res.ok && body.ranked) {
        setRanked(body.ranked);
        setError(null);
      } else setError(body.error ?? "Could not score.");
    }, 350);
  };

  const enriched = session?.seedResults.filter((r) => r.company).length ?? 0;
  const hasCandidates = (session?.candidates.length ?? 0) > 0;

  return (
    <div className="mx-auto max-w-5xl px-4 pb-20 pt-6 md:px-6">
      <header className="mb-5">
        <h1 className="text-20 font-medium tracking-tight">Lookalike companies</h1>
        <p className="mt-1 text-13 text-mute">Give 3 to 20 of your best customers. The app finds what they share, searches for companies like them, and explains every score.</p>
      </header>

      {error ? (
        <p role="alert" className="mb-4 flex items-start gap-2 rounded-panel border border-high bg-high-soft px-3 py-2 text-13 text-high">
          <AlertCircle className="mt-0.5 size-4 shrink-0" /> {error}
        </p>
      ) : null}

      <section aria-labelledby="seeds-h" className="rounded-panel border border-line bg-panel p-4">
        <h2 id="seeds-h" className="text-14 font-medium">1. Seeds</h2>
        <label htmlFor="seeds" className="mt-2 block text-12 text-mute">
          Domains, one per line or comma separated
        </label>
        <textarea id="seeds" value={seedsText} onChange={(e) => setSeedsText(e.target.value)} spellCheck={false} rows={5} className="num mt-1.5 w-full resize-y rounded-control border border-line-strong bg-panel p-2.5 text-12 leading-5 hover:border-mute focus-visible:border-emerald focus-visible:outline-offset-0" />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={() => openQuote("seeds")}>
            <Play /> Enrich seeds
          </Button>
          <span className="text-12 text-mute">One company lookup per seed. The price is shown before anything runs.</span>
        </div>
        {session ? (
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Seed status">
            {session.seedResults.map((r) => (
              <li key={r.domain} title={r.error} className={cn("inline-flex items-center gap-1 rounded-control border px-2 py-1 text-12", r.status === "completed" && r.company ? "border-line" : "border-medium bg-medium-soft text-medium")}>
                {r.company ? <CheckCircle2 className="size-3 text-emerald" /> : r.status === "pending" ? <Clock className="size-3" /> : <AlertCircle className="size-3" />}
                <span className="num">{r.domain}</span>
                {r.status === "pending" ? <span>pending</span> : !r.company ? <span>{r.status.replace("_", " ")}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {session?.traits ? (
        <section aria-labelledby="traits-h" className="mt-4 rounded-panel border border-line bg-panel p-4">
          <h2 id="traits-h" className="text-14 font-medium">2. What the seeds share</h2>
          <p className="mt-1 text-12 text-mute">
            From {enriched} enriched seeds. Edit anything. The ranking below updates without a looot call. Values show the share of seeds that have them.
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {(
              [
                ["industries", "Industry"],
                ["technologies", "Technology"],
                ["keywords", "Keywords"],
                ["countries", "Region (country code)"],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <label htmlFor={`t-${key}`} className="text-12 font-medium">
                  {label}
                </label>
                <div className="mt-1">
                  <ChipInput id={`t-${key}`} label={label} value={traits[key].map((t) => t.value)} onChange={(v) => rescore({ ...traits, [key]: withShares(key === "countries" ? v.map((x) => (x.length === 2 ? x.toUpperCase() : x)) : v.map((x) => x.toLowerCase()), traits[key]) })} placeholder="None shared" />
                </div>
                <p className="num mt-1 text-11 text-mute">{traits[key].map((t) => `${t.value} ${Math.round(t.share * 100)}%`).join(", ")}</p>
              </div>
            ))}
            <div>
              <span className="text-12 font-medium">Employees</span>
              <div className="mt-1 flex items-center gap-2">
                <Input type="number" min={0} aria-label="Minimum employees" value={traits.size?.min ?? ""} placeholder="Min" className="w-28" onChange={(e) => rescore({ ...traits, size: e.target.value === "" && !traits.size ? null : { min: Number(e.target.value), max: traits.size?.max ?? Number(e.target.value) } })} />
                <span className="text-mute">to</span>
                <Input type="number" min={0} aria-label="Maximum employees" value={traits.size?.max ?? ""} placeholder="Max" className="w-28" onChange={(e) => rescore({ ...traits, size: { min: traits.size?.min ?? 0, max: Number(e.target.value) } })} />
              </div>
              <p className="mt-1 text-11 text-mute">Range of the seeds. A range such as 51-200 counts as its midpoint.</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-3">
            <Button variant="primary" onClick={() => openQuote("search")}>
              <Search /> {hasCandidates ? "Search again" : "Find similar companies"}
            </Button>
            <span className="text-12 text-mute">Searches the sources in your weights file. Priced before it runs. Editing traits above is free.</span>
          </div>
        </section>
      ) : null}

      {hasCandidates ? (
        <section aria-labelledby="results-h" className="mt-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 id="results-h" className="text-14 font-medium">
              3. Ranked results <span className="num ml-1 text-mute">{ranked.length}</span>
            </h2>
            <Button asChild variant="secondary" size="sm">
              <a href="/api/export" download>
                <Download /> Export CSV
              </a>
            </Button>
          </div>
          <ol className="overflow-hidden rounded-panel border border-line bg-panel">
            {ranked.map((r, i) => (
              <li key={r.candidate.domain} className="border-b border-line last:border-b-0">
                <details className="group" open={openFirst && i === 0 ? true : undefined}>
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-hover">
                    <span className="num w-6 shrink-0 text-right text-12 text-mute">{i + 1}</span>
                    <ChevronRight className="size-4 shrink-0 text-mute transition-transform group-open:rotate-90" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-14 font-medium">
                        {r.candidate.name ?? r.candidate.domain} <span className="num text-12 font-normal text-mute">{r.candidate.domain}</span>
                      </span>
                      <span className="block truncate text-12 text-mute">{[r.candidate.industries[0], r.candidate.employees ? `about ${r.candidate.employees} employees` : null, r.candidate.country].filter(Boolean).join(", ") || "No firmographics returned"}</span>
                    </span>
                    {r.coverage < 1 ? <Badge tone="amber">{Math.round(r.coverage * 100)}% data</Badge> : null}
                    <span className="flex w-28 shrink-0 items-center gap-2">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-hover" aria-hidden>
                        <span className="block h-full rounded-full bg-emerald" style={{ width: `${r.score}%` }} />
                      </span>
                      <span className="num w-10 text-right text-13 font-medium">{r.score}</span>
                    </span>
                  </summary>
                  <div className="overflow-x-auto border-t border-line bg-page px-4 py-3 md:pl-14">
                    <table className="w-full min-w-[40rem] text-left text-12">
                      <thead>
                        <tr className="text-11 text-mute">
                          <th className="pb-1 pr-3 font-medium">Signal</th>
                          <th className="pb-1 pr-3 text-right font-medium">Weight</th>
                          <th className="pb-1 pr-3 text-right font-medium">Match</th>
                          <th className="pb-1 pr-3 text-right font-medium">Points</th>
                          <th className="pb-1 pr-3 font-medium">Why</th>
                          <th className="pb-1 pr-3 font-medium">Provider</th>
                          <th className="pb-1 text-right font-medium">Row cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.lines.map((l) => (
                          <tr key={l.feature} className={cn("border-t border-line align-top", !l.available && "text-mute")}>
                            <td className="py-1.5 pr-3 font-medium capitalize">{l.feature}</td>
                            <td className="num py-1.5 pr-3 text-right">{l.weight}</td>
                            <td className="num py-1.5 pr-3 text-right">{l.available ? `${Math.round(l.similarity * 100)}%` : "n/a"}</td>
                            <td className="num py-1.5 pr-3 text-right">{l.available ? l.points : "0"}</td>
                            <td className="py-1.5 pr-3">{l.detail}</td>
                            <td className="num py-1.5 pr-3 text-11">{l.provider ?? ""}</td>
                            <td className="num py-1.5 text-right">{l.provider && l.costMicros > 0 ? usdPrecise(l.costMicros) : ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="mt-2 text-11 text-mute">
                      Score {r.score} of 100, over the {Math.round(r.coverage * 100)}% of the weights that had data. Unavailable signals are left out, not counted as zero.
                    </p>
                  </div>
                </details>
              </li>
            ))}
          </ol>
        </section>
      ) : session?.traits ? (
        <p className="mt-4 rounded-panel border border-dashed border-line-strong p-6 text-center text-13 text-mute">No candidates yet. Run the search to get a ranked list.</p>
      ) : null}

      <dialog ref={dialog} className="m-auto w-[min(34rem,calc(100vw-2rem))] rounded-panel border border-line bg-panel p-0 text-ink shadow-pop backdrop:bg-black/40">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-14 font-medium">{pendingStep === "seeds" ? "Price of enriching the seeds" : "Price of the search"}</h2>
          <button type="button" aria-label="Close" onClick={() => dialog.current?.close()} className="flex size-8 items-center justify-center rounded-control text-mute hover:bg-hover">
            <X className="size-4" />
          </button>
        </div>
        <div className="max-h-[55dvh] overflow-auto px-4 py-3">
          {quote ? (
            <>
              <ul className="divide-y divide-line text-13">
                {quote.calls.map((c, i) => (
                  <li key={i} className="flex items-start justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="num block truncate text-12">{c.endpointId}</span>
                      <span className="block truncate text-12 text-mute">{c.label}</span>
                    </span>
                    <span className="num shrink-0">{usdPrecise(c.quotedMicros)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-12 text-mute">
                Search calls are quoted at their row limit, so the real charge can be lower. {quote.priceSource === "catalog" ? "Live prices." : `List prices dated ${quote.pricesAsOf.slice(0, 10)}.`} Cap {usd(quote.capMicros)}. A failed call costs nothing.
                {demo ? " Demo mode: nothing is called or charged." : ""}
              </p>
            </>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
          <span className="num text-14 font-medium">{quote ? `At most ${usdPrecise(quote.totalMicros)}` : ""}</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => dialog.current?.close()}>
              Cancel
            </Button>
            <Button variant="primary" onClick={confirm} disabled={!quote || busy}>
              {busy ? "Running" : "Run"}
            </Button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
