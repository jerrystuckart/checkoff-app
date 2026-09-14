# Original vs. Final List Decisions (Part 2)

## Headline finding: this was near-total replacement, not incremental curation

Winston's four pre-existing lists (Fall 2026 — Munich Metro, After Dark, Cafés/Markets & Local Flavor, Hidden Gems — baseline reconstructed from `munich_home_list_patch_2026-09-14_DRIVER_CERTIFIED_NOT_APPLIED.sql`, the only artifact recording Winston's own list membership) and the final rebuilt lists share **almost no venues in common**:

| List | Winston original count | Final count | Venues retained by name | Venues removed | Venues added |
|---|---|---|---|---|---|
| Fall 2026 — Munich Metro | 30 | 30 | **0** | 30 | 30 |
| After Dark → Munich After Dark | 10 | 24 | **1** ("Call Soul – Breaking Bar", body rewritten) | 9 | 23 |
| Cafés, Markets & Local Flavor | 13 | 20 | **1** ("Dallmayr", body rewritten — one of the 9 UUID-certain rewrites from `01-original-70-disposition.md`) | 12 | 19 |
| Hidden Gems | 9 | 24 | **0** (the generic "Boazn" item in Winston's list is a different production row from the specific "'Boazn' at Ludwigsbrücke" item in the final list — same descriptor, different venue) | 9 | 24 |
| Beer Gardens, Breweries & Bavarian Rituals | — (did not exist) | 20 | n/a | n/a | 20 (new list) |
| Day Trips & Big Adventures | — (did not exist) | 20 | n/a | n/a | 20 (new list) |

Only **2 of Winston's original 62 list-membership rows (across the four pre-existing lists) survived into the final version by recognizable venue identity**, and both survived only because the underlying *item* was one of the 9 UUID-certain body/category rewrites documented in `01-original-70-disposition.md` (Call Soul – Breaking Bar, Dallmayr) — not because the list-curation step itself decided to keep an unchanged item. This means Fall 2026, After Dark, and Hidden Gems were, in practical effect, **deleted and rebuilt from scratch** rather than edited. This is a stronger and more specific finding than "Winston's lists were weak" (Part 4/`05-pipeline-failure-stage-mapping.md`'s Failure 10 already flagged list quality as unresolved) — it says the actual curation mechanism used here was full-list replacement, and every one of the classification questions below ("retained / removed / added") resolves to **added-from-expanded-catalog** for all but 2 rows, because there was essentially nothing left to retain.

## Classification per list

### Fall 2026 — Munich Metro (Winston 30 → Final 30)

**Classification:** 30/30 Added from the expanded catalog. 0 Retained. 0 Moved. Winston's Fall 30 was built entirely from the original-70 catalog (Allianz Arena, Asaya Spa, Auer Dult, Augustiner-Keller, Bei Dagmar, Beirut Beirut/Backsteinchen, generic-Boazn, Café Erika/Gans am Wasser/Jasmin/Luitpold/Maria/Ruffini, Call Soul, Casele, Deutsches Museum, English Garden, Flaucher, Flex bar, Frauenkirche, Gasteig, Haus der Kunst, Hirschgarten, Kunstareal Munich, Luitpoldpark, Mariahilfkirche, Mohr-Villa, Motorworld München, Valentin-Karlstadt-Musäum, Vini e Panini) — a mix of landmarks, generic-action items, and at least 3 of the probable-retirement items identified in `01-original-70-disposition.md` (Kunstareal Munich, Beirut Beirut/Backsteinchen, and — per that file's "possibly untouched" caveat — several Café items later found generic). None of these 30 venues appear in the final Fall list. The final Fall list draws entirely from the ~128-item expanded pool (`02-new-item-contributions.md`), plus a handful of items that are themselves shared with the newly created Beer Gardens/Day Trips lists.

Final membership (30/30), classified:

