# Target list storage findings — read-only, live production queries

`list_id = 692cb6bc-cbeb-4740-af6f-5f1833673a0f` ("Half Century, Full Steins: Munich 2026")

All queries below are read-only `SELECT`s executed via `supabase db query --linked` (Management API, no direct Postgres password used, no writes possible through this path). No rows were modified.

## List type / official status

```
id:                      692cb6bc-cbeb-4740-af6f-5f1833673a0f
title:                   Half Century, Full Steins: Munich 2026
is_official:             false   <-- THIS IS THE ROOT CAUSE OF BLOCKER 1
is_public:                false
is_creator_list:         false
source_destination_list_id: null
season_id:               null
creator_id:              11275026-65be-4421-80a4-46c57195408b
starts_at / ends_at:     2026-09-21 / 2026-09-25
```

**The target list is a genuine, ordinary personal (non-official) user-created list.** `lib/checkOffAttachment.js`'s `resolveCheckOffAttachment()` nulls `listItemId` for exactly this shape of list (`is_official: false`) — every one of this list's 25 real catalog items would therefore be unusable via the original Trip Mode client code, which called that shared resolver and refused to submit when it came back null.

## 25 catalog membership rows

Table: `public.list_items`, `list_id = 692cb6bc-...`. All 25 confirmed live (`is_partner_item: false`, `is_bonus_drop: false`, `point_multiplier: 1.00` on every row). Two representative rows (full 25 captured in this session's scratchpad, `q_li_rows.json`):

```
list_items.id: 7ac62514-3d0a-4285-b4f5-11b26ea06202  ->  items.id: 2cfddc3d-7eaf-4d7c-b786-dc6cada76bbc
list_items.id: 92778db6-4c4b-4f50-ac28-53b7c13674a8  ->  items.id: 10d4334c-1c1b-4ea5-b939-0db28caf9168
... (23 more, same shape)
```

Each `list_items.id` is what `check_ins.list_item_id` points to for a normal live completion of one of these 25 items.

## 3 private-item rows

Table: `public.user_suggestion_list_items`, `list_id = 692cb6bc-...` — **NOT** `list_items`, and **NOT related to `check_ins` in any way**:

```
id: 3aacb6ec-c86d-4094-9a22-78bfb47424ce  suggestion_id: bca55666-...  checked: false  checked_at: null
id: ea05eb1c-fb95-4903-99e0-d83c3a02dac0  suggestion_id: 94e37cb4-...  checked: true   checked_at: 2026-09-23 07:15:02+00
id: 5d71f5e5-8a6c-4b9d-bde3-c541f5915677  suggestion_id: 0100d181-...  checked: false  checked_at: null
```

`user_suggestion_list_items` columns: `id, suggestion_id, list_id, user_id, checked (boolean), checked_at (timestamptz), created_at`. `suggestion_id` FKs to `user_suggestions` (columns: `id, user_id, metro_id, place_name, experience_body, website_url, status, created_at, notes`) — **no `item_id` column, no `difficulty` column, no `points_awarded` concept anywhere in this pair of tables.**

**Completion of a private item is a direct boolean toggle on `user_suggestion_list_items.checked`/`checked_at`** — confirmed by tracing the only code that touches this table: `screens/ListScreen.jsx` (the toggle handler) and `screens/SuggestPlaceSheet.jsx` (creation). `screens/ItemDetailScreen.jsx` — where Trip Mode lives — never references `user_suggestion_list_items` at all; there is no route from a private item into the check-off flow Trip Mode extends.

## How normal completion attaches each type

| Type | Storage | FK/attachment | Uniqueness |
|---|---|---|---|
| Catalog item (25 rows) | `check_ins` row, `checkin_method`/`verification_method` set | `check_ins.list_item_id -> list_items.id` (`check_ins_list_item_id_fkey`), `check_ins.item_id -> items.id` (`check_ins_item_id_fkey`) | `check_ins_user_id_list_item_id_key` UNIQUE `(user_id, list_item_id)` |
| Private item (3 rows) | Direct boolean on the row itself, no `check_ins` row ever created | `user_suggestion_list_items.list_id -> lists.id`, `.suggestion_id -> user_suggestions.id` | `user_suggestion_list_items_suggestion_id_list_id_key` UNIQUE `(suggestion_id, list_id)` — this already prevents a duplicate private-item row per list, entirely independent of `check_ins` |

## Conclusion — private items

Per the explicit instruction ("either prove and test real support through the existing check-in schema, or explicitly exclude them"): **there is no existing check-in-schema storage path for private items at all** — building one would mean inventing a new points/completion system from scratch (no `difficulty`, no `points_awarded` semantics exist for `user_suggestions`), which is explicitly out of scope for this emergency pass ("do not attempt to complete the entire automatic candidate-visits product," keep this the smallest safe solution).

**Private items are explicitly excluded from this release.** The exclusion is structural, not a UI label bolted on top: Trip Mode lives entirely inside `ItemDetailScreen.jsx`/`TripModeCheckOffSheet.jsx`, and there is no route from a private item (which only ever renders inside `ListScreen.jsx`'s own private-item rows, with their own pre-existing, unrelated, already-working checkbox) into that flow at all. A private item's existing completion mechanism is untouched and continues to work exactly as it does today — Trip Mode simply has nothing to do with it.
