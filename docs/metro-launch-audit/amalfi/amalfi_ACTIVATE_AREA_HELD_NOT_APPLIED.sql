-- HELD — do NOT apply until the app update carrying boundary_radius_km logic
-- (commit 678338c, lib/metroSelection.js) is live on the supported installed
-- clients. Older clients ignore boundary_radius_km and would resolve Salerno,
-- Sorrento and Naples users to Amalfi Coast (100-mile rule).
-- Apply: supabase db query -f docs/metro-launch-audit/amalfi/amalfi_ACTIVATE_AREA_HELD_NOT_APPLIED.sql --linked
BEGIN;
UPDATE public.metro_areas SET is_active = true WHERE slug = 'amalfi-coast';
-- After images upload: UPDATE public.metro_areas SET hero_images = ARRAY['<url>'] WHERE slug='amalfi-coast';
COMMIT;