| Item (venue) | Category | Neighborhood | Fit reason | Strength | Role | Also in |
|---|---|---|---|---|---|---|
| Gaststätte Großmarkthalle | Food & drink | Sendling | Cellar-made Weißwurst, before-noon ritual | Strong | Essential | Beer Gardens, Cafés/Markets, Hidden Gems |
| La Favela | Food & drink | Sendling | Picanha in a repurposed U-Bahn carriage — distinctive setting | Strong | Distinctive | Hidden Gems |
| Bahnwärter Thiel | Nightlife | Sendling | Shipping-container/rail-car dance venue | Strong | Distinctive | Hidden Gems, Munich After Dark |
| Reichenbachkiosk | Food & drink | Ludwigsvorstadt-Isarvorstadt | 300+ beers, nearly all-night | Strong | Distinctive | Hidden Gems |
| Man Versus Machine | Food & drink | Ludwigsvorstadt-Isarvorstadt | Named pastry + named coffee style | Strong | Supporting-variety | Cafés/Markets |
| Lea Zapf Marktpatisserie | Food & drink | Altstadt-Lehel | Named pastries, specific technique (blowtorched) | Strong | Supporting-variety | Cafés/Markets, Hidden Gems |
| Zum Franziskaner | Food & drink | Altstadt-Lehel | Named dish + physical ritual (walk to kitchen counter) | Strong | Distinctive | Hidden Gems |
| Café Frischhut | Food & drink | Altstadt-Lehel | Named pastry, dawn timing | Strong | Essential | Cafés/Markets |
| Weinhaus Neuner | Food & drink | Altstadt-Lehel | Named dish pairing, staff-picked wine | Strong | Supporting-variety | — |
| Juristische Bibliothek | Misc | Altstadt-Lehel | Booked guided visit, specific architectural detail | Strong, but logistically heavy (advance booking) | Thematic | Hidden Gems |
| Julius Brantner Brothandwerk | Food & drink | Maxvorstadt | Named product, named technique (hand-looped) | Strong | Supporting-variety | — |
| Steinheil 16 | Food & drink | Maxvorstadt | Named/famous specific dish | Strong | Distinctive | — |
| Barroom | Bar & drinks | Au-Haidhausen | Superlative claim (smallest bar), verifiable | Strong | Distinctive | Munich After Dark |
| Wirtshaus in der Au | Food & drink | Au-Haidhausen | Named dish category, "build a meal" framing | Moderate — a bit generic in structure | Supporting-variety | — |
| Giesinger Bräustüberl | Bar & drinks | Obergiesing-Fasangarten | Locally brewed beer, specific brewery link | Strong | Geographic-balance | Beer Gardens |
| Hexenhäusl | Bar & drinks | Obergiesing-Fasangarten | Self-built structure, discovery framing | Strong | Distinctive | Hidden Gems |
| Crönlein | Nightlife | Obergiesing-Fasangarten | Adaptive-reuse building detail | Strong | Distinctive | Munich After Dark |
| Café Marais | Food & drink | Schwanthalerhöhe | Specific decor detail | Moderate | Supporting-variety | Cafés/Markets |
| Gans Woanders | Food & drink | Ramersdorf-Perlach | Distinctive physical setting (treehouse) | Strong | Geographic-balance (single-item neighborhood) | — |
| Beerencafé Hofreiter | Food & drink | Lochhausen | Two-step ritual (pick, then eat) | Strong | Geographic-balance (single-item neighborhood) | — |
| Jochen Schweizer Arena | Adventure | Taufkirchen | Named specific attraction (indoor wind) | Strong | Seasonal/day-trip | Day Trips |
| Bavaria Filmstadt | Play | Grünwald | Interactive, guided, specific | Strong | Seasonal/day-trip | Day Trips |
| Therme Erding | Spa & self-care | Erding | Named, specific sensory detail | Strong | Seasonal/day-trip | Day Trips |
| Weihenstephan | Bar & drinks | Freising | Brewery tour + tasting, specific | Strong | Seasonal/day-trip | Beer Gardens, Day Trips |
| KartPalast Funpark | Play | Bergkirchen | Specific activity | Strong | Seasonal/day-trip | Day Trips |
| Andechs Bräustüberl | Food & drink | Andechs | Named ritual (bring own Brotzeit) | Strong | Seasonal/day-trip | Beer Gardens, Day Trips |
| SAP Garden | Sports | Milbertshofen-Am Hart | Public skating, specific | Strong | Category-balance (Sports is under-target) | — |
| Munich Hot Springs | Spa & self-care | Schwabing | Very specific (Sunday 11 AM ritual) | Strong, but recurring/schedule-dependent | Thematic | — |
| Surftown MUC | Adventure | Hallbergmoos | Named specific activity | Strong | Seasonal/day-trip | Day Trips |
| Wildpark Poing | Adventure | Poing | Named activity | Strong | Seasonal/day-trip | Day Trips |

