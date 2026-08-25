# Investigate: why does Denver show 8 lists under "Curated" in the admin tool, and why do other metros' audience lists (Foodies of Tucson, Wisconsin Weird, Dark Skies) apparently live as *official* lists instead?

Paste into Claude Code from inside the `checkoff` repo. This is a read-only investigation — no
writes, no schema changes, no commits. Jerry just noticed something that doesn't match his mental
model of the product: after running `supabase/migrations/20260822_denver_list_membership.sql`
(which populated the pre-existing `public.curated_lists` shells for Hoptimists, Trail Mix Crew, and
Pearl Street Regulars), the admin tool shows Denver's "Denver Fall 2026" list correctly under
Seasonal/Official Lists — but the equivalent audience-group lists for other metros ("Foodies of
Tucson," "Wisconsin Weird," "Dark Skies" (Tucson)) show up as *official* lists in the same admin
view other metros use, not as curated lists. And when Jerry looks at Denver's "Curated Lists"
section in the admin tool, he sees **8** lists, all inactive — not the 3 we expected
(Hoptimists/Trail Mix Crew/Pearl Street Regulars).

Do not assume this is a bug in the migration we just ran (it populated exactly the 3 IDs the
manifest specified, and postflight guards confirmed exact row counts against those 3 IDs — that
part is independently verified and correct). This is a data-modeling / admin-tool question: which
table each metro's audience-group lists actually live in, and why Denver has 5 more curated rows
than expected.

## Guardrails

* Read-only. Do NOT write to `public.lists`, `public.curated_lists`, `public.list_items`,
  `public.curated_list_items`, or any other table.
* Do NOT modify, commit, or push anything.

## Step 1 — Enumerate every row Denver actually has in both tables

Run (and show full output, not just counts):

```sql
-- Everything in public.lists scoped to Denver
SELECT id, title, is_official, is_public, starts_at, ends_at, metro_id
FROM public.lists
WHERE metro_id = (SELECT id FROM public.metro_areas WHERE slug = 'denver')
ORDER BY starts_at NULLS LAST;

-- Everything in public.curated_lists that could plausibly be Denver's
-- (figure out the real scoping mechanism first -- see Step 2)
SELECT * FROM public.curated_lists ORDER BY title;
```

Report the exact row count and every column value for each. In particular: does `public.lists`
have any other Denver rows besides the one official Fall 2026 list we already know about? Does
`public.curated_lists` really have 8 rows total, or 8 that resolve to Denver specifically, and by
what mechanism (a `metro_id` column on the table itself? scoping only through the items each list
contains, via `curated_list_items` -> `items.neighborhood_id` -> `neighborhoods.metro_id`)?

## Step 2 — Find out how `public.curated_lists` is actually scoped to a metro

`curated_lists` was confirmed to have `id`, `title`, `is_active` in the prior session — check
`\d public.curated_lists` again and confirm every column, especially whether there's a `metro_id`
or `metro_slug` or similar direct FK. If there isn't one, figure out how the admin tool determines
"this curated list belongs to Denver" — grep the admin tool's source (find it in the repo, likely
under an `admin/` or similar directory, or check if the admin panel is a separate app/repo Jerry
would need to point you to) for however it queries/filters curated lists by metro. Don't guess;
find the actual query or API call.

## Step 3 — Find out how "Foodies of Tucson" / "Wisconsin Weird" / "Dark Skies" are actually stored

Query for these three by name:

```sql
SELECT id, title, is_official, is_public, starts_at, ends_at, metro_id
FROM public.lists
WHERE title ILIKE '%foodies%' OR title ILIKE '%wisconsin weird%' OR title ILIKE '%dark skies%';

SELECT id, title, is_active
FROM public.curated_lists
WHERE title ILIKE '%foodies%' OR title ILIKE '%wisconsin weird%' OR title ILIKE '%dark skies%';
```

Report which table each one actually lives in, and every column value. This tells us definitively
whether other metros' audience-group lists are modeled as `is_official = false` rows in
`public.lists`, or as rows in `public.curated_lists` the admin tool happens to surface under an
"Official Lists" tab for reasons we don't yet understand.

## Step 4 — Reconcile the admin tool's own logic

Find wherever the admin tool (or its API layer, in this repo or one Jerry points you to) decides
which section a list appears under ("Seasonal / Official Lists" vs "Curated Lists"). Quote the
actual query or filter condition. The goal is a definitive answer to: is the distinction
`is_official = true` vs a row existing in `curated_lists` at all? Or something else (a `list_type`
column, a naming convention, a join)?

## Do NOT

* Do not create, delete, or reassign any list, regardless of what you find.
* Do not assume the 20260822_denver_list_membership.sql migration did anything wrong — it's
  already independently verified against the 3 IDs the manifest specified. This investigation is
  about the *other* 5 curated rows and the cross-metro modeling inconsistency, not about redoing
  that work.

## Report back

1. The exact full row list from Step 1 for both tables (or however `curated_lists` actually scopes
   to Denver) — all 8 curated rows by id/title, and confirmation of whether `public.lists` has any
   Denver rows beyond the one we know about.
2. How `curated_lists` is actually scoped to a metro (the real column/mechanism, quoted from `\d`
   output or the admin tool's own query).
3. Where "Foodies of Tucson," "Wisconsin Weird," and "Dark Skies" actually live (which table, full
   row data), and what that implies about the intended data model.
4. The admin tool's actual section-assignment logic, quoted directly from source.
5. A plain, non-speculative statement of what you found — if you genuinely can't determine the
   admin tool's logic (e.g. it's a separate repo you don't have access to), say so explicitly
   rather than guessing.
