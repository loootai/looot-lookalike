# Changelog

## Unreleased

- Fix: rows from the AI Ark source were all dropped because the parser did not read its shape (`link.domain`, `summary.name`, `summary.staff.range`, `location.headquarter.country`). A live run charged $0.024 for that call and ranked none of its 17 companies. The parser now reads them, and a test covers the shape.

- Fix: sign-in from Chrome was refused with "Cross-site request refused" (403). The app sends `Referrer-Policy: no-referrer`, so Chrome posts the form with `Origin: null`. The same-origin guard now falls back to `Sec-Fetch-Site` when the origin is `null`.

## 0.1.4

Spend limits, version 2. Before this, a paid step was limited only by the cap per step, an in-memory rate limit and the token balance. Repeating a request could be charged again, nothing limited spend across steps, and two requests started together could both pass the cap.

- Period budget: a daily and a monthly amount (UTC), $10 and $50 by default, saved in `budget.json` next to the session file. The signed-in owner changes it on the new Costs page (`PUT /api/budget`). A request to `/api/seeds` or `/api/search` cannot raise it, and one that carries a budget field is refused.
- Reserve then settle: each paid call reserves its list price under a lock file before it is made, and is skipped if used plus reserved plus the price would pass either budget. The reservation becomes the real cost when the call ends and goes back if the call failed. A call still running keeps its reservation. The next step looks up pending calls with `GET /v1/runs/{id}` and settles them. A reservation that cannot be looked up is released after 24 hours.
- Stored results: a finished call is stored under its stable key (step, endpoint, input, month), so the same request in the same month is answered with no call and no charge.
- The sidebar spend panel and the Costs page show used, reserved and remaining for today and this month. The CLI refuses a run above what is left of the budget unless `--partial` is passed.
- README: the Spending and Securing a deployment sections describe the new limits. The token balance is still the final limit.

Migration: none. This repo has no database. The budget is a new file, `budget.json`, created in the folder of `LOOKALIKE_SESSION` (default `data/`) on first use. Nothing to run. Run one instance on a persistent disk, since the file is not shared between hosts.

## 0.1.3

Admin sign-in for every admin page and route, CSRF protection and a server-side spend cap per step.
