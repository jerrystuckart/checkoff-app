# New-Item Contribution Table (Deliverable C)

## Scale of the "new" pool

Live Munich total: **184** active items. Of these: 9 are UUID-confirmed rewrites of original items (same underlying row, not new), and roughly 47 are name-matched originals (see `01-original-70-disposition.md`). That leaves an estimated **~128 genuinely new items** not present in Winston's original 70 — roughly consistent with the four acceptance-CSV batches (wave1 72 candidates, wave2 39 SQL-confirmed inserts, wave3 17 candidates, final selective fill 6 candidates = 134 candidate slots), once wave1/wave3's overlapping `MUC-203`/`MUC-205` double-entries and any wave1 candidates that were held/rejected rather than inserted are accounted for. **The exact new-item count is not independently confirmed row-by-row against all four CSVs** — only wave2 has its own SQL batch in hand to confirm a 100% CSV-to-insert rate (39 CSV rows, 39 `INSERT INTO public.items` statements, one-to-one by venue name, confirmed via `grep`). Wave1/wave3/final-fill have no equivalent SQL artifact provided, so their CSV "accepted" status is evidence of what the Bulk Add Agent *decided*, not certain proof of what got inserted — see Part 4 and `08-data-gaps-and-next-steps.md`.

## Classification of new items by role (aggregated, evidence from the 4 CSVs + live category/neighborhood breakdown)

| Dimension | Finding |
|---|---|
| **Category** | New items skew Food & drink and Bar & drinks least surprising (wave1's Sendling/Altstadt/Maxvorstadt food-scene deep dive), but wave2 specifically targets Adventure/Play/Sports in outer municipalities (Therme Erding, Galaxy Erding, Jochen Schweizer Arena, Wildpark Poing, ESO Supernova, KartPalast Funpark, DAV Kletter- und Boulderzentrum, Surftown MUC) — this is where the live "Play" category (6 items, not in Winston's `DEFAULT_CATEGORY_COVERAGE_PLAN`) and most of Sports/Adventure's growth comes from. |
| **Neighborhood / surrounding community** | New items populate all 26 new neighborhoods (see `03-category-geography-comparison.md`); wave1 stays inside the original 10; wave2 is almost entirely outside them, into named Bavarian municipalities (Erding, Freising, Aying, Andechs, Dachau, Grünwald, Taufkirchen, Hallbergmoos, Poing, Pullach, Bergkirchen, Fürstenfeldbruck, Oberschleißheim, Garching, Starnberg, Herrsching) plus central-city gap-fill neighborhoods (Bogenhausen, Obergiesing-Fasangarten, Schwanthalerhöhe, Ramersdorf-Perlach, Berg am Laim, Trudering-Riem, Pasing-Obermenzing, Feldmoching-Hasenbergl, Lochhausen, Thalkirchen). |
| **Business type / ownership** | CSVs carry no ownership field at all (no "chain vs. independent" column in any of the 4 files) — ownership was **never captured as structured data** by the Bulk Add process. This is consistent with the live DB finding of `partner_id IS NULL` for all 184 items and matches `seedPortfolioAudit.ts`'s own code comment that ownership defaults to `UNKNOWN_REQUIRES_VERIFICATION` until a `research_verifier` evidence contract exists. Ownership judgments in this document are therefore inferred from name/venue character (e.g., "Higgins Ale Works," "Taxisgarten," family-run bakeries) and explicitly **not verified**. |
| **Specific experience type / role (food, drink, nightlife, retail, wellness, play, adventure, culture, landmark, civic)** | All 6 roles are represented in the new pool: food (Fausto Kaffeerösterei), drink/nightlife (Frisches Bier, BROY Bierothek, Pimpernel), retail/maker (Alva Morgaine, Glatteis Buchhandlung, Magnus Bauch butcher), wellness (Therme Erding, Hamam Mathilden), play/adventure (Bavaria Filmstadt, ESO Supernova, Jochen Schweizer Arena), culture (Asamkirche, MUCA Kunstbunker), landmark/civic (Schleißheim Palace, Flugwerft Schleißheim aviation museum). |
| **Fills a previously identified category gap** | Yes for Shopping (Magnus Bauch, Alva Morgaine, Glatteis Buchhandlung, The Munich Readery, Kunst und Spiel), Sports (SAP Garden ice-skating, DAV climbing gym), Social (Herr & Frau Rio Riso workshop, Giesinger Grünspitz Mitbringdinner — though this one carries a hard expiry date, "September 20, 2026," a durability risk flagged in Part 3/5), Spa & self-care (Hamam Mathilden, Therme Erding). |
| **Fills a geographic gap** | Yes, overwhelmingly — this is the dominant contribution of waves 2/3/final-fill; see `03-category-geography-comparison.md`. |
| **Genuine secret or discovery mechanics** | **None found.** Live `is_secret = true` count is 0/184. Several candidate bodies use secret-adjacent language ("Find the rooftop bar hidden inside," "Find the strangest wearable treasure," "Follow the antique mirrors into the basement") but none of these were flagged `is_secret` in production — the "secret" framing is editorial voice only, not a structured/verified mechanic. This matches Part 5/6's fixture need for a "hidden gem wording that is not actually secret" example. |
| **Plausible local-business partner potential** | High for independent single-location businesses with named owners implied (Magnus Bauch fourth-generation butcher, Neulinger family bakery, Fausto Kaffeerösterei), essentially zero for public/municipal or corporate-adjacent entries (Schleißheim Palace, SAP Garden — named-sponsor arena, ESO Supernova — research institute). None have `partner_id` set live. |
| **Which research/Bulk Add source produced it** | Recoverable for wave1 via the `source_keys`/`source_urls` columns (see decoding below); not recoverable at all for wave2/wave3/final-fill, whose CSVs carry no source columns. |