No item in the final Fall list was judged "in the catalog merely because it exists" — every one carries a specific, non-generic action. The list's "core promise" question (is this genuinely the *strongest and most varied* Fall selection, or just what happened to be available) is evaluated in `11-list-portfolio-scorecards.md`.

### Munich After Dark (Winston's "After Dark" 10 → Final 24)

**Classification:** 23/24 Added from expanded catalog. 1/24 Retained-with-rewrite (Call Soul – Breaking Bar — the body was corrected from a "Breaking Bad"-referencing line to "Breaking Bath" per the original-70 rewrite pass, then carried into the final list). 0 Removed-and-not-replaced in the sense of "list shrank" — the list grew from 10 to 24. 9 of Winston's original 10 do not appear (Alte Utting, Bei Dagmar, generic-Boazn, Café Ruffini, Flex bar, M'Uniqo, Xaver's, Zephyr Bar, Zum Wolf) — none of these were confirmed retired from the *catalog* in `01-original-70-disposition.md` (several, like Zephyr Bar and Flex bar, are confirmed still live/name-matched), meaning this is a case of **items remaining in the catalog but being excluded from the themed list on curation grounds**, not items disappearing from CheckOff entirely. This is exactly the "catalog inclusion does not imply list inclusion" principle Part 6/`12-m9-training-requirements.md` formalizes.

