-- URGENT, READ-ONLY — run this now via `supabase db query --linked` and paste back the output.
-- Checks whether Denver's 3 curated lists are already leaking to other metros' home screens
-- (curated_list_metros scoping), and where the tagline/description/image content actually lives
-- (audience_groups, not curated_lists — the app's fetchCuratedLists() reads audience_groups for
-- tagline/description/emoji/image_url, not the curated_lists columns we wrote to earlier).
-- Nothing here writes to anything.

-- 1. Are Denver's 3 active curated lists scoped to Denver at all, or universal (visible everywhere)?
SELECT cl.id, cl.title, cl.is_active, cl.audience_group_id,
       clm.city_slug AS scoped_to_city_slug
FROM public.curated_lists cl
LEFT JOIN public.curated_list_metros clm ON clm.curated_list_id = cl.id
WHERE cl.id IN (
  '4ae154ea-37af-4d5f-b567-1744df7b5e0d'::uuid,   -- Hoptimists
  '479a4fb9-5cf1-4c5c-8f26-3b9de5442df7'::uuid,   -- Trail Mix Crew
  '2c4dc895-2334-45ba-9fa9-650f7b065b6f'::uuid    -- Pearl Street Regulars
)
ORDER BY cl.title;
-- If scoped_to_city_slug comes back NULL for any of these (no matching row at all, not even a
-- row with city_slug itself NULL), that list has ZERO curated_list_metros rows and is currently
-- "universal" per the app's own visibility logic — meaning it may already be showing to every
-- other metro's users right now, since is_active is already true on these 3.

-- 2. What does audience_groups actually have for these 3 lists' linked rows?
SELECT ag.id, ag.name, ag.tagline, ag.description, ag.emoji, ag.image_url, ag.city_slug
FROM public.curated_lists cl
JOIN public.audience_groups ag ON ag.id = cl.audience_group_id
WHERE cl.id IN (
  '4ae154ea-37af-4d5f-b567-1744df7b5e0d'::uuid,
  '479a4fb9-5cf1-4c5c-8f26-3b9de5442df7'::uuid,
  '2c4dc895-2334-45ba-9fa9-650f7b065b6f'::uuid
);
-- This tells us what the app will ACTUALLY show for tagline/description/image on these 3 cards —
-- if tagline/description/image_url are NULL here, the content we wrote to curated_lists directly
-- is not what renders, regardless of how correct it is.

-- 3. Denver Fall 2026's own hero image / cover emoji (public.lists — confirm "images all 4" covered this one)
SELECT id, title, hero_image_url, cover_emoji, is_official, is_public
FROM public.lists
WHERE id = '178ecd7c-8c05-45ee-af2a-a58979bc5184'::uuid;

-- 4. Denver's metro-level hero image rotation pool
SELECT id, slug, hero_images, is_active
FROM public.metro_areas
WHERE slug = 'denver';

-- 5. Sanity check against a working example: how does an ALREADY-LIVE metro do this?
-- Pick one of Phoenix's populated curated lists (e.g. "Phoenix Hidden Gems" from the prior
-- tagline/description investigation) and show its full chain end to end, as the known-good pattern
-- to compare Denver's setup against.
SELECT cl.id, cl.title, cl.is_active, cl.audience_group_id,
       clm.city_slug AS scoped_to_city_slug,
       ag.tagline, ag.description, ag.emoji, ag.image_url
FROM public.curated_lists cl
LEFT JOIN public.curated_list_metros clm ON clm.curated_list_id = cl.id
LEFT JOIN public.audience_groups ag ON ag.id = cl.audience_group_id
WHERE cl.title ILIKE '%hidden gems%' OR cl.title ILIKE '%phoenix%';