## Source-key decoding (wave1, Part 4 groundwork)

Cross-referencing `source_keys` against the co-occurring `source_urls` in the same wave1 CSV rows:

| Key | Domain / evidence type | Rows observed | Evidence-quality note |
|---|---|---|---|
| B | munich.travel — "local-love-munich/schlachthofviertel-tips" | 6 | Editorial city-tourism-board neighborhood guide |
| I | munich.travel — "local-love-munich/thalkirchner-strasse" | 7 | Same tier |
| C | munich.travel — "local-love-munich/glockenbachviertel-tipps" | 8 | Same tier |
| J | munich.travel — "local-love-munich/altstadt-s-fast-eats" | 6 | Same tier |
| H | munich.travel — "local-love-munich/old-town-tips" | 2 | Same tier |
| E | munich.travel — "local-love-munich/maxvorstadt-tips" | 5 | Same tier |
| F | munich.travel — "local-love-munich/haidhausen-tips" | 2 | Same tier |
| G | munich.travel — "local-love-munich/neuhausen-tips" | 2 | Same tier |
| A | munich.travel — "5x5-tips-for-munich-neighborhoods" (Schwabing) | 4 | Same tier |
| M | eater.com — Munich restaurant/food guide | 12 | National food-media outlet |
| O | atlasobscura.com | 2 | Curated "unusual/hidden" travel site — directly relevant to secret/discovery claims, but still not primary/verifiable evidence |
| L | munich.travel — "eat-drink/gastronomy-records" | 3 | Superlative-claims page ("smallest bar," etc.) |
| Q | munich.travel — "eat-drink/bavarian-food" | 1 | Same tier |
| P | muenchen.de (official city portal) — modern Bavarian cuisine tips | 1 | Official city-site editorial |
| K | munich.travel — "eat-drink/exceptional-restaurants" | 1 | Same tier |
| **R** | **"Official venue website; verify current URL and Places record during intake"** | **13** | **No actual source URL at all** — a placeholder acknowledging the claim is unverified. **13 of wave1's 72 rows (18%) carry this weakest-evidence flag, yet all 13 were still accepted at the same priority-A/score-9 tier as fully-sourced rows.** |

This is the calibration question flagged in the task brief: **R-sourced candidates had objectively lower evidence quality (no retrievable source URL, an explicit "verify during intake" caveat) but received identical acceptance scores to candidates backed by a real editorial citation.** Whatever scoring rubric the Bulk Add Agent used treated "needs verification" as a checklist item to defer, not a factor that should lower confidence at acceptance time. `seedPortfolioAudit.ts`'s current `evaluateSecretEvidence`/ownership defaults already treat *unverified* as its own explicit state (`UNKNOWN_REQUIRES_VERIFICATION`) rather than folding it into a pass/fail score — this is the right shape, but score/priority in a future Winston equivalent should follow the same discipline: evidence tier should visibly gate or discount score, not be reported next to an identical score as though it didn't matter.

