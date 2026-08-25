# Investigate: does a third "Themed Lists" concept exist separately from official/curated lists, and why can't Pearl Street Regulars' image be edited from the Curated Lists tab?

Paste into Claude Code from inside the `checkoff` repo. Read-only investigation — no writes, no
schema changes, no commits. This follows up on the prior investigation
(`docs/metro-launch-audit/13_denver_list_table_investigation_prompt.md`), which answered a
narrower question (why Denver shows 8 rows in `curated_lists`) and concluded lists live in exactly
two tables: `public.lists` (is_official=true rows, used by Tucson/Milwaukee for themed content) and
`public.curated_lists` (used by Denver). Jerry says that conclusion may be incomplete — he
specifically recalls a product change where "Themed Lists" became their own thing, shown on the
Home Screen tab of the admin tool, and distinct from Curated Lists. Don't defer to the prior
investigation's conclusion; re-derive this from scratch and say plainly if it confirms, contradicts,
or refines it.

Separately: when Jerry edits the Pearl Street Regulars curated list in the admin tool's **Curated
Lists tab**, there's no way to attach an image to it. But list editing on the **Home Screen tab**
does have an image upload. Figure out why, concretely — not by inference from the first
investigation's table dump, but by reading both edit screens' actual code and the schema fields
each one writes to.

## Guardrails

* Read-only. Do NOT write to any table, do NOT modify the admin tool file, do NOT modify, commit,
  or push anything in this repo.

## Part 1 — Does a distinct "Themed Lists" concept exist?

1. Grep the entire repo (migrations, app code, docs) for "themed" (case-insensitive). Report every
   hit with file and surrounding context.
2. Grep `checkoff_admin.html` (on Jerry's machine at `/Users/jerrystuckart/Downloads/` per the
   prior investigation) for "themed" (case-insensitive) and for every distinct list-related section
   label in the Home tab's source — don't assume there are only two ("Seasonal / Official Lists"
   and "Curated Lists" via the "Start from a template" rail found last time). Read enough
   surrounding code to tell if there's a third panel, a `list_type` or `category` discriminator
   column, or a third table/query the prior pass didn't check.
3. Check `information_schema.tables` for any table whose name contains "theme" and any column
   (across `lists`, `curated_lists`, or elsewhere) named anything like `list_type`, `category`,
   `is_themed`, or similar that could be the actual discriminator Jerry remembers as "a switch."
4. Check migration history (`supabase/migrations/`) for anything mentioning "themed" — a schema
   change matching what Jerry recalls as "we made a switch."
5. If you find real evidence of a third concept, report its exact table/column/admin-panel details.
   If you genuinely find nothing beyond the two tables from the prior investigation, say that
   explicitly and don't strain to manufacture a third category — but do show the actual grep output
   so Jerry can see the search was real, not assumed.

## Part 2 — Why is there no image field on the Curated Lists tab's edit screen?

1. In `checkoff_admin.html`, find the actual edit UI/form for a curated list (the screen Jerry uses
   to edit Pearl Street Regulars) and the actual edit UI/form for a Home Screen tab list. Quote both
   pieces of source. Confirm which HTML form fields / JS state each one has — does the curated-list
   edit form have zero image-related fields at all, or does it have one that's just not rendering？
2. Check the schema: does `public.curated_lists` have any image-related column at all (`image_url`,
   `hero_image`, `header_image`, etc.)? Does `public.lists` have one? Compare directly.
3. If `public.lists` has an image column but `curated_lists` doesn't, that's the root cause and
   worth stating plainly. If `curated_lists` DOES have an image column that the admin tool's curated
   edit screen simply doesn't expose, that's a different root cause (a UI gap, not a schema gap) —
   distinguish these two possibilities clearly, don't conflate them.
4. Check how Tucson/Milwaukee's `is_official=true` themed lists in `public.lists` get their images
   today (if they have any) — is it the same field the Home Screen tab edits? This tells us whether
   Denver's curated lists are simply missing a feature the other pattern already has, or whether
   images were never wired up for audience-group lists at all, in any metro.
5. Check `metro_areas.hero_images` (confirmed to exist from earlier work in this project) — is that
   used anywhere for curated/themed list images, or is it strictly for the metro-level hero image?
   Don't assume; check actual usages in the app code (`grep` for `hero_images`).

## Do NOT

* Do not add an image column, do not modify the admin tool, do not touch any list or its data.
* Do not guess at a fix in this pass — this is fact-finding only. A follow-up prompt will handle
  any actual schema/UI change once Jerry decides what he wants.

## Report back

1. Part 1: the real grep results (repo + admin tool + schema + migrations) and a plain verdict —
   does a genuine third "Themed Lists" concept exist, and if so, exactly what it is (table, column,
   admin panel). If not, say so plainly with the search evidence shown.
2. Part 2: the actual curated-list edit form and Home Screen list edit form source (quoted), the
   schema comparison between `curated_lists` and `lists` for image columns, and a plain statement of
   whether this is a schema gap, a UI gap, or something else.
3. Whether Tucson/Milwaukee's official-list-table themed lists currently have images set, and
   through which mechanism.
4. Anything you could not determine (e.g. the admin tool being partially inaccessible) — state
   explicitly rather than filling gaps with assumption.