Final membership highlights (24 total; full list in `09-final-list-rebuild-analysis.md`'s cross-reference and the SQL itself): overwhelmingly Bar & drinks (18/24) and Nightlife (6/24) — a materially more disciplined category profile than a generic "things open at night" list would produce. Every item's claim text ties to a specific nighttime-only or nighttime-distinctive mechanic — a rooftop revealed after dark (Haus im Tal), a bar that only "truly becomes" itself after midnight (Schumann's Bar), a below-street-level electronic night (Unter Deck), a late-night-only bottle shop (BROY, also in Hidden Gems) — versus Winston's original list, which included at least one item (Café Ruffini: "browse the in-house shop, or visit late—open until midnight") whose nighttime relevance was one clause tacked onto a daytime café description. See `11-list-portfolio-scorecards.md` for the full nighttime-suitability-vs.-merely-a-bar analysis this list needs (Part 3's explicit ask).

### Cafés, Markets & Local Flavor (Winston 13 → Final 20)

**Classification:** 19/20 Added from expanded catalog. 1/20 Retained-with-rewrite (Dallmayr — malformed-name fix from `01-original-70-disposition.md`'s UUID-certain rewrite table). 12 of Winston's 13 removed from this list (Auer Dult, Beirut Beirut/Backsteinchen, Café Erika/Gans am Wasser/Jasmin/Luitpold/Maria/Ruffini, Muffatwerk/Muffathalle, Vini e Panini, Wiener Platz, Elisabethmarkt) — most of these are the same generic-action items flagged as probable retirements in `01-original-70-disposition.md` (Café Erika: "indulge in homemade cakes"; Café Maria: "settle in for coffee"), so their removal from this list plausibly tracks their removal from the *catalog* rather than a list-specific judgment — but this cannot be fully confirmed for every one given the RLS-hidden-inactive-rows limitation already disclosed in `08-data-gaps-and-next-steps.md`. Two originals with a live/name-matched status that nonetheless were excluded here are worth flagging: Vini e Panini and Auer Dult are both confirmed name-matched-live in `01-original-70-disposition.md` yet do not appear in the final Cafés/Markets list — evidence of a genuine list-specific exclusion (catalog-retained, list-excluded), not a catalog casualty.

Final membership (20/20): the list requires, per the task brief's own bar for this list, "a specific order/ritual/stall/product/interaction/locally-distinctive experience" — every one of the 20 final items clears this: named dishes (Bismarck herring roll at Fisch Maier, Agria baked potato at Caspar Plautz, falafel pita at Sababa), named products (Franzbrötchen at Man Versus Machine, hand-shaped loaf at Neulinger), specific stall-level detail (Sweet Spot Kaffee and First8 Kombucha both named as specific Viktualienmarkt stands, not "visit Viktualienmarkt"). This is a real, measurable improvement over Winston's version, which included at least 2 items failing this exact bar (Café Maria: "settle in for coffee," no specific order; Wiener Platz: not even a business, a description of ongoing renovations).

### Hidden Gems (Winston 9 → Final 24)

**Classification:** 24/24 Added from expanded catalog. 0 Retained. All 9 of Winston's originals (Bei Dagmar, generic-Boazn, Café Erika, Call Soul, Restaurant LuPo, Viktualienmarkt, Zephyr Bar, Elisabethmarkt, Ristorante Nabucco) are absent from the final list — 4 of these 9 (Café Erika, Restaurant LuPo, Ristorante Nabucco, and the generic-Boazn item) are among the 14 probable-retirement items in `01-original-70-disposition.md`, i.e. plausibly gone from the catalog entirely, not merely excluded from this list. The other 5 (Bei Dagmar, Call Soul, Viktualienmarkt, Zephyr Bar, Elisabethmarkt) are confirmed or plausibly still catalog-live but excluded from Hidden Gems specifically — a defensible call, since none of Winston's originals actually had a discovery mechanic (see the discovery-basis analysis in `11-list-portfolio-scorecards.md`; "sample local specialties at Viktualienmarkt" and "sip a story-driven cocktail at Zephyr Bar" are not hidden-gem claims by any reading, they were simply placed on this list without a supporting rationale).

Final membership (24/24) is the single most editorially interesting list in the rebuild — see `11-list-portfolio-scorecards.md` for the full discovery-basis classification the task brief specifically requests (concealed-mechanic vs. visually-concealed vs. off-menu-discovery vs. overlooked-but-visible vs. neighborhood-favorite vs. famous-attraction-mislabeled).

### Beer Gardens, Breweries & Bavarian Rituals (new, 20 items) and Day Trips & Big Adventures (new, 20 items)

**Classification:** 20/20 and 20/20 Added from the expanded catalog — no original to compare against, since neither list existed in Winston's build. Both draw heavily on wave2's outer-municipality items (`02-new-item-contributions.md`) — Beer Gardens pulls 9 of its 20 items from surrounding-municipality neighborhoods (Andechs x2, Aying x2, Freising x2, Fürstenfeldbruck x2, Erding x1), and Day Trips pulls from 13 distinct outer neighborhoods (Erding, Starnberg, Taufkirchen, Oberschleißheim, Dachau, Aying, Bergkirchen, Garching, Grünwald, Herrsching, Andechs, Poing, Hallbergmoos), confirming these two lists are the primary consumer of the wave2/geographic-expansion inventory. Why Winston never proposed either list, despite the strength of the material, is analyzed in `10a` — see Part 4 below and `11-list-portfolio-scorecards.md`.

## Multi-list membership: distinct valid reasons vs. filler reuse

Every one of the 43 items reused across 2+ lists (full inventory in `09-final-list-rebuild-analysis.md`) was checked for whether its multi-list presence reflects a genuinely different reason per list or just filler reuse to pad counts:

- **Distinct, defensible reasons (majority of cases):** e.g. Weihenstephan appears in Beer Gardens (brewery-ritual angle), Day Trips (day-trip-destination angle), and Fall 2026 (seasonal-worthy-experience angle) — three different editorial lenses on one strong experience, not padding.
- **Same reason, reused for coverage rather than distinctiveness (the harder case):** Andechs Bräustüberl and Weihenstephan both appear in *all three* of Beer Gardens/Day Trips/Fall 2026 — defensible individually, but worth flagging in `11-list-portfolio-scorecards.md` as a signal that Day Trips and Beer Gardens share enough thematic surface area (both are "leave the city, drink/eat something Bavarian" experiences) that some of their overlap reads as two lists partially describing the same trip rather than two fully independent portfolios.
- **No case found** of an item being added to a second list purely to hit a target count with no thematic connection at all — every multi-list item plausibly belongs in every list it's in.

No original-70 item was found to have been "moved to a more appropriate list" in the literal sense (same body, different list, better fit) — because, as shown above, essentially no original-70 item survived list membership at all. The closest real example is Dallmayr, whose corrected body ("Sip a coffee at the legendary coffee counter") reads as more Cafés/Markets-appropriate than its original malformed form, but this was a body rewrite during the original-70 cleanup pass (documented in `01-original-70-disposition.md`), not a list-placement decision made by this SQL.