## Case study: Kunst Oase / Vereinsheim, wave1 vs. wave3 (required by the task brief)

Both venues appear in wave1 **and** wave3 with materially different `checkoff_item` text:

| Venue | Wave1 wording | Wave3 wording | Live production result |
|---|---|---|---|
| Kunst Oase | "Find an antique lamp among the ceiling-high collection at 'Kunst Oase'." | "Follow the antique mirrors into the basement and find your favorite chandelier among hundreds at 'Kunst Oase'." | **Both are live, as two separate active items** (`11021c31-2dc5-4173-a2ad-e88163eb31af` and `62254f33-afae-4aae-b14a-a59ff0ae7fda`). |
| Vereinsheim | "Join the pub quiz or catch a tiny concert at 'Vereinsheim'." | "Play along with 'Königs Musik-Express', the quiz-and-live-music night at 'Vereinsheim'." | **Both are live, as two separate active items** (`0c3df62f-93bd-42fd-bd6a-69b32ba8cdfc` and `6caa5ffd-e712-4573-8137-ab1b559abd8a`). |

**Finding:** the Bulk Add process's own internal duplicate handling did **not** dedupe across its own waves — both wordings for both venues were inserted as distinct, permanently coexisting items. Whether this was a deliberate "these are genuinely two distinct experiences" editorial call or an accidental cross-wave miss cannot be determined from the artifacts (no rationale is recorded anywhere). Arguments for each reading:
- *Deliberate-distinct reading:* Kunst Oase's two items describe different physical zones (main-floor lamp collection vs. basement mirror/chandelier collection) — plausibly two genuinely separate discovery moments in a large antique shop. Vereinsheim's two items both describe the same recurring pub-quiz-plus-music night, just with/without the specific event name ("Königs Musik-Express") — much harder to justify as distinct.
- *Accidental-miss reading:* nothing in any artifact shows the Bulk Add Agent cross-checking wave3 candidates against already-inserted wave1 items by venue name before insertion; the Vereinsheim pair reads like the same experience described twice.

This is exactly the scenario `seedDuplicateNormalization.ts`'s `detectSeedDuplicateClusters` (adjustment 6, composed into `seedPortfolioAudit.ts`) is designed to catch **before** insertion, by flagging same-venue candidates into a cluster requiring explicit HOLD-then-review rather than silent auto-insertion of both. It did not exist during Munich's build. It is used as the primary regression-fixture case in `06-gold-standard-fixture-proposal.md` (the "two valid distinct experiences at one venue" and "duplicate venue, slightly different wording" fixture entries are both modeled directly on this pair).

## Geographic-boundary question (wave2, Part 2 evidence — full detail in `03-category-geography-comparison.md`)

Wave2 and the final-fill batch place items in named municipalities well outside central Munich (Erding ~35km NE, Freising ~35km N, Starnberg ~25km SW, Andechs ~35km SW, Aying ~25km SE, Fürstenfeldbruck ~25km W). None of these appear anywhere in Winston's original 10-neighborhood model or in `metro-area-facts.json`'s original boundary definition (see next file) — this was a **deliberate, manually-driven boundary expansion by Jerry**, not a correction of a Winston geography error. It mirrors the same class of judgment call `neighborhood_reassignment_2026-09-13.md` made when it explicitly *dropped* two out-of-boundary items (Prime Tours Germany GmbH in Germering, MGV e.V. in Vaterstetten-Neukeferloh) as "~14-17km outside the approved Munich metro boundary" — meaning Winston's own reassignment step drew a boundary that wave2's later, larger expansion then intentionally overrode. This is a real, unresolved policy question for Winston's pipeline (see `07-calibration-changes.md`, M1 Geography Map): **what is "in the Munich metro" is not a fixed radius — it changed between 2026-09-13 (Winston's own reassignment) and wave2 (Jerry's later expansion), and nothing in the artifacts records the actual radius/criteria used for either boundary.**
