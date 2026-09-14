# Pipeline Failure → Stage Mapping (Deliverable G) — Part 5

Driver stage sequence for reference: `M0_METRO_DEFINITION → M1_GEOGRAPHY_MAP → M2_CATEGORY_COVERAGE_PLAN → M3_BROAD_DISCOVERY → M4_COVERAGE_AUDIT ⇄ M5_TARGETED_DEEP_DIVES → M6_QUALITY_VERIFICATION → M5B_REPLACEMENT → M5_75_SEED_PORTFOLIO_AUDIT → M6_5_CHECKOFF_EDITOR → M7_ITEM_CERTIFICATION → M7_5_TAG_ASSIGNMENT → M8_BATCH_CERTIFICATION → M8_5_CATALOG_PRUNING → M8_75_CATALOG_VOICE_PASS → METRO_FINISHER_* → M9_HOME_LIST_MIRROR → M10_METRO_LAUNCH_CERTIFICATION`.

---

### Failure 1 — Missing neighborhoods (only 10 of 25+ real Munich Stadtbezirke, no surrounding-municipality tier at all)

- **What happened:** Winston's original geography covered under half of Munich's real administrative districts and none of the surrounding municipalities that later proved commercially valuable (Erding, Freising, Starnberg, etc.).
- **Should have been caught by:** M1_GEOGRAPHY_MAP.
- **Why it wasn't:** `m0.json`'s own `geographicScope` field shows this was a *deliberate* initial-launch narrowing ("candidates for a later expansion, not this build"), not an M1 miss — M1 executed the scope M0 gave it. The real gap is that M0's narrowing decision was never revisited or reconciled with the record once Jerry executed the "later expansion" (see `03-category-geography-comparison.md`'s boundary contradiction).
- **Does M5_75 address it now?** No — M5_75 operates on the candidate seed pool, downstream of M1's geography map; it cannot invent neighborhoods M1 never defined. `seedPortfolioAudit.ts`'s `auditCoverage` (imported from `metroLaunch.ts`) audits candidate coverage *against* a coverage plan, it does not generate geography.
- **What's still needed:** M0/M1 need an explicit, two-tier geography output (core-city districts + an explicit in/out decision per surrounding municipality) that gets written back to the metro-definition artifact whenever the decision changes — not a one-time narrative field that silently goes stale.
- **Regression fixture:** `munichGoldStandard.ts`'s `OUTER_NEIGHBORHOOD_CANDIDATE` and `SURROUNDING_MUNICIPALITY_CANDIDATE` entries (see `06-gold-standard-fixture-proposal.md`).

### Failure 2 — Category imbalance (Arts & Culture overconcentration, weak Shopping/Sports/Social)

- **What happened:** original 70 skewed heavily Arts & Culture per the task brief; wave1 CSV shows almost no Shopping/Sports/Social candidates either.
- **Should have been caught by:** M2_CATEGORY_COVERAGE_PLAN (setting targets) and M4_COVERAGE_AUDIT (measuring against them).
- **Why it wasn't:** No evidence M2/M4 ran with real percentage-band guardrails at Munich's original build time — `categoryPolicy.ts`'s `DEFAULT_CATEGORY_PERCENTAGE_BANDS` (only Arts & Culture has an explicit 3–30% band today) is dated to tonight's commits, i.e. it did not exist during Munich's original build.
- **Does M5_75 address it now?** Yes, directly — `categoryPolicy.ts`'s `evaluateCategoryPolicies` + `categoryPolicyGatePasses` would flag a >30% Arts & Culture share as `FLAG_OVERCONCENTRATION` (a non-blocking warning, matching the codebase's existing `CATEGORY_OVERREPRESENTED` precedent) and would `FAIL_ABSOLUTE_MINIMUM`/`FAIL_PERCENTAGE_BAND` a catalog with too few Shopping/Sports/Social candidates before M6.5 spends editorial effort on an imbalanced set.
- **What's still needed:** the live "Play" category finding (`03-category-geography-comparison.md`) shows candidates can still drift into an ungoverned category name that `DEFAULT_CATEGORY_COVERAGE_PLAN` doesn't recognize at all — `evaluateCategoryPolicies` only evaluates named policies; an uncategorized/mis-named category can currently slip through silently. A normalization step mapping raw candidate category strings onto the canonical 11 (or a deliberate 12th) before policy evaluation is not yet confirmed to exist.
- **Regression fixture:** `ESSENTIAL_ARTS_CULTURE_ITEM` capped alongside a high-volume Food & drink set in the fixture's category mix.

