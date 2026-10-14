-- ============================================================
-- Destination hub discovery on Home (2026-10-10)
--
-- Adds ONLY:
--   1. destinations.discovery_enabled  boolean NOT NULL DEFAULT false
--        The "Show on Home" switch. Deliberately separate from
--          - destinations.is_active          (hub exists / its Hub screen is readable; Willcox is already true)
--          - destination_zones.is_active     (the GPS arrival banner)
--        so connecting a hub to metros can never publish unfinished content: a hub appears on Home only when an admin
--        turns THIS on.
--   2. metro_hub_connections          explicit hub <-> metro links ("Show in metros" in the admin tool).
--        Not metro_destinations: that table is the automatic distance cross-product (every metro x every destination,
--        including Willcox <-> Munich) and says nothing about editorial intent.
--        PK (metro_id, destination_id) prevents duplicates; both FKs cascade. RLS on with a deny-all policy and no
--        anon/authenticated grants: only service_role (the admin tool) can read or write the table directly.
--   3. get_metro_discovery_hubs(p_metro_id)  the ONLY public read. SECURITY DEFINER, returns id/name/slug/hero image of
--        hubs that are connected to that metro AND is_active AND discovery_enabled. Nothing else is exposed.
--   4. First configuration: Willcox connected to Phoenix and Tucson. discovery_enabled stays false, destinations.is_active
--        and destination_zones are NOT touched, so nothing becomes visible until the owner turns "Show on Home" on.
--
-- Purely additive and idempotent. No data in existing tables changes. Old app versions never call the function.
-- ============================================================

ALTER TABLE public.destinations
  ADD COLUMN IF NOT EXISTS discovery_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.metro_hub_connections (
  metro_id        uuid NOT NULL REFERENCES public.metro_areas(id)  ON DELETE CASCADE,
  destination_id  uuid NOT NULL REFERENCES public.destinations(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (metro_id, destination_id)
);

CREATE INDEX IF NOT EXISTS idx_metro_hub_connections_destination_id ON public.metro_hub_connections(destination_id);

ALTER TABLE public.metro_hub_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "metro_hub_connections: service role only" ON public.metro_hub_connections;
CREATE POLICY "metro_hub_connections: service role only"
ON public.metro_hub_connections FOR ALL
TO authenticated, anon
USING (false)
WITH CHECK (false);

REVOKE ALL ON public.metro_hub_connections FROM anon, authenticated;
GRANT ALL ON public.metro_hub_connections TO service_role;

CREATE OR REPLACE FUNCTION public.get_metro_discovery_hubs(p_metro_id uuid)
RETURNS TABLE (id uuid, name text, slug text, hero_image_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.id, d.name, d.slug, d.hero_image_url
  FROM public.metro_hub_connections c
  JOIN public.destinations d ON d.id = c.destination_id
  WHERE c.metro_id = p_metro_id
    AND d.is_active = true
    AND d.discovery_enabled = true
  ORDER BY d.name;
$$;

REVOKE ALL ON FUNCTION public.get_metro_discovery_hubs(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_metro_discovery_hubs(uuid) TO anon, authenticated, service_role;

-- First configuration: Willcox in Phoenix and Tucson (resolved by slug; nothing is inserted if a record is missing).
INSERT INTO public.metro_hub_connections (metro_id, destination_id)
SELECT m.id, d.id
FROM public.destinations d
JOIN public.metro_areas m ON m.slug IN ('phoenix', 'tucson')
WHERE d.slug = 'willcox'
ON CONFLICT (metro_id, destination_id) DO NOTHING;
