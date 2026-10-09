---
name: looot-lookalike
description: Find companies similar to a user's best customers through looot, with an explainable score for each. Use when the user gives customer domains and wants a lookalike list or a target account list.
---

# looot-lookalike

Input is 3 to 20 seed domains. Output is a ranked list where each score lists its signals, weights, providers and row costs.

1. Check `LOOOT_TOKEN` is set. If not, tell the user to create an agent token at https://looot.ai/settings. Do not ask them to paste it into chat.
2. Show the price first: `npm run lookalike -- --domains a.com,b.com,c.com --dry-run`. Report the total. Ask for a go-ahead when it is above $0.50.
3. Run it with a cap: `npm run lookalike -- --domains a.com,b.com,c.com --cap 1 --out results-out`. A seeds file works too: `--seeds seeds.txt`.
4. Read the `.md` file in `results-out/`. Report the shared traits first, so the user can correct them, then the top 10 with their "why similar" lines and the amount spent.
5. If a seed failed or a call is pending, say so. Pending means still running at the provider; it is read again for free on the next run. Do not report it as failed.

Scoring weights live in `weights.yaml` (copy `weights.example.yaml`). A signal with no data is left out of the score and shown as a lower coverage percentage. Use `--demo` to try the flow with sample companies and no token.
