# Pull real schema + cross-metro examples for curated-list tagline/description/end-date fields (read-only)

Paste into Claude Code from inside the `checkoff` repo. Read-only — no writes, no schema changes,
no commits. Jerry wants to fill in a tagline (short hook shown on cards), a longer optional
description, and an end date for Denver's 8 `curated_lists` rows (Hoptimists, Trail Mix Crew,
Pearl Street Regulars, Main Character Cardio, Powder Day People, RiNo Rats, Snack Pack Survivors,
Soft Launch Season — ids and details in
`docs/metro-launch-audit/13_denver_list_table_investigation_prompt.md`'s prior findings if you need
them again). Before writing any content or SQL, get the real facts:

## Part 1 — Confirm the actual columns

`\d public.curated_lists` (full dump, all columns, not just the ones confirmed so far — `id`,
`title`, `is_active`, `slug`, `city_slug` are already known real). Specifically look for:

* A short-hook/tagline column (could be `tagline`, `subtitle`, `hook`, `short_description`, etc.)
* A longer description column (could be `description`, `body`, `blurb`, etc.)
* Any date column at all — `ends_at`, `end_date`, `expires_at`, `season_end`, or similar. If there
  is genuinely no date column on this table, say so plainly — that would mean curated lists in this
  product don't currently have an end date concept at all, which is itself an important finding,
  not something to paper over.

Do not assume any of these column names — report exactly what exists, including ones that exist
but are currently all NULL.

## Part 2 — Pull cross-metro examples to establish the real convention

Query all 54 `curated_lists` rows (`SELECT id, title, city_slug, is_active, slug`, plus whatever
tagline/description/date columns Part 1 finds, `ORDER BY city_slug, title`). Report the full table.
For every non-Denver row that has non-NULL values in the tagline/description/date columns, show
them verbatim — these are the real pattern to match, not a guess. If most rows are NULL across the
board (i.e. this content was never actually populated for other metros either), say that plainly —
it changes the answer from "match an existing convention" to "there may not be an established
convention yet, and Jerry's decision is needed on what one should be."

## Part 3 — Check how other metros' *themed* lists (in `public.lists`, is_official=true) set their end dates

For comparison, pull `title, starts_at, ends_at` for every `is_official = true` row in `public.lists`
across all metros (not just Wisconsin Weird/Dark Skies/Foodies of Tucson already found — all of
them). Report the actual pattern: do themed/seasonal lists in that table end at a fixed date shared
across a season (like Denver Fall 2026's 2026-11-30), or does each list have its own independent end
date, or do some have `ends_at = NULL` (open-ended)? This directly informs whether Denver's 8
curated lists should share one end date, follow the season, or be treated as evergreen with no end
date at all — don't guess, show the actual data.

## Do NOT

* Do not write any tagline, description, or date to any row.
* Do not add or alter any column.
* Do not commit, push, or modify the admin tool.

## Report back

1. The full, real column list for `public.curated_lists` (Part 1), stating explicitly whether
   tagline/description/end-date columns exist and their exact names, or whether any are missing
   entirely.
2. The full cross-metro `curated_lists` data pull (Part 2), with real non-NULL examples quoted
   verbatim, or an explicit statement that none exist yet.
3. The full `is_official=true` end-date pattern across metros (Part 3), with actual values, so we
   can see whether there's a real "matches other metros" convention for end dates or whether this is
   genuinely undecided territory.
4. Current values (even if all NULL) for Denver's 8 specific curated_lists rows in these same
   fields.
