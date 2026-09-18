-- Archetype Fallback Artwork V1 (2026-09-17)
--
-- ~98.6% of the catalog has no approved photo. Today that means every one
-- of those items falls straight to the zero-network gradient/typography
-- treatment (see lib/whatsGoodImageSource.js + components/home/EditorialCard.jsx /
-- WhatsTheThingHero.jsx). This adds an OPTIONAL per-item override so a
-- specific item can be pinned to a curated "archetype" illustration
-- (coffee, hidden entrance, outdoor mountain, ...) instead of (or ahead
-- of) the generic category default, without ever requiring a schema
-- change to add a new archetype in the future.
--
-- Deliberately a plain, nullable TEXT column, not an enum:
--   - new archetypes (v2, v3, ...) never require a migration — the
--     registry lives in application code (lib/fallbackArtSource.js) and
--     is validated there, not by a DB constraint.
--   - no default, no backfill — every existing row stays NULL, which is
--     exactly the "no explicit override, use the category default"
--     behavior the resolver already treats NULL as.
--
-- Applied to the CheckOff production Supabase project (uggusbbswybyplypkbxz)
-- on 2026-09-18 via `supabase db query --linked -f <this file>` (scoped to
-- this file only, not `db push` — see docs/fallback-art-manifest.md's
-- "Deployment log" for why). Verified: column exists, nullable, no
-- default, 0 rows backfilled. See that doc for rollback procedure.
--
-- RLS: items already has RLS policies scoped to existing columns/roles;
-- adding a nullable column changes no policy and requires no new grant.

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS fallback_art_key text;

COMMENT ON COLUMN public.items.fallback_art_key IS
  'Optional explicit archetype key for no-photo fallback artwork (e.g. "coffee", "hidden_entrance"). Validated against the registry in lib/fallbackArtSource.js, not a DB enum, so new archetypes never require a migration. NULL means "use the category default archetype, or the generic graphic treatment if none maps." Public artwork lives at checkoff-images/item-fallbacks/v1/<key>.webp in the checkoff-images public Storage bucket.';
