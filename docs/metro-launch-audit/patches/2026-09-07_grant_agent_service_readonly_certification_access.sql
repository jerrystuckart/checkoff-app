-- 2026-09-07_grant_agent_service_readonly_certification_access.sql
--
-- Chief Phase 2Y — read-only production access for Winston's metro-launch
-- certification gates. Requested and reviewed by Jerry, 2026-09-07.
--
-- SCOPE: SELECT only, on exactly the 8 tables Winston's certification
-- read paths actually need:
--   - public.tags                  (TAG_CERTIFICATION_GATE — tagVocabularyProvider.ts)
--   - public.lists                 (HOME_LIST_CERTIFICATION_GATE — homeListReadPath.ts)
--   - public.list_items            (HOME_LIST_CERTIFICATION_GATE — homeListReadPath.ts)
--   - public.metro_areas           (HOME_LIST_CERTIFICATION_GATE — joins lists to a metro by slug)
--   - public.items                 (HOME_LIST_CERTIFICATION_GATE — confirms list_items.item_id resolves to a real, current item)
--   - public.curated_lists         (CURATED_LIST_LAYER_GATE — homeListReadPath.ts)
--   - public.curated_list_items    (CURATED_LIST_LAYER_GATE — homeListReadPath.ts)
--   - public.curated_list_metros   (the metro-scoping layer for curated_lists — zero rows means
--                                    universal/visible-everywhere, per the Phase 2U architecture
--                                    discovery; not yet joined by today's read path but is the same
--                                    certification domain, included per Jerry's own request rather
--                                    than trimmed to only today's exact SQL)
--
-- Confirmed via direct inspection of agent-service/specialists/homeListReadPath.ts
-- and agent-service/specialists/tagVocabularyProvider.ts before this patch was
-- written: these 8 tables are the complete, minimum set those two real read
-- paths reference. No other table is queried by Winston's certification code.
--
-- READ-ONLY. This grant does NOT include INSERT/UPDATE/DELETE/TRUNCATE, does
-- NOT include EXECUTE on any function, does NOT change ownership, and is NOT
-- schema-wide (no `GRANT ... ON ALL TABLES IN SCHEMA public`, no `GRANT ALL`).
-- The existing human/public-write boundary is unchanged: Chief/Winston still
-- has zero write path to any of these tables, before or after this patch —
-- it can only ever hand Jerry a SQL patch to run, exactly as it does today.
--
-- This does not touch RLS policies, does not touch any other role's grants,
-- and does not touch San Diego's or any other metro's data.

BEGIN;

GRANT SELECT ON TABLE
  public.tags,
  public.lists,
  public.list_items,
  public.metro_areas,
  public.items,
  public.curated_lists,
  public.curated_list_items,
  public.curated_list_metros
TO agent_service;

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification queries — run these AFTER applying the grant above, and paste
-- the results back. Chief will independently re-run the equivalent read-only
-- checks from agent-service/db.ts once you confirm this has been applied.
-- ---------------------------------------------------------------------------

-- 1. Confirm exactly SELECT (no other privilege) landed on each of the 8 tables.
SELECT table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'agent_service'
  AND table_schema = 'public'
  AND table_name IN ('tags', 'lists', 'list_items', 'metro_areas', 'items', 'curated_lists', 'curated_list_items', 'curated_list_metros')
ORDER BY table_name, privilege_type;

-- 2. Confirm agent_service has NO write privilege on these 8 tables (expect zero rows).
SELECT table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'agent_service'
  AND table_schema = 'public'
  AND table_name IN ('tags', 'lists', 'list_items', 'metro_areas', 'items', 'curated_lists', 'curated_list_items', 'curated_list_metros')
  AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');

-- 3. Confirm agent_service's privileges on every OTHER public table are unchanged
--    (this patch must not have widened anything outside the 8 listed tables).
SELECT table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'agent_service'
  AND table_schema = 'public'
  AND table_name NOT IN ('tags', 'lists', 'list_items', 'metro_areas', 'items', 'curated_lists', 'curated_list_items', 'curated_list_metros')
ORDER BY table_name, privilege_type;
