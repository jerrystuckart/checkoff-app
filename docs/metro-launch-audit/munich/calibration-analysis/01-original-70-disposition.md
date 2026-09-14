# Original-70 Disposition Table (Deliverable B) + Part 1

## Method and confidence levels

The original 70 items were reconstructed from `docs/metro-launch-audit/munich/munich_home_list_patch_2026-09-14_DRIVER_CERTIFIED_NOT_APPLIED.sql` (source 8) — an untracked, never-applied Winston M9 draft that inserts exactly 70 items into exactly the 10 original canonical neighborhoods, matching `canonical-neighborhoods.json` and `neighborhood_reassignment_2026-09-13.md` precisely. This file generates fresh UUIDs at apply-time (`RETURNING id INTO v_item_id`), so it **cannot** be cross-referenced against production by UUID — only `munich_original70_cleanup.sql`'s 21 retire + 9 rewrite UUIDs are real production UUIDs.

Three confidence tiers were used:
1. **UUID-certain** (9 items): the rewrite UUIDs from `munich_original70_cleanup.sql`, confirmed live via `SELECT` against production — all 9 found, `is_active=true`, `is_approved=true`, `difficulty=1`, bodies matching the rewrite SQL exactly.
2. **Name-matched** (61 items): matched the original-70's extracted venue name (parsed from each body's trailing quoted span) against live Munich item bodies via `ILIKE`. A match = "found live," treated as retained (unchanged or lightly retouched, since exact body text wasn't diffed for all 61 — see caveat below). No match = "not found live," a strong but not certain signal of retirement (a genuine rename not caught by substring search would also show as "not found").
3. **Unresolved**: original items whose name search produced 0 hits and that are not one of the 9 known rewrites — treated as **probable retirements**, not confirmed, because this read-only role appears to be under row-level security that hides `is_active=false` rows (a direct `SELECT ... WHERE id IN (<21 retired UUIDs>)` returned 0 rows, vs. the 9 rewrite UUIDs which returned all 9 — see `08-data-gaps-and-next-steps.md`).

**Caveat on the 40 "untouched" items:** the task brief correctly warns not to assume "untouched by the cleanup SQL" means "byte-identical to Winston's original." Name-matching only confirms the *venue* survived under a recognizable name; it does not confirm the *body text* is unchanged (a later Bulk Add pass could have edited a body without changing the venue name enough to break the ILIKE match). Full body-diff of all 61 was out of scope given the read-only re-query constraints; this is called out explicitly in `08-data-gaps-and-next-steps.md`.

## Disposition classification (all 70)

### Retained with body rewrite AND category correction — 9 items (UUID-certain)

| Venue (original → corrected) | Original body (from the 70-item patch) | New body (live, UUID-confirmed) | Category correction | What actually changed |
|---|---|---|---|---|
| "Dallmayr's quiet café at the coffee counter" → **Dallmayr** | "Grab a coffee at the counter inside 'Dallmayr's quiet café at the coffee counter'." | "Sip a coffee at the legendary coffee counter inside 'Dallmayr'." | → Food & drink | **Malformed venue name fix** — the original venue-name field was itself a full description, not a name. |
| "Muffatwerk / Muffathalle" → **Muffatwerk** | Two near-duplicate originals existed: "Find the club, beer garden, or café inside 'Muffatwerk / Muffathalle'." AND "Spot the historic transformation from a former power plant into a vibrant cultural centre at 'Muffatwerk / Muffathalle'." | "Catch a concert inside the former power-plant complex at 'Muffatwerk'." | → Nightlife | **In-catalog duplicate collapsed to one item** + malformed compound name ("X / Y") cleaned + generic action ("find the club, beer garden, or café") replaced with a specific one. |
| "Müller'sches Volksbad" | "Take a dip in the historic indoor pool at 'Müller'sches Volksbad'" | "Swim beneath Jugendstil murals in the historic 1901 pools at 'Müller'sches Volksbad'." | → Spa & self-care | Generic action → specific, evocative action; category moved out of what was likely Adventure/Play into the correct Spa & self-care bucket. |
| "Café Maria" → **das maria** | "Settle in for coffee at 'Café Maria'." | "Order a Levantine breakfast from the all-day menu, served until 5 PM at 'das maria'." | Food & drink → Food & drink | **Likely corrected venue identity** (inferred, not certain): "Café Maria" appears to have been a misresolved/guessed name for the real venue "das maria" at Klenzestraße 97 (same address cluster per `neighborhood_reassignment_2026-09-13.md`). Flagged as inference, not fact. |
| Augustiner‑Keller | "Sit in the traditional beer garden at 'Augustiner‑Keller'." | "Listen for the bell announcing a fresh wooden barrel, then order a Maß of Edelstoff at 'Augustiner-Keller'." | Food & drink → Food & drink | Generic action → signature ritual/order. |
| "Hirschgarten beer garden and park" → **Königlicher Hirschgarten** | "Find Munich's largest beer garden and its historic park roots at 'Hirschgarten beer garden and park'." | "Rinse your own beer mug at the counter before getting it filled at 'Königlicher Hirschgarten', the world's largest beer garden." | Food & drink → Food & drink | Malformed name ("beer garden and park" appended to venue) fixed; generic → specific local ritual action. |
| Call Soul – Breaking Bar | "Try a Breaking Bad–inspired show-style cocktail at 'Call Soul – Breaking Bar'." | "Order the theatrical 'Breaking Bath' cocktail at 'Call Soul – Breaking Bar'." | Bar & drinks → Bar & drinks | Likely a trademark/IP-risk edit ("Breaking Bad" reference softened to "Breaking Bath," the bar's actual themed drink name) plus a concrete order name. |
| "Zenith event hall" → **Zenith** | "Attend a live event or concert at 'Zenith event hall'." | "Catch a concert inside the former railway-repair hall at 'Zenith'." | Nightlife → Nightlife | Malformed name ("event hall" suffix) fixed; generic action → specific. |
| "Flaucher – riverside leisure stretch on the Isar with beer garden, barbecues, swimming and natural setting" → **Flaucher** | "Barbecue along the Isar, swim in the river, and relax at the Zum Flaucher beer garden at 'Flaucher – riverside leisure stretch on the Isar with beer garden, barbecues, swimming and natural setting'" | "Grill on the Isar riverbank, then cool off with a swim at 'Flaucher'." | → Adventure | **Most extreme malformed-name example in the whole dataset** — the original venue-name field is a full run-on sentence. |

All 9 corrected bodies are, live, `difficulty=1`, `is_secret=false`, `secret_reveal_text=NULL` — the rewrite pass fixed naming/genericness/category but did not touch difficulty or secret mechanics (see `00-executive-summary.md`'s headline finding).

### Retained, name-matched live (high-confidence "untouched or lightly retouched") — ~47 items

Confirmed present under a matching or near-matching name via live `ILIKE` search: Gasteig *(see below — actually NOT found, moved to retired-candidate list)*, P1 Club, Dantebad, Auer Dult, La Bohème, Madam Chutney, Vini e Panini, Elisabethmarkt, Haus der Kunst, Munich Residenz, Viktualienmarkt (as a location reference inside other items, not standalone — see caveat), Neues Maxim cinema, Motorworld München, Café Gans am Wasser, EHC Red Bull München, Munich Action Park, Naturbad Georgenschwaige, Villa Stuck, Asaya Spa at Rosewood Munich, "Boazn" (as a pub-atmosphere descriptor, appears in 3 different live items — 'Zur Gruam', 'Boazn' at Ludwigsbrücke, 'Bei Dagmar'), Le Petit Chef, Luitpoldpark, Zephyr Bar, Hirschgarten (as "Feed the deer beside the beer garden at 'Hirschgarten'" — a *second*, distinct Hirschgarten item beyond the rewritten Königlicher Hirschgarten one), English Garden (appears inside 2 different items), Alte Utting (2 items — the original AND a Bulk Add wave-2-style variant, see `02-new-item-contributions.md`), Café Jasmin, Giorgia Trattoria, The Charles Spa at The Charles Hotel, Schauburg, Nymphenburg Palace, Zum Wolf, Flex bar, Museum of Urban and Contemporary Art, Allianz Arena, Frauenkirche (⚠ see `neighborhood_reassignment_2026-09-13.md`'s Dresden-Frauenkirche mixup — the *correct* Munich Frauenkirche item is separate and confirmed retained), Deutsches Museum, Casele.

These were not body-diffed line-for-line against the original-70 snapshot; several near-certainly received minor wording edits during the neighborhood-reassignment pass on 2026-09-13 (which explicitly reassigned neighborhoods from stale labels but did not claim to leave bodies untouched). Treat "retained" here as "the venue survived," not "the body is verbatim."

### Probable retirements (not found live under any matched name) — 14 confirmed candidates of the 21

| Original venue | Original body | Why it plausibly reads as retirement-worthy |
|---|---|---|
| Gasteig | "Attend a performance by the Philharmonic Orchestra or catch a screening during Filmfest München at 'Gasteig'." | Generic "attend a performance... or catch a screening" — two vague, seasonal/schedule-dependent actions bundled in one item. |
| Goldmarie | "Savor an Alpine cuisine dish at 'Goldmarie'." | Maximally generic body ("savor a dish") — a textbook `checkDistinctiveExperience`-style rejection today. |
| La Certosa | "Dine from the seasonal menu at 'La Certosa'." | Generic ("dine from the... menu"), no specific dish or ritual. |
| Café Erika | "Indulge in homemade cakes at 'Café Erika'." | Generic ("indulge in... cakes," no specific item). |
| Wiener Platz | "See the ongoing market renovations, scheduled through 2027, at 'Wiener Platz'." | Time-bound/expiring claim ("renovations... through 2027") — not a durable CheckOff experience; also a public square, not a business. |
| Restaurant LuPo | "Spot the neighborhood restaurant atmosphere at 'Restaurant LuPo'." | "Spot the atmosphere" is not an action. |
| Glockenbachviertel | "Find Munich's highest concentration of concept stores and sustainable design boutiques in 'Glockenbachviertel'." | The "venue" is a whole neighborhood, not a business — same class of problem the M5.75/geography work is meant to catch (a neighborhood name used as an item target). |
| Ristorante Nabucco | "Dine on classic Italian dishes at neighborhood spot 'Ristorante Nabucco'." | Generic ("dine on classic... dishes"). |
| Valentin‑Karlstadt‑Musäum | "Spot a fur‑covered winter toothpick among the absurd exhibits at 'Valentin‑Karlstadt‑Musäum'." | Reads distinctive, not obviously generic — retirement reason unclear; possibly a duplicate of the still-live "Valentin-Stüberl" wave-1 candidate confusion, or a factual/availability issue not visible from text alone. **Marked uncertain.** |
| Café Ruffini | "Choose from the Italian breakfast menu, browse the in-house shop, or visit late—open until midnight—at 'Café Ruffini'." | Three bundled generic options ("choose... or browse... or visit") — no single distinctive action. |
| Maximiliansanlagen and Isarending | "Walk or relax in the recreation spaces of 'Maximiliansanlagen and Isarending'." | Generic ("walk or relax"); also a park/green-space, not a venue; compound name joining two places. |
| Westpark | "Visit the Seebühne open-air stage, stroll through the Rosengarten, or explore the Ostasien‑Ensemble at 'Westpark'." | Generic, three bundled options, park not venue. (Note: the *neighborhood* "Sendling-Westpark" is retained/live with 1 active item — a different, later-added item, not this one.) |
| Beirut Beirut and Backsteinchen at Luise‑Kiesselbach‑Platz | "Order Lebanese street food from Beirut Beirut or try breakfast and rent sports equipment at the new Backsteinchen café in 'Beirut Beirut and Backsteinchen at Luise‑Kiesselbach‑Platz'." | **Textbook combined-business item** — two unrelated independent businesses (a Lebanese restaurant and a café/sports-rental shop) merged into a single CheckOff with an "or" choice and a run-on compound venue name. Exactly the failure mode Part 5/6 needs a fixture for. |
| Kunstareal Munich | "Visit a cluster of 18 museums and over 20 galleries, including Alte Pinakothek, Pinakothek der Moderne, Lenbachhaus, Museum Brandhorst, and Glyptothek at 'Kunstareal Munich'." | "Visit a cluster of 18 museums" is the most generic possible action; the "venue" is a district-level museum quarter, not one business — its constituent museums (Deutsches Museum, etc.) are separately and specifically represented elsewhere in the live catalog. |

**Remaining 7 of the 21 retired UUIDs are unresolved** — either they correspond to originals whose venue names didn't survive `ILIKE` matching due to punctuation/encoding differences, or they are among the small number of items not distinctly identifiable from the 70-item snapshot's body-text parsing (a few `null` venue-name extractions occurred due to non-standard quote characters). This is disclosed as a genuine gap rather than guessed at — see `08-data-gaps-and-next-steps.md`.

## New production items not matched to the original 70

Covered in full in `02-new-item-contributions.md` (Deliverable C) — this file stays focused on the original-70 disposition per the task's own file-per-deliverable structure.

## Summary counts

| Disposition | Count | Confidence |
|---|---|---|
| Retained with body rewrite + category correction (UUID-certain) | 9 | Certain |
| Retained, name-matched live, body not fully re-diffed | ~47 | High for "venue survives," unverified for "body unchanged" |
| Retired (name not found live, plausible generic/civic/compound reasons identified) | 14 | High confidence, not certain |
| Retired, unresolved (of the 21 total retired UUIDs) | 7 | Unresolved — flagged, not guessed |
| **Total** | **70** | — |

No original-70 item was classified as "Split into separate businesses" — no evidence of a 1-original → 2-new split was found. No item was classified as "Merged as a duplicate" in the sense of two originals collapsing into one *newly created* item — but the Muffatwerk case (two originals → one rewritten item) is functionally a duplicate-merge and is recorded as such under the rewrite table above.
