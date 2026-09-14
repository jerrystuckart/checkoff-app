# Munich Gold-Standard Regression Fixture Proposal (Deliverable H) — Part 6

**Status: a standalone fixture file has been created. It is NOT wired into any test or pipeline code.** Per the task's own instruction, creating this file is treated as data/test-fixture authoring, not a behavior change, and no existing test file references it.

**File:** `agent-service/playbooks/__fixtures__/munichGoldStandard.ts`

## What it contains

22 entries, each shaped as a `SeedCandidateInput` (the real interface consumed by `seedPortfolioAudit.ts`'s `evaluateSeedCandidate`), covering every case the task brief asked for:

- Strong independent restaurant with a specific order (Gaststätte Großmarkthalle)
- Strong café/bakery (Café Frischhut)
- Strong bar/nightlife (SPIN Listening Bar)
- Strong retail/maker (Magnus Bauch)
- Strong play/adventure/wellness (DAV Kletter- und Boulderzentrum Thalkirchen)
- Essential Arts & Culture item (Asamkirche)
- Genuine secret mechanic with evidence (HiT Bar — synthetic evidence record, since no real Munich candidate has ever had a populated evidence field)
- "Hidden gem" wording that is not actually secret (Alva Morgaine)
- Duplicate venue with slightly different wording — a real pair (Vereinsheim x2)
- Two valid distinct experiences at one venue — a real pair (Kunst Oase x2)
- Improperly combined businesses (Beirut Beirut and Backsteinchen)
- Malformed venue name (Flaucher, the most extreme real example found)
- Generic "visit"/"check out" action (Goldmarie)
- National chain / unsuitable commercial candidate (synthetic — no real Munich chain candidate exists in any artifact)
- Missing ownership evidence (Fausto Kaffeerösterei, representative of all 184 live items)
- Missing Place ID (Steinheil 16, representative of 73% of live items)
- Central Munich neighborhood (Man Versus Machine)
- Outer neighborhood (Giesinger Bräustüberl)
- Surrounding metro municipality (Dachau Palace — deliberately chosen to also carry the m0.json boundary-contradiction finding)
- Candidate that appropriately receives HOLD (a third Kunst Oase proposal)
- Candidate that appropriately receives REJECT (Kunstareal Munich)

Every entry's `provenance` field states whether it is a close paraphrase of a real Munich item/candidate or a synthetic entry modeled on a documented pattern (used only where no real Munich example existed — national chain, and the genuine-secret-with-evidence case, since no real Munich candidate has ever carried a populated evidence record). No production secrets, credentials, or personal information are included — every entry is a public venue name and a public-style CheckOff description, several already published live in the app.

## What the fixture deliberately does NOT do

- It does not assert anything — no `test()`, no `assert.equal()`. Each entry carries an `expectedVerdictNote` string documenting what a *correct* evaluation should conclude, for a human (or a future test author) to turn into a real assertion.
- It does not attempt to be exhaustive against the full 184-item live catalog — it is deliberately small and representative, per the task's own instruction ("capture representative examples rather than copying the entire production catalog unnecessarily").
- It does not modify `seedPortfolioAudit.test.ts`, `categoryPolicy.test.ts`, `seedDuplicateNormalization.ts`, or any other test file. It is a new, standalone file only.

## Recommended next step (explicitly out of scope for this task, listed for `08-data-gaps-and-next-steps.md` / Deliverable K)

A follow-up commit should add `agent-service/playbooks/munichGoldStandard.test.ts` that imports `MUNICH_GOLD_STANDARD_CANDIDATES`, runs each through `evaluateSeedCandidate` (with a duplicate-cluster set built via `detectSeedDuplicateClusters`), and asserts the resulting verdict matches the case's intent (READY for the strong/central entries, REJECT for Goldmarie/Kunstareal Munich/Beirut Beirut, HOLD for the Kunst Oase/Vereinsheim pairs). This would turn tonight's Munich forensic analysis into a permanent, codebase-native regression suite that fails loudly if a future change to `checkDistinctiveExperience`, `detectSeedDuplicateClusters`, or `categoryPolicy.ts` regresses on any of Munich's own real historical failure modes. This is intentionally not done as part of this task (analysis + proposal only, per the task's constraints).
