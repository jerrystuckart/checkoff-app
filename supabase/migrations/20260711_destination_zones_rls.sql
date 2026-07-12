-- ============================================================
-- Add RLS policies to destination_zones
-- 2026-07-11
--
-- destination_zones had RLS enabled with zero policies, meaning
-- every row was invisible to anon/authenticated roles (only
-- service_role, used by checkoff_admin.html, could see rows).
-- This silently blocked the GPS destination-zone banner for all
-- real users in production, regardless of is_active.
--
-- Two policies:
--   1. Real users (anon + authenticated) can see active zones only.
--   2. Jerry's account can see all zones (active or not), so the
--      existing __DEV__ client-side bypass in HomeScreen.jsx has
--      something to actually bypass to during testing.
-- ============================================================

CREATE POLICY "Active zones are viewable by everyone"
ON destination_zones FOR SELECT
TO anon, authenticated
USING (is_active = true);

CREATE POLICY "Jerry can view all zones for testing"
ON destination_zones FOR SELECT
TO authenticated
USING (auth.uid() = '11275026-65be-4421-80a4-46c57195408b');