### Failure 3 — Weak commercial mix / no ownership verification

- **What happened:** neither the original 70 nor any of the 4 Bulk Add CSVs ever captured ownership type as structured data; live `partner_id` is `NULL` for all 184 items.
- **Should have been caught by:** M5_TARGETED_DEEP_DIVES (verifying ownership during research) and M6_QUALITY_VERIFICATION.
- **Why it wasn't:** there was never a `research_verifier` evidence contract populating ownership fields — confirmed directly in `seedPortfolioAudit.ts`'s own code comment: "the live `research_verifier` evidence contract does not populate any of these fields, so every candidate resolves to ownershipType `'UNKNOWN_REQUIRES_VERIFICATION'`."
- **Does M5_75 address it now?** Partially. `categoryPolicy.ts`'s `evaluateCommercialMix` (with `DEFAULT_COMMERCIAL_MIX_MIN_LOCAL_PERCENT` and `DEFAULT_UNKNOWN_OWNERSHIP_VOLUME_THRESHOLD`) exists and is composed into `seedPortfolioAudit.ts` — the *math* is ready. But since every real candidate today resolves to `UNKNOWN_REQUIRES_VERIFICATION`, the gate can only ever measure "how much of the catalog is unverified," never actually confirm independent-local representation.
- **What's still needed:** the `research_verifier` evidence contract itself — this is the single most-cited "not yet implemented" dependency across this whole analysis (see `00-executive-summary.md`'s headline finding).
- **Regression fixture:** `MISSING_OWNERSHIP_EVIDENCE_CANDIDATE`.

### Failure 4 — Duplicate venues (cross-batch, different wording)

- **What happened:** Kunst Oase and Vereinsheim both got inserted twice (wave1 + wave3 wording) with no dedup.
- **Should have been caught by:** M4_COVERAGE_AUDIT / M5_TARGETED_DEEP_DIVES (should not re-research/re-propose an already-accepted venue) and, failing that, a pre-insertion duplicate check.
- **Why it wasn't:** the actual insertion tooling (wave2's SQL) only guards exact-body-string duplicates; wave1/wave3 evidently ran through a different, less rigorous path (no SQL artifact exists for them to inspect).
- **Does M5_75 address it now?** Yes, directly — `seedDuplicateNormalization.ts`'s `detectSeedDuplicateClusters` clusters by `SAME_PLACE_ID`, `SAME_NORMALIZED_NAME` (Unicode/case/punctuation-insensitive), or `SAME_ADDRESS`. Kunst Oase and Vereinsheim's wave1/wave3 pairs have byte-identical venue names, so `SAME_NORMALIZED_NAME` would have caught both clusters immediately. `evaluateSeedCandidate` would then route every clustered member to `HOLD` — "Flagged in a seed duplicate cluster — requires explicit review before it can be READY... never auto-resolved" — rather than silently inserting both.
- **What's still needed:** nothing further for the *detection* mechanism; the open question is process, not code — who resolves a HOLD cluster and how "these are two genuinely distinct experiences at one venue" gets recorded as a deliberate decision (as opposed to defaulting to "keep only one").
- **Regression fixture:** `DUPLICATE_VENUE_DIFFERENT_WORDING` and `TWO_DISTINCT_EXPERIENCES_SAME_VENUE`, modeled directly on the real Kunst Oase/Vereinsheim pair.

