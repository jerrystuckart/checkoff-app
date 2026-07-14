-- ============================================================
-- destination_lists.show_partner_credit + destination_partners_public
-- 2026-07-13
--
-- Two additive fixes surfaced while building HubScreen:
--
-- 1. destination_lists was missing show_partner_credit, the same
--    opt-in flag destination_spotlights already has. Partner credit
--    was always meant to be case-by-case for both lists and
--    spotlights, not implied by owner_partner_id being set — that
--    was a real gap in the destination_lists schema, not an
--    intentional decision.
--
-- 2. destination_partners is correctly locked to service_role only
--    (deny-all for anon/authenticated), so HubScreen's partner-name
--    lookup for credit lines can never read it directly. This view
--    exposes only id + org_name, and only for partners whose
--    contract_status is 'active' — a cancelled/lapsed partner never
--    gets public credit, regardless of what any individual list's or
--    spotlight's show_partner_credit flag says. The view is owned by
--    the migration-running role (postgres), which bypasses RLS on
--    the underlying table — the standard Supabase pattern for
--    narrow public exposure of specific columns from a locked-down
--    table. Only SELECT is granted; row/column scope is fixed by the
--    view definition itself, not by any policy.
-- ============================================================

ALTER TABLE destination_lists
ADD COLUMN show_partner_credit boolean NOT NULL DEFAULT false;

CREATE VIEW destination_partners_public AS
SELECT id, org_name FROM destination_partners WHERE contract_status = 'active';

GRANT SELECT ON destination_partners_public TO anon, authenticated;
