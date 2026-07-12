-- ============================================================
-- Lock down city_partnerships to service_role only
-- 2026-07-12
--
-- city_partnerships had RLS enabled but with four unconditional
-- (USING/CHECK true) policies for authenticated users -- meaning any
-- signed-up app user could read AND write every row, including
-- contact_name, contact_email, contact_phone, stripe_customer_id,
-- stripe_subscription_id, annual_price, and private sales notes.
--
-- This table is internal business/sales data, never read by the RN
-- app or the marketing site (confirmed via full codebase grep), and
-- not referenced by the admin tool either -- it's managed via direct
-- database access only. It has no legitimate reason to be visible or
-- writable to anon/authenticated at all.
--
-- Dropped the four permissive policies and replaced them with a
-- single explicit deny-all policy for anon/authenticated, matching
-- the existing "service role only" convention already used elsewhere
-- in this schema (see dormant_notifications). service_role bypasses
-- RLS entirely, so the admin tool (which already authenticates with
-- the service_role key) is unaffected.
-- ============================================================

DROP POLICY "Authenticated users can insert city partnerships" ON city_partnerships;
DROP POLICY "Authenticated users can delete city partnerships" ON city_partnerships;
DROP POLICY "Authenticated users can read city partnerships" ON city_partnerships;
DROP POLICY "Authenticated users can update city partnerships" ON city_partnerships;

CREATE POLICY "city_partnerships: service role only"
ON city_partnerships FOR ALL
TO authenticated, anon
USING (false)
WITH CHECK (false);
