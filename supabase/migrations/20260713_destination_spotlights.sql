-- ============================================================
-- destination_spotlights
-- 2026-07-13
--
-- A destination's freeform promotional callouts — distinct from
-- destination_lists (which links a destination to an actual list a
-- user can join/browse). A spotlight is just a title/image/optional
-- external link, optionally credited to a partner. Same ownership
-- shape as destination_lists (owner_partner_id → destination_partners)
-- so the same partner-cancellation soft-deactivation flow applies.
--
-- RLS mirrors destination_lists exactly: public SELECT requires
-- is_active = true plus the visibility window, Jerry's testing
-- bypass sees everything, and there is no write policy for
-- anon/authenticated at all — RLS is enabled with SELECT-only
-- policies, so INSERT/UPDATE/DELETE are implicitly denied for those
-- roles and only reachable via service_role (the admin tool), same
-- convention as destinations/destination_lists.
--
-- No app-code changes ship with this migration beyond the
-- destination_partners cancellation cascade in checkoff_admin.html
-- gaining a third PATCH (destination_spotlights.is_active = false
-- where owner_partner_id matches), tracked separately from this SQL.
-- Reactivation stays partner-only and never touches spotlights,
-- matching the existing destination_lists rule — cancelled/deactivated
-- spotlights must be manually re-enabled, same as lists.
-- ============================================================

CREATE TABLE destination_spotlights (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_id        uuid NOT NULL REFERENCES destinations(id),
  owner_partner_id      uuid REFERENCES destination_partners(id),
  title                 text NOT NULL,
  subtitle              text,
  image_url             text,
  external_url          text,
  show_partner_credit   boolean NOT NULL DEFAULT false,
  is_active             boolean NOT NULL DEFAULT true,
  visible_from          timestamptz,
  visible_until         timestamptz,
  sort_order            integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_destination_spotlights_destination_id   ON destination_spotlights(destination_id);
CREATE INDEX idx_destination_spotlights_owner_partner_id ON destination_spotlights(owner_partner_id);

ALTER TABLE destination_spotlights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Visible destination_spotlights rows are viewable by everyone"
ON destination_spotlights FOR SELECT
TO anon, authenticated
USING (
  is_active = true
  AND (visible_from IS NULL OR visible_from <= now())
  AND (visible_until IS NULL OR visible_until >= now())
);

CREATE POLICY "Jerry can view all destination_spotlights rows for testing"
ON destination_spotlights FOR SELECT
TO authenticated
USING (auth.uid() = '11275026-65be-4421-80a4-46c57195408b');
