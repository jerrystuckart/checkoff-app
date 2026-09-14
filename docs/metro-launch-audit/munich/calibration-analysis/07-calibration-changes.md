# Recommended Winston Calibration Changes (Deliverable I) — Part 7

Each safeguard is placed at the earliest stage that could plausibly catch it, with later stages kept as a genuine second safety net rather than the only check — per the task's own instruction not to force every lesson into M5_75.

## M0 Metro Definition
- Make `geographicScope` a **structured, machine-checkable** field (core-district list + explicit in/out municipality list with a boolean or date-gated status), not free narrative text. Munich's `m0.json` says Dachau/Starnberg are excluded "for this initial launch," and nothing anywhere records that this was later reversed — a future automated read of `m0.json` would get a wrong answer today.
- Add an explicit "boundary revision" log entry format so a manual, out-of-pipeline expansion (like Jerry's Bulk Add wave2) leaves a trace in the artifact of record, not just in production data.

## M1 Geography Map
- Require enumeration against an authoritative administrative-district source for the core city (Munich has 25 Stadtbezirke; Winston's original map found 10) — treat "fewer than half of the real districts" as a hard M1 completeness failure, not a pass.
- Add a distinct, separately-gated "surrounding metro municipality" pass, driven only by M0's explicit in/out decision (not ad hoc).
- Add a minimum-viable-item-per-neighborhood expectation at plan time (Munich ended with 16/36 neighborhoods at exactly 1 item) so "reached a named place" and "genuinely covered a place" are tracked as different outcomes from the start.

## M2 Category Coverage Plan
- Extend `DEFAULT_CATEGORY_COVERAGE_PLAN` to either formally add a "Play" category or specify the exact normalization rule folding Play-shaped candidates (immersive/attraction-style leisure — planetariums, indoor surf/wave parks, escape-room-style challenges) into Adventure/Sports, so a category can never silently exist outside governance the way it did in Munich.

## M3 Broad Discovery
- No specific new Munich-derived requirement beyond what M4/M5/M5.75 already cover — broad discovery's quality in Munich (via the external Bulk Add sourcing) was actually strong; the failures were downstream (dedup, name hygiene, ownership capture), not in the discovery breadth itself.

## M4 Coverage Audit
- Confirm `auditCoverage` (already composed into `seedPortfolioAudit.ts`) is actually invoked with Munich-scale category/geography targets, not just Arts & Culture's band — Shopping/Sports/Social all sit below `defaultMetroManifest.ts`'s own `healthyTarget` live today (12/6, 4/5, 2/4 respectively) despite being nominally "above minimum," which is exactly the kind of gap M4/M5's loop should keep dispatching against.

## M5 Targeted Deep Dives
- This is the natural home for actually populating a `research_verifier` evidence contract with ownership type and secret-claim evidence — today it populates neither (confirmed via `seedPortfolioAudit.ts`'s own code comment). This is the single highest-leverage remaining gap identified in this whole analysis.
- Add a name-hygiene check to the deep-dive verification pass: flag any candidate `name` field that reads as a sentence/clause rather than a proper noun (Munich's worst examples — `'Flaucher – riverside leisure stretch on the Isar with beer garden, barbecues, swimming and natural setting'` — are unambiguous once you look for run-on names specifically).
- Add an evidence-tier-aware scoring adjustment: wave1's 13 "verify during intake" candidates (18% of the accepted pool) received the same score as fully-sourced candidates — a future scoring rubric should visibly discount or separately flag unverified-source candidates rather than average them in silently.

## M6 Quality Verification
- Add a combined-business check: flag any candidate whose name or claim text contains two distinct proper-noun business names joined by "and"/"or" (Munich's `'Beirut Beirut and Backsteinchen at Luise-Kiesselbach-Platz'` is the concrete case).

## M5_75 Seed Portfolio Audit
- Already directly addresses: category percentage/absolute-minimum gating (`categoryPolicy.ts`), duplicate-venue clustering before editorial spend (`seedDuplicateNormalization.ts`), generic-action rejection (`checkDistinctiveExperience` via `evaluateSeedCandidate`), and the core "validate portfolio shape before expensive editorial writing" ordering failure (Failure 11 in `05-pipeline-failure-stage-mapping.md`) — no further Munich-derived change is recommended for this stage's own logic; its current gaps (ownership/secret evidence) are gaps in an *upstream* dependency (M5's evidence contract), not in M5_75 itself.
- One addition worth considering: when `detectSeedDuplicateClusters` flags a `SAME_NORMALIZED_NAME` cluster, the current design routes every member to HOLD uniformly (correct per its own doc — never silently merge or silently treat as reviewed). Munich's Kunst Oase pair suggests it may be worth recording, at cluster-detection time, whether the clustered claims describe the same physical sub-location/experience or different ones — not to auto-resolve, but to give a human reviewer a head start distinguishing "true duplicate" from "two real experiences, same venue" faster. This is a UX/efficiency suggestion, not a correctness gap.

## M6.5 CheckOff Editor
- Add an explicit difficulty-variance requirement. Every one of Munich's 184 live items — the original 70 AND everything the Bulk Add process added — is `difficulty=1`. This was never a deliberate editorial judgment call; it was a hardcoded literal in the insertion SQL template. M6.5 needs a rubric (e.g., difficulty 1 = walk-in/no-planning; 2 = requires timing/reservation/specific-hours; 3 = requires a physical/skill challenge or advance booking) and should be required to actually vary it.
- Wire the (currently unpopulated) secret-evidence output from M5/M5.75 into `is_secret`/`secret_reveal_text` — right now there is no field-level mechanism (wave2's own INSERT statements don't even list these columns) for a verified secret to make it into production even if M5 started supplying evidence.

## M7 Item Certification / M7.5 Tag Assignment
- No Munich-specific gap identified beyond what's already covered above; tag counts (8 tags per item) were consistently and correctly enforced in every SQL artifact read (cleanup SQL, wave2 SQL) via `RAISE EXCEPTION` postflight checks — this discipline should be preserved as a model for other stages, not changed.

## M8 Batch Certification / M8.5 Catalog Pruning
- Add a portfolio-level difficulty-distribution check here as a second safety net (in addition to the M6.5 rubric) — e.g., flag/warn if >90% of a metro's certified catalog shares one difficulty value, catching the case where M6.5's rubric is skipped or a bulk-insert path (like wave2's SQL) bypasses editorial judgment entirely.
- Add a portfolio-level neighborhood-depth check (flag neighborhoods at ≤1 item as a pruning-stage warning, not necessarily a blocker — 16/36 in Munich today).

## M8.75 Catalog Voice Pass
- No Munich-specific finding — voice/tone consistency was not evaluable from the artifacts available (see `08-data-gaps-and-next-steps.md`).

## Metro Finisher (Deep Research / Integration / Packet Execution)
- This is a plausible home for a *late* ownership/ ownership-evidence backfill pass specifically targeting the `UNKNOWN_REQUIRES_VERIFICATION` volume that M5_75's commercial-mix gate will otherwise just report and move past — i.e., if M5's evidence contract isn't ready in time for a given metro launch, Metro Finisher could be the fallback stage that resolves ownership for the highest-value candidates before final certification, since it already does late negative-space research on an already-written catalog.

## M9 Home List Mirror
- No Munich-specific gap identified in the mirror mechanism itself; `listFitScoring.ts`'s catalog/list separation (an item can score zero fit for every themed list and still be a valid catalog item) is directly relevant infrastructure for Fall 30/themed-list membership questions the task brief raised in Failure 10, but this was not evaluable without reading Munich's actual list definitions (out of scope here, flagged in `08-data-gaps-and-next-steps.md`).

## M10 Metro Launch Certification
- Add an explicit m0.json-vs-live-neighborhood reconciliation check as a launch-certification gate: if the live neighborhood set contains any municipality the metro-definition artifact records as out-of-scope, block certification until the artifact is updated or the neighborhood is confirmed a deliberate expansion. This directly targets the Dachau/Starnberg contradiction found in this analysis and would prevent it from silently recurring for any future metro.
