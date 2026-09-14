# Final List Rebuild — Verification Analysis (Part 1)

**Scope of this file:** verify `munich_lists_rebuild_no_temp_tables.sql` (839 lines, provided as a completed, already-`COMMIT`ed production transaction) against live Munich list/list_item state. Every check below is a `SELECT` against `AGENT_SERVICE_DATABASE_URL`. **No write was issued.**

## Bottom line

**The SQL's intent matches current production exactly. No discrepancy was found.**

Every one of the SQL's own postflight assertions (`IF v_count <> N THEN RAISE EXCEPTION`) would pass today, confirmed independently via live `SELECT`:

| List | SQL's asserted final count | Live count | Match |
|---|---|---|---|
| Fall 2026 — Munich Metro | 30 | 30 | Yes |
| Hidden Gems | 24 | 24 | Yes |
| Cafés, Markets & Local Flavor | 20 | 20 | Yes |
| Munich After Dark | 24 | 24 | Yes |
| Beer Gardens, Breweries & Bavarian Rituals | 20 | 20 | Yes |
| Day Trips & Big Adventures | 20 | 20 | Yes |

No duplicate `(list_id, item_id)` memberships exist in any of the six lists (checked directly — every `item_id` appears at most once per list). No membership row points at an inactive, unapproved, or non-Munich item — every one of the 138 live memberships across these six lists resolves to an `i.is_active = true`, `i.is_approved = true` item whose `neighborhood_id` belongs to the Munich metro (`06e7a733-124c-45ed-be42-de82587c9125`), via the same join used throughout this whole calibration analysis.

## Six lists, all present and correctly named

| Title (live) | List UUID | is_official | is_public | is_featured_eligible | creator_id |
|---|---|---|---|---|---|
| Fall 2026 — Munich Metro | `eb4026f3-08f2-4319-a19c-49bdf46061fe` | true | true | true | `11275026-65be-4421-80a4-46c57195408b` |
| Hidden Gems | `02876bba-0e5e-49e0-8806-1294acdf4669` | true | true | true | `11275026-65be-4421-80a4-46c57195408b` |
| Cafés, Markets & Local Flavor | `6042e009-da51-48bd-a5c0-4d11240cdf80` | true | true | true | `11275026-65be-4421-80a4-46c57195408b` |
| Munich After Dark | `00cdf87e-c850-4d42-9fcd-69183f5b362b` | true | true | true | `11275026-65be-4421-80a4-46c57195408b` |
| Beer Gardens, Breweries & Bavarian Rituals | `385a4daf-2f09-42ec-a154-3390a3b6779c` | true | true | true | `11275026-65be-4421-80a4-46c57195408b` |
| Day Trips & Big Adventures | `fcaa50a0-bfb5-4c94-b58e-9408654b907f` | true | true | true | `11275026-65be-4421-80a4-46c57195408b` |

`created_at` for the two newly created lists (Beer Gardens, Day Trips) is `2026-09-14T15:43:23.973Z` — a few minutes before all six lists' `updated_at` of `2026-09-14T15:44:49.572Z`, consistent with the transaction's own sequencing (list-shell creation in `$setup$`, then per-list body writes). The four pre-existing lists (Fall 2026, Hidden Gems, Cafés/Markets, Munich After Dark) carry an earlier `created_at` of `2026-09-14T05:00:45.764Z` — i.e. they existed (empty or Winston-populated) before this transaction ran, and this transaction only rewrote their membership, matching the SQL's `DELETE FROM list_items WHERE list_id = v_list_id` + fresh `INSERT` pattern per list.

**No obsolete "After Dark" shell exists live** — only "Munich After Dark" is present. The SQL's `$setup$` block has three branches for this (delete-old-if-both-exist / rename-old-if-only-old-exists / no-op-if-only-new-exists); live state is consistent with either the rename branch or the no-op branch having fired, and cannot be distinguished after the fact from list state alone. This is not a discrepancy — both surviving branches produce the same final state the SQL asserts, and the live result is the correct one either way.

