-- DRAFT — NOT APPLIED. Do not run against production without review.
-- Enables Trip Mode for exactly one list: "Half Century, Full Steins:
-- Munich 2026" (id 692cb6bc-cbeb-4740-af6f-5f1833673a0f).
--
-- Requires 20260923_trip_mode_retroactive_completion_NOT_APPLIED.sql (in
-- this same directory) to have been applied first — this statement is a
-- no-op error otherwise (trip_mode_enabled column would not exist).
--
-- Confirmed live, this session (read-only query, no write performed):
--   id:         692cb6bc-cbeb-4740-af6f-5f1833673a0f
--   title:      Half Century, Full Steins: Munich 2026
--   starts_at:  2026-09-21
--   ends_at:    2026-09-25
--   metro_id:   06e7a733-124c-45ed-be42-de82587c9125
--   is_public:  false
--   members:    4 (count only, no PII queried)
--
-- trip_mode_grace_days is left at its column default (7) — matches the
-- product spec's seven-day grace period exactly; no override needed for
-- this list. If a different grace period is ever wanted for this specific
-- list, uncomment and adjust the second statement below.

UPDATE public.lists
SET trip_mode_enabled = true
WHERE id = '692cb6bc-cbeb-4740-af6f-5f1833673a0f'::uuid;

-- UPDATE public.lists
-- SET trip_mode_grace_days = 7
-- WHERE id = '692cb6bc-cbeb-4740-af6f-5f1833673a0f'::uuid;

-- Verification query (read-only, safe to run any time after applying):
-- SELECT id, title, trip_mode_enabled, trip_mode_grace_days, starts_at, ends_at
-- FROM public.lists WHERE id = '692cb6bc-cbeb-4740-af6f-5f1833673a0f'::uuid;
