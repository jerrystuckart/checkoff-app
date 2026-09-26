-- Amalfi Coast launch, step 1 of 4 — 2026-09-26
-- Adds an OPTIONAL per-area boundary radius to metro_areas. NULL (every existing
-- row) keeps the app's shared 100-mile default (lib/metroSelection.js), so no
-- existing metro changes behavior. Compact areas like Amalfi Coast set it so the
-- nearest-metro resolver doesn't claim neighboring cities (Salerno/Sorrento/Naples).
-- Additive and reversible: ALTER TABLE metro_areas DROP COLUMN boundary_radius_km;
BEGIN;
ALTER TABLE public.metro_areas
  ADD COLUMN IF NOT EXISTS boundary_radius_km double precision
  CHECK (boundary_radius_km IS NULL OR boundary_radius_km > 0);
COMMENT ON COLUMN public.metro_areas.boundary_radius_km IS
  'Optional. Radius (km) around center_lat/center_lng within which this area claims a device location. NULL = shared 100-mile default.';
COMMIT;
