# Category & Geography Comparison (Deliverables D + E) — Parts 2 & 3

## D. Original-versus-final category comparison

Winston's `m0.json` (`categoryCatalogTargets`) explicitly named **Food & Drink and Arts & Culture as the two anchor categories** for Munich, with the task brief independently confirming the original 70 were "heavily skewed toward Arts & Culture" with "difficulty-always-1... no secrets." Live category counts today (12 distinct `category_id` buckets, names inferred from sample item bodies since this role lacks `SELECT` on `public.categories` — see `08-data-gaps-and-next-steps.md`):

| Category (inferred) | Live active count | % of 184 | vs. `DEFAULT_CATEGORY_COVERAGE_PLAN` healthy target | Verdict |
|---|---|---|---|---|
| Food & drink | 64 | 34.8% | 30 | Above healthy target — expected given Munich's culinary identity, not a red flag |
| Bar & drinks | 38 | 20.7% | 15 | More than 2x healthy target — largest single overrepresentation |
| Nightlife | 18 | 9.8% | 6 | 3x healthy target |
| Adventure | 18 | 9.8% | 12 | Slightly above healthy target |
| Shopping | 12 | 6.5% | 6 | 2x healthy target — this is notable because `defaultMetroManifest.ts` explicitly flags Shopping as "historically a weak category across prior metros," yet Munich's Shopping ended up comfortably healthy |
| Arts & Culture | 11 | 6.0% | 10 | Roughly at healthy target — **down from Winston's original heavy skew.** Winston's original 70 leaned Arts & Culture hard (per the task brief); the live 6.0% share is now inside the `DEFAULT_CATEGORY_PERCENTAGE_BANDS` 3–30% guardrail with plenty of headroom, i.e. **the single biggest category-mix improvement the Bulk Add process made was correcting Arts & Culture overconcentration** by adding volume everywhere else rather than removing Arts & Culture items. |
| Spa & self-care | 6 | 3.3% | 4 | Above healthy target |
| "Play" (not in Winston's plan) | 6 | 3.3% | n/a | **A category not present in `DEFAULT_CATEGORY_COVERAGE_PLAN` at all** — populated by items like "Sit beneath the 14-meter dome... at 'ESO Supernova'," "Beat as many short challenge rooms... at 'Team-UP! Room Challenges'," ice-hockey/ice-skating-adjacent leisure. This looks like a genuine gap in Winston's category taxonomy that the Bulk Add Agent filled by inventing its own bucket rather than forcing these into Adventure/Sports. |
| Sports | 4 | 2.2% | 5 | Just below healthy target, above absolute minimum (2) |
| Misc | 3 | 1.6% | 5 | Below healthy target |
| Social | 2 | 1.1% | 4 | Below healthy target, at absolute minimum (2) |
| Unnamed 12th bucket (2 items: Frauenkirche viewing platform, Nymphenburg Palace) | 2 | 1.1% | — | Sample bodies suggest this may be a "Travel"/landmark bucket distinct from the Arts & Culture bucket above (Winston's `DEFAULT_CATEGORY_COVERAGE_PLAN` does list a `Travel` target) — **not confirmed**, since category names could not be read directly. |

**Net read:** the Bulk Add process did not rebalance Munich by removing overrepresented categories — it diluted Arts & Culture's *share* by adding roughly 2.6x more items overall (70 → 184) concentrated in Food & drink/Bar & drinks/Adventure/Shopping, while leaving Arts & Culture's raw count roughly flat. This is a legitimate way to fix overconcentration (consistent with `categoryPolicy.ts`'s own doctrine that "dispatching MORE research at an already-overrepresented category cannot fix overrepresentation" — the fix has to come from elsewhere), but it means total catalog size, not composition discipline, did the work. A metro that only doubled in size instead of 2.6x-ing would not have gotten the same Arts & Culture relief without also deliberately capping new Arts & Culture insertions — which nothing in these artifacts shows being done deliberately (Arts & Culture simply grew slower than everything else).

The live "Play" category, unaccounted for in Winston's own coverage plan, is a genuine taxonomy gap: either Winston's plan needs an 12th bucket, or M6.5/M7 needs an explicit normalization rule mapping "Play"-flavored candidates into Adventure or Sports so a category never silently proliferates outside the governed plan.

## E. Original-versus-final geography comparison — Part 2

### The boundary contradiction (the most important finding in this file)

Winston's own `m0.json` (`geographicScope`, written before any Bulk Add work) states explicitly:

> "...**Excludes greater Munich commuter towns and distant Bavarian day-trip destinations (Dachau, Starnberg, Chiemsee, the Alps/Neuschwanstein) as out of scope for this initial launch** — those are candidates for a later expansion, not this build."

Live production today has an active **Dachau** neighborhood (Dachau Palace, "Look all the way to the Alps from the ridge-top garden") and an active **Starnberg** neighborhood (Undosa lake-deck bar, Starnberger Eiswerkstatt, Maisinger Schlucht hike) — **both explicitly named as out-of-scope in Winston's own geographic-scope record.** `metro-area-facts.json` records no boundary/radius data at all (just name/state/timezone), so there is no machine-readable boundary anywhere that reflects the *actual*, expanded live geography. This is not a correction of a Winston mistake — Winston's original scope decision was deliberate and explicit ("candidates for a later expansion, not this build") — it is Jerry unilaterally executing that "later expansion" through the external Bulk Add process without ever updating the artifact of record. **If a future Winston metro-expansion run trusts `m0.json` as ground truth, it will treat Dachau/Starnberg as still out of scope, contradicting what's already live and monetizable.** This is flagged as an urgent, cheap fix: `m0.json`'s `geographicScope` field needs to be reconciled with the live neighborhood list before it is used as an input to any future Munich work.

### Original 10 vs. final 36 neighborhoods

Original 10 (`canonical-neighborhoods.json`, all central-Munich Stadtbezirke): Altstadt-Lehel, Ludwigsvorstadt-Isarvorstadt, Maxvorstadt, Schwabing, Au-Haidhausen, Sendling, Sendling-Westpark, Neuhausen-Nymphenburg, Schwabing-Freimann, Milbertshofen-Am Hart (Olympiapark).

**Confirmed live: exactly 36 neighborhoods, all `is_active=true`, no inactive/orphaned rows** — the "26 additional" claim in the task brief is exact, not approximate.

| New neighborhood | Item count (live) | Geographic unit type | Belongs in Munich metro? |
|---|---|---|---|
| Bogenhausen | 3 | Real Munich Stadtbezirk (inner-east, upscale) | Yes — always should have been in the original 10 |
| Obergiesing-Fasangarten | 6 | Real Munich Stadtbezirk | Yes |
| Schwanthalerhöhe | 4 | Real Munich Stadtbezirk | Yes |
| Ramersdorf-Perlach | 1 | Real Munich Stadtbezirk | Yes |
| Berg am Laim | 1 | Real Munich Stadtbezirk | Yes |
| Trudering-Riem | 1 | Real Munich Stadtbezirk | Yes |
| Pasing-Obermenzing | 1 | Real Munich Stadtbezirk | Yes |
| Feldmoching-Hasenbergl | 1 | Real Munich Stadtbezirk | Yes |
| Lochhausen | 1 | Ortsteil within Feldmoching-Hasenbergl Stadtbezirk — arguably too fine-grained to be its own canonical neighborhood at 1 item | Borderline — depth question, not a boundary question |
| Thalkirchen | 1 | Ortsteil within Sendling Stadtbezirk (climbing gym) — same over-granularity concern as Lochhausen | Borderline |
| Freising | 4 | Independent town, ~35km N, own Landkreis | Surrounding metro municipality, not a Munich neighborhood — but genuinely "greater Munich" and a defensible day-trip/weekend inclusion (Weihenstephan brewery) |
| Erding | 3 | Independent town, ~35km NE | Surrounding metro municipality — thermal-spa/beer-tourism draw, defensible |
| Dachau | 1 | Independent town, ~20km NW | Surrounding metro municipality — **explicitly excluded in m0.json**, see above |
| Starnberg | 3 | Independent town, ~25km SW, on Starnberger See | Surrounding metro municipality — **explicitly excluded in m0.json**, see above |
| Andechs | 2 | Village, ~35km SW | Surrounding metro municipality |
| Aying | 2 | Village, ~25km SE | Surrounding metro municipality |
| Fürstenfeldbruck | 2 | Independent town, ~25km W | Surrounding metro municipality |
| Pullach | 1 | Suburb, ~10km S | Surrounding metro municipality (close-in) |
| Grünwald | 1 | Suburb, ~12km S | Surrounding metro municipality (close-in; Bavaria Filmstadt) |
| Taufkirchen | 2 | Suburb, ~15km S | Surrounding metro municipality (close-in; Jochen Schweizer Arena) |
| Garching | 1 | Suburb/university town, ~12km N | Surrounding metro municipality (close-in; ESO Supernova) |
| Oberschleißheim | 2 | Suburb, ~15km N | Surrounding metro municipality (close-in; Schleißheim Palace) |
| Poing | 1 | Suburb, ~20km E | Surrounding metro municipality |
| Hallbergmoos | 1 | Suburb near airport, ~20km N | Surrounding metro municipality |
| Bergkirchen | 1 | Village, ~25km W | Surrounding metro municipality |
| Herrsching | 1 | Town on Ammersee, ~35km SW | Surrounding metro municipality (furthest out along with Andechs) |
| Milbertshofen-Am Hart (Olympiapark) | 4 | *(one of the original 10, listed for reference — not new)* | — |

**Depth distribution:** recounting precisely from the live query in `00-executive-summary.md`'s source data: **16 of the 36 total neighborhoods (44%) have exactly 1 active item** (Ramersdorf-Perlach, Berg am Laim, Trudering-Riem, Pasing-Obermenzing, Feldmoching-Hasenbergl, Lochhausen, Thalkirchen, Dachau, Pullach, Grünwald, Garching, Poing, Hallbergmoos, Bergkirchen, Herrsching, and Sendling-Westpark — the last being one of the *original* 10 neighborhoods, now thinned to a single item), and a further 5 have exactly 2. Only 7 of the 36 neighborhoods (Altstadt-Lehel 35, Ludwigsvorstadt-Isarvorstadt 25, Schwabing 18, Sendling 14, Maxvorstadt 14, Au-Haidhausen 12, Neuhausen-Nymphenburg 10) have what would read as "healthy depth" (10+ items) by any reasonable bar. This is the geography analogue of the category-overconcentration finding: **breadth (36 neighborhoods) was prioritized over depth**, and roughly 4 in 10 of all neighborhoods are single-item placeholders rather than genuinely explorable areas — a real open question for whether a future Winston run should treat "reached a named municipality" as success, or require a minimum-viable item count per neighborhood before counting it as "covered."

### What geographic research Winston failed to perform initially, and what would have caught it

Winston's M1 Geography Map stage (per the driver stage sequence) evidently produced only the original 10 central Stadtbezirke and never surfaced the ~15 additional real Munich Stadtbezirke/Ortsteile (Bogenhausen, Obergiesing-Fasangarten, etc.) that a basic administrative-boundary lookup (Munich has 25 official Stadtbezirke; Winston's 10 covered fewer than half) would have found immediately. It also never considered the "surrounding metro municipality" tier at all — m0.json's scope statement shows this was a deliberate initial-launch narrowing, not an oversight, but the artifact never got updated once that narrowing was reversed in practice. A reusable discovery process for a future metro would need two distinct, sequenced lookups: (1) an authoritative administrative-district enumeration for the core city (all Stadtbezirke, not a curated subset) before any item research begins, and (2) an explicit, Jerry-approved decision — recorded in the metro-definition artifact itself, not left implicit — on whether "greater metro" municipalities are in scope for this launch or a later one, with the artifact updated the moment that decision changes (exactly the m0.json staleness problem found above).

## Part 3 — quality-change metrics (the parts confidently measurable from live data + artifacts)

| Metric | Before (Winston's 70) | After (live, 184) | Confidence |
|---|---|---|---|
| Total active items | 70 | 184 | Confident (live count; original count from task brief + `NOT_APPLIED` snapshot) |
| Total inactive items | 0 (none retired yet) | Unknown to this role — likely ≥21 (the cleanup-SQL retirements), but RLS hides them from direct count | Live count blocked; inferred only |
| Total neighborhoods | 10 | 36 | Confident (live) |
| Neighborhoods with ≤1 item | 0 (all 10 had items by definition) | 16 | Confident (live) |
| Arts & Culture % of catalog | Task brief: "heavily skewed" (no live number available for the original 70) | 6.0% | Confident for "after," not independently quantified for "before" |
| Food & drink % | Anchor category per m0.json, likely largest | 34.8% | Confident for "after" only |
| Difficulty variance | Always 1 (task brief) | **Still always 1, 184/184** | Confident (live) — unchanged |
| Secret-designation count (`is_secret=true`) | 0 (task brief: "no secrets") | **Still 0, 184/184** | Confident (live) — unchanged |
| Items with `google_place_id` | Unknown for original 70 | 49/184 (27%) | Confident for "after" only |
| Malformed-venue-name rate | At least 3 confirmed originals had venue-name fields containing full sentences (Flaucher, Hirschgarten, Dallmayr — see `01-original-70-disposition.md`) | 0 confirmed live via apostrophe-count heuristic (all 4 flagged candidates were false positives — legitimate quoted phrases, not malformed names) | Original-side confident (documented cases); live-side heuristic-only, not exhaustive |
| Combined-business rate | At least 1 confirmed original ("Beirut Beirut and Backsteinchen") | Not measurable via SQL heuristic — would require reading all 184 bodies for "X or Y" / "and" patterns manually | Original-side: 1 confirmed case. Live-side: not measured, flagged as a gap |
| Generic-action rate | High per task brief and confirmed via 14 probable-retirement examples in `01-original-70-disposition.md` (nearly all use "savor/dine/indulge/visit/see/spot" verbs with no specific order or ritual) | 4/184 live items match a narrow `ILIKE 'Visit %'/'Check out %'/'Explore %'/'See %'/'Go to %'` heuristic — almost certainly an undercount, since `checkDistinctiveExperience`'s real logic is semantic, not a keyword match | Both sides: rough heuristic only, not the real distinctiveness-checker output |

Category percentages, secret-evidence support, ownership/independent-business representation, and partner potential for the *original* 70 specifically could not be measured with confidence because the pre-Bulk-Add snapshot (the `NOT_APPLIED` patch file) does not carry `is_secret`/ownership fields distinctly from the live schema in a way that lets a true before/after diff run — see `08-data-gaps-and-next-steps.md`.