### Failure 5 — Malformed venue names

- **What happened:** at least 3 confirmed original items had venue-name fields containing full descriptive sentences instead of names (`'Flaucher – riverside leisure stretch on the Isar with beer garden, barbecues, swimming and natural setting'`, `'Hirschgarten beer garden and park'`, `'Dallmayr's quiet café at the coffee counter'`).
- **Should have been caught by:** M3_BROAD_DISCOVERY / M6_QUALITY_VERIFICATION (basic name-hygiene check before certification).
- **Why it wasn't:** no evidence any stage validated venue-name format at Munich's original build time.
- **Does M5_75 address it now?** Not directly — `seedPortfolioAudit.ts`'s per-candidate evaluation checks distinctiveness of the *action* (`checkDistinctiveExperience` on `claimSupported`) and duplicate clustering, but nothing in the read code validates the `name` field's own shape (length, whether it reads as a sentence vs. a proper noun).
- **What's still needed:** a lightweight name-hygiene check (e.g., flag names over N words, names containing verb-first phrasing, or names with more than one clause) added either to M5_75's candidate evaluation or to M6.5's editorial intake as a hard gate before a body is written against that name.
- **Regression fixture:** `MALFORMED_VENUE_NAME_CANDIDATE`, using the real `'Flaucher – riverside leisure stretch...'` text.

### Failure 6 — Multiple businesses combined into one item

