-- Amalfi Coast launch, step 2 of 4 — 2026-09-26
-- The Amalfi Coast area (a metro_areas row, same structure as metros; displayed
-- as "Amalfi Coast") plus 8 coastal-town neighborhoods.
--
-- ROLLOUT GATE: metro_areas.is_active = false here on purpose. Installed app
-- builds that predate boundary_radius_km would resolve Naples/Salerno/Sorrento
-- users to Amalfi Coast (their 100-mile rule). Activate only via
-- docs/metro-launch-audit/amalfi/amalfi_ACTIVATE_AREA_HELD_NOT_APPLIED.sql after
-- the app update carrying the 12 km boundary logic is live on supported clients.
-- Requires step 1 (boundary_radius_km). Not attached to Naples or Salerno.
--
-- Center 40.648, 14.606 / 12 km (see README for the measured overlap analysis).
-- Neighborhood ring radii: 300/600/850 m — ring_2 circles verified non-overlapping
-- (closest pair Amalfi & Atrani <-> Ravello & Scala, 1,778 m apart).
BEGIN;
INSERT INTO public.metro_areas (id, name, slug, state, timezone, is_active, center_lat, center_lng, center_geo, hero_images, boundary_radius_km)
VALUES ('b3e00b75-59f0-4b8f-ad3a-f6a203365821', 'Amalfi Coast', 'amalfi-coast', 'Campania', 'Europe/Rome', false, 40.648, 14.606, ST_SetSRID(ST_MakePoint(14.606, 40.648), 4326), '{}', 12);

INSERT INTO public.neighborhoods (id, metro_id, name, slug, state, center_geo, ring_0_radius_m, ring_1_radius_m, ring_2_radius_m, ring_3_radius_m, is_active) VALUES
  ('cc50e34b-8889-4698-8fe8-5b9387b19bfe', (SELECT id FROM public.metro_areas WHERE slug='amalfi-coast'), 'Positano', 'positano', 'Campania', ST_SetSRID(ST_MakePoint(14.485, 40.6281), 4326), 300, 600, 850, NULL, true),
  ('36f99ec8-4deb-4599-9e92-27845665b1ec', (SELECT id FROM public.metro_areas WHERE slug='amalfi-coast'), 'Praiano', 'praiano', 'Campania', ST_SetSRID(ST_MakePoint(14.531, 40.612), 4326), 300, 600, 850, NULL, true),
  ('fc51aa8a-0c8f-4b15-8aad-64775cf56842', (SELECT id FROM public.metro_areas WHERE slug='amalfi-coast'), 'Furore & Conca dei Marini', 'furore-and-conca-dei-marini', 'Campania', ST_SetSRID(ST_MakePoint(14.558, 40.6165), 4326), 300, 600, 850, NULL, true),
  ('7c50d369-2d63-4e24-9adf-66e66a3002c6', (SELECT id FROM public.metro_areas WHERE slug='amalfi-coast'), 'Amalfi & Atrani', 'amalfi-and-atrani', 'Campania', ST_SetSRID(ST_MakePoint(14.6027, 40.634), 4326), 300, 600, 850, NULL, true),
  ('abe03d9d-59bb-428e-a1b2-f7e4bff068e5', (SELECT id FROM public.metro_areas WHERE slug='amalfi-coast'), 'Ravello & Scala', 'ravello-and-scala', 'Campania', ST_SetSRID(ST_MakePoint(14.61, 40.649), 4326), 300, 600, 850, NULL, true),
  ('f0568bd1-840d-4d7c-a043-65dafef402a5', (SELECT id FROM public.metro_areas WHERE slug='amalfi-coast'), 'Minori & Maiori', 'minori-and-maiori', 'Campania', ST_SetSRID(ST_MakePoint(14.635, 40.6495), 4326), 300, 600, 850, NULL, true),
  ('6bb7fef7-d3e8-4873-a7a9-0ac1ae072d2b', (SELECT id FROM public.metro_areas WHERE slug='amalfi-coast'), 'Cetara', 'cetara', 'Campania', ST_SetSRID(ST_MakePoint(14.701, 40.647), 4326), 300, 600, 850, NULL, true),
  ('a7719d53-ead3-45e7-bf44-249267f7ed99', (SELECT id FROM public.metro_areas WHERE slug='amalfi-coast'), 'Vietri sul Mare', 'vietri-sul-mare', 'Campania', ST_SetSRID(ST_MakePoint(14.728, 40.672), 4326), 300, 600, 850, NULL, true);
COMMIT;
