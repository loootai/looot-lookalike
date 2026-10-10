<p align="center"><img src="assets/hero.png" alt="looot-lookalike" width="100%"></p>

# looot-lookalike

[![License](https://img.shields.io/github/license/loootai/looot-lookalike)](LICENSE) [![Release](https://img.shields.io/github/v/release/loootai/looot-lookalike)](https://github.com/loootai/looot-lookalike/releases) [![Docs](https://img.shields.io/badge/docs-docs.looot.ai-12A06A)](https://docs.looot.ai)

An open-source alternative to Ocean.io style lookalike company search. Give it 3 to 20 domains of your best customers. It enriches them through looot, derives what they share (industry, size, technology, keywords, region), searches for similar companies with looot's company search providers, scores each result with a breakdown you can read, and returns a ranked list. You can edit the shared traits and the ranking updates without another paid call.

Ocean.io's own pricing page refused automated reading on 2026-10-10 (HTTP 403). Third-party estimates from review sites run from about $32 to $79 a month. None of them is an Ocean figure, so check Ocean's page before you compare. looot-lookalike has no subscription. A run costs the list price of its calls, shown before it starts.

![Seeds, shared traits and ranked results, dark](docs/screenshots/results-dark.png)
![Seeds and shared traits, light](docs/screenshots/home-light.png)

## Try it without an account

```bash
npm install --ignore-scripts
npm run demo            # web UI on http://localhost:3230, sample data, no token
npm run lookalike -- --demo --out results-out
```

The demo uses made-up companies on the reserved `.example` domain.

## Run it for real

```bash
cp .env.example .env.local          # set LOOOT_TOKEN
cp weights.example.yaml weights.yaml
printf "acme.com\nglobex.com\ninitech.com\n" > seeds.txt
npm run lookalike -- --seeds seeds.txt --dry-run   # prints every call and the list-price total, calls nothing
npm run lookalike -- --seeds seeds.txt --cap 1 --out results-out
npm run dev                         # web UI on http://localhost:3000
```

Create an agent token at https://looot.ai/settings. Top up from $5. A failed call costs nothing.

CLI options: `--seeds <file>` or `--domains a,b,c`, `--weights`, `--out`, `--top`, `--cap` (dollars, default 1), `--dry-run`, `--demo`. Each run writes `lookalikes-<timestamp>.json`, `.csv` and `.md`. The markdown has the shared traits and, for each result, the breakdown with provider and cost.

## How it works

1. Enrich each seed by domain, one lookup per seed.
2. Derive traits. A value counts as shared when at least 40% of the seeds that report it have it (`minSeedShare`). Size is the min and max employee count of the seeds.
3. Search. Each configured source returns up to 50 candidates for the seeds. Companies found by both sources are merged and the seeds themselves are removed.
4. Optionally enrich the top candidates (`enrichTop`) to fill missing fields.
5. Score and rank.

## The score

Six signals, weights in `weights.yaml`:

| Signal | Match rule |
| --- | --- |
| industry | A candidate industry the seeds share. Full marks for the most common seed industry. |
| size | Inside the seed employee range is 1, falling to 0 at ten times outside it. |
| technology | Share of the seeds' shared technologies the candidate also uses, weighted by how many seeds use each. |
| keywords | The same overlap rule on keywords. |
| region | The candidate's country is one the seeds share. |
| agreement | How many search providers returned the company and how high they ranked it. |

Each result lists every signal with its weight, match, points, the reason in words, the provider that supplied the value and the list price of that row. A signal with no data on the candidate is left out and the others are scaled to fill 100, so a thin record is shown with its coverage ("85% data") instead of being scored as a miss. Candidates under `minCoverage` (35% of the weights) are dropped. Ranges such as "51-200" count as their midpoint, and the UI says so.

## Signals, providers and cost

Prices are looot list prices from the public catalog, read on 2026-10-10.

| Step | looot job | Endpoint | List price |
| --- | --- | --- | --- |
| Enrich a seed (default) | company.enrich | companyenrich-companies-enrich-get | $0.0098 per call |
| Enrich a seed (option) | company.enrich | hunter-companies-find | $0.0049 per call |
| Search, similar to domains | company.similar | thecompaniesapi-companies-similar | $0.0019 per result |
| Search, lookalike of up to 5 domains | company.lookalike | ai-ark-companies | $0.0012 per result |

A typical run, 6 seeds and 50 rows from each source, is at most $0.2138 at list price. Ten seeds is at most $0.253. `enrichTop: 10` adds up to $0.098. The sample run reads $0.10 because the sources returned fewer than 50 rows. No real run was priced.

## How money is handled

- The quote is shown before any paid action: `--dry-run` in the CLI, a price dialog in the UI that sends back the amount you confirmed. If the live price is higher, nothing is called.
- One cap covers a CLI run (`--cap`). The UI applies `LOOKALIKE_CAP_USD` to each step. A call that would cross it is skipped and listed as `skipped_budget`.
- Every call has a stable `idempotencyKey` made from the step, the endpoint, a hash of the input and the month. Repeating a lookup in the same month replays the stored run and does not charge twice.
- A call still running when waiting stops is `pending`, never failed. Its run id is stored and read again, free.
- Calls are pinned to one endpoint with no provider fallback, so the price is the one quoted.
- Editing traits and re-scoring makes no looot call.

## Install for agents

Copy `skills/looot-lookalike` into `.claude/skills/` (Claude Code) or point your agent at `llms.txt`. The skill quotes with `--dry-run`, runs with a cap, and reports the shared traits first so the user can correct them.

## What is not tested

- No paid looot run was made. Response parsing is built from each provider's public docs and the fixtures in `src/demo/fixtures.ts`. The normalizer reads several field names per value and leaves a field empty when it finds none, but no real response body was checked. Expect to adjust it on the first real run.
- The input names for the two search endpoints (`domains`, `size`, `lookalikeDomains`, `page`) come from the catalog's parameter list, not from a live call.
- Some providers return employee counts as ranges, countries as names, and industries in their own vocabulary. The country map covers about 50 countries. Industry names are compared as lower-cased text, so "Software" and "Software Development" do not match.
- 43 unit tests cover the normalizer, traits, scoring, the engine (cap, idempotency keys, pending, failed seeds), export, the looot client and the CLI, with HTTP mocked.

## What was dropped

Ocean.io style contact discovery and CRM sync are not part of this repo. looot has the email and phone endpoints, and `loootai/looot-csv-enrich` adds them to a CSV of the ranked domains. Revenue is not a scored signal because the chosen search providers do not return it consistently.

## Develop

```bash
npm test && npm run typecheck && npm run lint && npm run build
npm run leak-scan
```

`git config core.hooksPath .githooks` runs the leak scan before every commit.

## Licence

MIT. Copyright looot.

## Related

Other open-source projects built on [looot](https://looot.ai):

- [looot-intent](https://github.com/loootai/looot-intent): account intent and buying-stage scoring (6sense)
- [looot-score](https://github.com/loootai/looot-score): lead and ICP fit scoring (MadKudu)
- [looot-reveal](https://github.com/loootai/looot-reveal): which companies visit your site (RB2B, Clearbit Reveal)
- [looot-techstack](https://github.com/loootai/looot-techstack): website technologies from several providers (BuiltWith, Wappalyzer)
- [looot-signals](https://github.com/loootai/looot-signals): hiring, funding and news triggers (TheirStack, Harmonic)
- [looot-ads](https://github.com/loootai/looot-ads): competitor ad board (Foreplay)
- [looot-reviews](https://github.com/loootai/looot-reviews): review themes and weak spots (ReviewTrackers)
- [looot-battlecards](https://github.com/loootai/looot-battlecards): competitor battlecards (Klue, Crayon)
- [looot-mentions](https://github.com/loootai/looot-mentions): brand and keyword listening (Brand24)
- [looot-warm-leads](https://github.com/loootai/looot-warm-leads): warm leads from LinkedIn intent signals (Gojiberry)
- [looot-crm](https://github.com/loootai/looot-crm): a small CRM with buying signals built in
- [looot-seo](https://github.com/loootai/looot-seo): self-hosted SEO workspace
- [looot-monitor](https://github.com/loootai/looot-monitor): brand and competitor monitoring with alerts