- **What happened:** `'Beirut Beirut and Backsteinchen at Luise‑Kiesselbach‑Platz'` bundled two unrelated independent businesses (a Lebanese restaurant and a café/sports-rental shop) behind an "or" choice in a single item.
- **Should have been caught by:** M6_QUALITY_VERIFICATION or M6.5's editorial pass.
- **Why it wasn't:** no evidence of a combined-business check anywhere in the original build.
- **Does M5_75 address it now?** Not directly by name, but partially by side effect — `checkDistinctiveExperience` (via `evaluateSeedCandidate`) is likely to flag "or"-bundled, two-option claim text as insufficiently distinctive, though this was not confirmed by reading `editorialDistinctiveness.ts` itself in this pass (out of scope for tonight's review) and should not be assumed reliable for this specific failure mode without a dedicated test.
- **What's still needed:** an explicit single-business-per-item check — e.g., flag any candidate whose name field or claim text contains two distinct proper-noun business names joined by "and"/"or."
- **Regression fixture:** `IMPROPERLY_COMBINED_BUSINESSES_CANDIDATE`, using the real Beirut Beirut/Backsteinchen text.

### Failure 7 — Generic actions

- **What happened:** original 70 heavily used "savor/dine/indulge/visit/see/spot" with no specific order, ritual, or detail (14 confirmed probable-retirement examples in `01-original-70-disposition.md`).
- **Should have been caught by:** M6_QUALITY_VERIFICATION, then M6.5's editorial rewrite.
- **Why it wasn't:** no evidence a distinctiveness check existed at Munich's original build time.
- **Does M5_75 address it now?** Yes, directly and by design — `evaluateSeedCandidate` runs `checkDistinctiveExperience` against the (venue-name-stripped) claim text and `REJECT`s outright on a generic match, treating it as "filler at the seed stage, not worth an editorial pass."
- **What's still needed:** nothing structurally; worth validating `checkDistinctiveExperience`'s heuristic against the real Munich generic-body corpus (Goldmarie, La Certosa, Café Erika, etc.) as a regression suite, which `06-gold-standard-fixture-proposal.md` proposes.
- **Regression fixture:** `GENERIC_ACTION_CANDIDATE`, using the real `'Savor an Alpine cuisine dish at 'Goldmarie'.'` text.

### Failure 8 — Unsupported secret claims / missing secret discovery

- **What happened:** several candidate bodies use secret-adjacent language ("Find the rooftop bar hidden inside," "the strangest wearable treasure") but zero items are `is_secret=true` live; no secret mechanic exists anywhere in the 184-item catalog.
- **Should have been caught by:** M5_TARGETED_DEEP_DIVES (verifying a secret claim) and M6.5 (deciding whether to mark `is_secret`).
- **Why it wasn't:** structurally impossible today — wave2's own INSERT column list doesn't even include `is_secret`/`secret_reveal_text`, and `seedPortfolioAudit.ts` confirms `isSecretClaimed` resolves to `undefined` for every real candidate because no evidence contract populates it.
- **Does M5_75 address it now?** The *math* exists (`evaluateSecretEvidence`, `isSecretRetained` on `SeedCandidateDecision`, with the doc note "a weak/unsupported isSecret claim never blocks READY by itself; only isSecretRetained is set to false") but has nothing to operate on without the `research_verifier` evidence contract.
- **What's still needed:** same dependency as Failure 3 — the evidence contract. This is a second, independent reason it should be prioritized (see `00-executive-summary.md`).
- **Regression fixture:** `SECRET_WITH_EVIDENCE_CANDIDATE` and `HIDDEN_GEM_WORDING_NOT_ACTUALLY_SECRET_CANDIDATE`.

### Failure 9 — Incorrect/flat difficulty

- **What happened:** all 184 live items, old and new, are `difficulty=1`.
- **Should have been caught by:** M6.5 (editorial writing is where difficulty should be judged) or M7_ITEM_CERTIFICATION.
- **Why it wasn't:** the wave2 SQL template hardcodes the literal `1` in every INSERT — this was never a per-item editorial judgment, it was a fixed value in the generation script.
- **Does M5_75 address it now?** No — difficulty is an M6.5/M7 editorial-time attribute; M5_75 runs on the pre-editorial seed and has no difficulty field to evaluate (`SeedCandidateInput` has no `difficulty` field at all).
- **What's still needed:** an explicit difficulty-variance requirement/rubric at M6.5 (e.g., a minimum distribution across 1-3, tied to concrete criteria like "requires timing/advance booking/a specific physical challenge = higher difficulty") plus a portfolio-level check at M7/M8 that flags a catalog where 100% of items share one difficulty value.
- **Regression fixture:** not modeled in the seed-stage fixture (out of scope for `SeedCandidateInput`) — flagged instead as an M6.5/M7 requirement in `07-calibration-changes.md`.

### Failure 10 — Weak themed-list / Fall 30 membership

- **Not evaluable from available artifacts** — no Fall 30 or themed-list definition for Munich was read as part of this analysis (out of scope per the task's own file list), though `listFitScoring.ts` exists specifically to make catalog-inclusion and list-inclusion independent, auditable decisions, which is directly relevant infrastructure. Flagged as unresolved, not guessed.

### Failure 11 — Stopping too early / expensive editorial work before validating portfolio shape

- **What happened:** Winston's original 70-item build apparently went all the way through certification/list-mirroring (`M9_HOME_LIST_MIRROR` patch files exist for the original 10-neighborhood catalog) before its category/geography shape was ever corrected — meaning real editorial-writing cost was spent on a catalog that then needed a large external rebuild.
- **Should have been caught by:** exactly the ordering problem M5_75 was built to solve.
- **Why it wasn't:** M5_75 did not exist yet.
- **Does M5_75 address it now?** Yes, directly and completely — this is M5_75's entire reason for existing: `seedPortfolioAudit.ts`'s own header doc states it runs "BEFORE M6_5_CHECKOFF_EDITOR (item intake/editorial writing) begins... the last real checkpoint before expensive editorial writing (M6.5) spends AI calls turning candidates into finished CheckOff bodies."
- **What's still needed:** nothing further architecturally; this failure mode is the one Munich lesson M5_75 was built to fully close.
- **Regression fixture:** the fixture's overall composition (see `06-gold-standard-fixture-proposal.md`) is itself the regression test for this failure — a portfolio audit run against it should surface category/duplicate/genericness problems before any editorial cost is spent.