**Every Munich seasonal/themed list affected:** all six titles named in the SQL. **Newly created Munich lists:** exactly two — "Beer Gardens, Breweries & Bavarian Rituals" and "Day Trips & Big Adventures" — confirmed via `created_at` timing above (the SQL's own comment also says this: "creates two Munich-specific themed lists").

## Body-text resolution: fragile by construction, flagged per list

**Every single item resolution in this 839-line SQL — all six lists, all 138 planned memberships — is done by exact `body = '...'` string match, never by item UUID.** This is not incidental to one or two lists; it is the SQL's only resolution mechanism throughout, guarded in every list's `DO` block by the same two-step pattern:

1. **Preflight:** a `LEFT JOIN`-based check (`plan LEFT JOIN items i ON i.body = plan.item_body ... GROUP BY ... HAVING count(i.id) <> 1`) that fails closed — it raises on **either** zero matches (item not found) **or** more than one match (ambiguous body) — before any `DELETE`/`INSERT` runs.
2. **Postflight:** a straight `SELECT count(*) ... IF v_count <> N THEN RAISE EXCEPTION`.

Per list:

- **Fall 2026 — Munich Metro** — 30/30 items resolved by body match; preflight `HAVING count(i.id) <> 1` guard present; postflight count assertion present. Live: 30/30 confirmed.
- **Hidden Gems** — 24/24 by body match; same two guards. Live: 24/24 confirmed.
- **Cafés, Markets & Local Flavor** — 20/20 by body match; same two guards. Live: 20/20 confirmed.
- **Munich After Dark** — 24/24 by body match; same two guards; additionally depends on the inline `UPDATE public.items SET body = ...` Schumann's Bar repair running successfully earlier in the same transaction, since the After Dark plan's row 11 (`'Show up after midnight, when 'Schumann's Bar' says it truly becomes a bar.'`) would not have resolved against the pre-repair (doubled-apostrophe) body. Live: 24/24 confirmed, and the Schumann's Bar item's live body is the corrected single-apostrophe form (`"Show up after midnight, when 'Schumann's Bar' says it truly becomes a bar."`) — the repair took effect. See `13-list-sql-generation-safeguards.md` for the escaping analysis.
- **Beer Gardens, Breweries & Bavarian Rituals** — 20/20 by body match; same two guards, applied to a freshly created list. Live: 20/20 confirmed.
- **Day Trips & Big Adventures** — 20/20 by body match; same two guards, applied to a freshly created list. Live: 20/20 confirmed.

This fragility did not cause a production incident *in this specific run* — every preflight guard passed, meaning the transaction's own `COMMIT` is proof that all 138 body strings matched exactly one live item at execution time. But it is still the single largest structural risk in the SQL: a body string that is edited even slightly by a future catalog-voice pass, a future de-duplication merge, or a future item edit would silently break this transaction's assumption on a **rerun**, and (per the preflight design) would fail loudly rather than corrupt data — which is the right failure mode, but only because the guard exists. See Part 5 (`13-list-sql-generation-safeguards.md`) for why production item UUIDs should have been used instead once each item had been resolved once.

## Duplicate memberships

None. Checked directly: no `(list_id, item_id)` pair repeats within any of the six lists. The SQL's own `ON CONFLICT (list_id, item_id) DO NOTHING` plus the `DELETE FROM list_items WHERE list_id = v_list_id` immediately before each list's `INSERT` (a full replace, not an incremental add) makes exact-duplicate membership rows structurally impossible on a clean run, and live data confirms this.

## Items assigned to an inappropriate list

No membership row was found where the item's neighborhood falls outside Munich metro, or where the item is inactive/unapproved. Whether individual items are a **strong editorial fit** for the specific list they're in (as opposed to merely present) is a curation-quality question, not a data-integrity one — that's covered in `11-list-portfolio-scorecards.md` (Part 3).

## Cross-list membership: extensive multi-list reuse, no true duplicates

Of 184 active Munich items, **95 distinct items appear across the six lists' 138 total memberships** — meaning 43 items appear in more than one list, and 89 of the catalog's 184 items appear in **no** curated list at all. The heaviest reuse:

| Item (body, abridged) | Lists it's in (count) |
|---|---|
| "Eat the cellar-made Weißwurst before noon at 'Gaststätte Großmarkthalle'." | Beer Gardens, Cafés/Markets, Fall 2026, Hidden Gems (4) |
| "Bring your own Brotzeit... into 'Andechs Bräustüberl'." | Beer Gardens, Day Trips, Fall 2026 (3) |
| "Tour the brewhouse... at 'Weihenstephan'." | Beer Gardens, Day Trips, Fall 2026 (3) |
| "Order the rum-soaked canelé... at 'Lea Zapf Marktpatisserie'." | Cafés/Markets, Fall 2026, Hidden Gems (3) |
| "Dance among shipping containers... at 'Bahnwärter Thiel'." | Fall 2026, Hidden Gems, Munich After Dark (3) |

No case of the "same item, same list, twice" kind of duplicate exists. Every multi-list case is the "distinct valid reasons" kind the task asks about — evaluated item-by-item in `10-original-vs-final-list-decisions.md` (Part 2).

## Unintended Munich catalog items

No item was found in any of the six lists that reads as an unintentional or accidental inclusion (e.g., a body/venue mismatch, a stray test row, or an item from a different metro — impossible by construction since every resolution requires `i.body = plan.item_body` **and** implicitly the neighborhood join used to scope this whole analysis to Munich already filters to Munich). No out-of-metro leakage was found.

## Items expected by the SQL but missing from final membership

None. Every one of the 138 planned `(item_body, sort_order)` pairs across all six `VALUES` blocks has a corresponding live `list_items` row. This was checked by reconciling the live per-list counts (which match the SQL's asserted final counts exactly) — a missing item would have produced a live count below what the SQL asserts, and the SQL's own postflight check would have raised on `COMMIT` if that had happened. Since the transaction is `COMMIT`ed and live counts match, no gap exists.

## Treatment of production-as-execution-result vs. SQL-as-intent

Per the task's framing: SQL is evidence of intent, live DB is the execution result, and disagreements should be reported rather than silently resolved. **There is no disagreement to report.** This is itself worth stating plainly, because it is not automatic — the SQL contains two branch points (the After Dark rename-or-delete logic, and the `INSERT ... WHERE NOT EXISTS` list-shell creation) whose exact code path cannot be distinguished after the fact, but both possible paths converge on the same live state the SQL's own assertions require, so the ambiguity is inert rather than a real gap.
