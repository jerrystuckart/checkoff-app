-- ============================================================
-- Restrict featured_experiences writes + close user_badges abuse path
-- 2026-07-12
--
-- 1. featured_experiences had unconditional (USING/CHECK true)
--    INSERT/UPDATE/DELETE policies for any authenticated user, meaning
--    any signed-up app user could deface or delete home screen content
--    for everyone. SELECT ("active = true") was already correctly
--    scoped and is left untouched. Restricted the three write
--    operations to service_role only, same explicit-deny pattern used
--    for city_partnerships.
--
-- 2. user_badges' INSERT policy allowed CHECK (true) with no ownership
--    check, so any authenticated (or anon) request could insert a
--    badge row for an arbitrary user_id -- self-awarding or spamming
--    badges onto other users' profiles. Changed to
--    CHECK (auth.uid() = user_id).
--
--    Verified this has zero effect on real badge awarding:
--    - Most badges are awarded via check_and_award_badges() ->
--      award_badge_if_new(), both SECURITY DEFINER and owned by
--      `postgres` (rolbypassrls = true) -- they bypass RLS entirely,
--      confirmed by a live end-to-end check-in test that still
--      successfully wrote to user_badges under the new policy.
--    - Point-milestone badges are inserted client-side from
--      lib/points.js, but always with user_id set to the caller's own
--      auth.uid() (traced through every call site of
--      updateUserLifetimePoints) -- the new CHECK is always satisfied
--      for that legitimate path.
-- ============================================================

DROP POLICY "Authenticated users can insert featured experiences" ON featured_experiences;
DROP POLICY "Authenticated users can update featured experiences" ON featured_experiences;
DROP POLICY "Authenticated users can delete featured experiences" ON featured_experiences;

CREATE POLICY "featured_experiences: no direct insert"
ON featured_experiences FOR INSERT
TO authenticated, anon
WITH CHECK (false);

CREATE POLICY "featured_experiences: no direct update"
ON featured_experiences FOR UPDATE
TO authenticated, anon
USING (false);

CREATE POLICY "featured_experiences: no direct delete"
ON featured_experiences FOR DELETE
TO authenticated, anon
USING (false);

DROP POLICY "user_badges: system write" ON user_badges;

CREATE POLICY "user_badges: system write"
ON user_badges FOR INSERT
TO authenticated, anon
WITH CHECK (auth.uid() = user_id);
