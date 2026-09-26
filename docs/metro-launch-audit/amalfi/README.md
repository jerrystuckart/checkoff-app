# Amalfi Coast + Positano Hub (2026-09-26)
Applied via `supabase db query --linked` (project uggusbbswybyplypkbxz), in order:
1. `supabase/migrations/20260927_amalfi_01_boundary_radius.sql` — metro_areas.boundary_radius_km (NULL = old 100mi rule)
2. `..._02_area_neighborhoods.sql` — Amalfi Coast (center 40.648,14.606, 12 km, **is_active=false gate**) + 8 neighborhoods
3. `..._03_catalog.sql` — 39 items (all Places-verified OPERATIONAL; dropped: Africana Famous Club, Marina Grande, Villa Guariglia, Minori Roman villa, Torre a Mare)
4. `..._04_positano_hub.sql` — destination, zone (7 km, active), 2 lists x 10 items, destination_lists
IDs: ids.json. Catalog rows: catalog-rows.json. Held: amalfi_ACTIVATE_AREA_HELD_NOT_APPLIED.sql.
