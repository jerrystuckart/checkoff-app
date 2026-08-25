-- Denver curated list content — tagline, description, season, year, ends_at
-- Plain guarded UPDATEs (id + title match), no DO blocks, per Jerry's preference for simple SQL.
-- ends_at is set to NULL (evergreen) — matches the real cross-metro convention: no curated_lists
-- row in any metro has ever used a hard end date except one unrelated evergreen exception.
-- season/year are set to 'fall'/2026 to reflect Denver's actual launch season (other metros'
-- blank rows default to 'summer'/2026, but that reflects when those rows were created, not
-- Denver's situation).

BEGIN;

UPDATE public.curated_lists SET
    tagline = $tag$Find the bright side on tap.$tag$,
    description = $desc$For people who believe every neighborhood deserves a house beer and every back room might hide the best drink in town. Chase brewery patios, cider flights, distillery pours, dive bar legends, and cocktails worth finding from Denver to Longmont.$desc$,
    season = 'fall',
    year = 2026,
    ends_at = NULL
  WHERE id = '4ae154ea-37af-4d5f-b567-1744df7b5e0d'::uuid
    AND title = 'Hoptimists · Denver';

UPDATE public.curated_lists SET
    tagline = $tag$Dirt first. Snacks later.$tag$,
    description = $desc$For the crew that keeps emergency snacks in the car and calls a steep climb character building. Trade city sidewalks for foothill trails, creek paths, summit views, and mountain town detours from the Flatirons to Nederland.$desc$,
    season = 'fall',
    year = 2026,
    ends_at = NULL
  WHERE id = '479a4fb9-5cf1-4c5c-8f26-3b9de5442df7'::uuid
    AND title = 'Trail Mix Crew · Denver';

UPDATE public.curated_lists SET
    tagline = $tag$Skip the postcard. Become a regular.$tag$,
    description = $desc$For anyone who knows Pearl Street is only the beginning. Follow Boulder through tucked away tables, independent shops, local stages, curious art, and the rituals that turn an afternoon downtown into your Boulder routine.$desc$,
    season = 'fall',
    year = 2026,
    ends_at = NULL
  WHERE id = '2c4dc895-2334-45ba-9fa9-650f7b065b6f'::uuid
    AND title = 'Pearl Street Regulars · Denver';

UPDATE public.curated_lists SET
    tagline = $tag$Sweat like somebody's watching.$tag$,
    description = $desc$Turn sunrise laps, stadium stairs, climbing walls, skyline runs, and uphill suffering into your personal training montage. The playlist is optional. Acting like the city is your set is not.$desc$,
    season = 'fall',
    year = 2026,
    ends_at = NULL
  WHERE id = 'ae9a28da-6258-4771-8f3d-c701f6e7d483'::uuid
    AND title = 'Main Character Cardio · Denver';

UPDATE public.curated_lists SET
    tagline = $tag$Out of office. On the mountain.$tag$,
    description = $desc$For people who read snow reports before email and treat fresh powder as a perfectly valid scheduling conflict. Chase first chairs, snowy trails, warming huts, après rituals, and Front Range winter wins.$desc$,
    season = 'fall',
    year = 2026,
    ends_at = NULL
  WHERE id = '2e0d0da2-41e4-418a-9398-9643cf05698f'::uuid
    AND title = 'Powder Day People · Denver';

UPDATE public.curated_lists SET
    tagline = $tag$Murals change. You keep up.$tag$,
    description = $desc$For the people who know which alley has fresh paint, which warehouse has music, and where the night keeps going after everyone else heads home. Follow RiNo through murals, makers, patios, pours, and beautifully strange corners.$desc$,
    season = 'fall',
    year = 2026,
    ends_at = NULL
  WHERE id = '75007717-5485-4e99-a614-8f606bf12e00'::uuid
    AND title = 'RiNo Rats · Denver';

UPDATE public.curated_lists SET
    tagline = $tag$Packed snacks. Questionable patience.$tag$,
    description = $desc$For parents who can produce a granola bar in five seconds and turn errands into adventures. Find stroller friendly outings, hands on stops, sweet bribes, rainy day rescues, and places where kids can be loud without anyone glaring.$desc$,
    season = 'fall',
    year = 2026,
    ends_at = NULL
  WHERE id = '13ceeec3-8f2c-4487-83cf-de21cf04222a'::uuid
    AND title = 'Snack Pack Survivors · Denver';

UPDATE public.curated_lists SET
    tagline = $tag$Not official. Definitely a thing.$tag$,
    description = $desc$For dates that might become stories and plans that are still under review. Find low pressure coffee, moody booths, playful activities, and just enough atmosphere to decide whether there should be a second stop.$desc$,
    season = 'fall',
    year = 2026,
    ends_at = NULL
  WHERE id = '1fbc0c98-4589-48ac-8e74-9eb6da49844d'::uuid
    AND title = 'Soft Launch Season · Denver';

-- Review before COMMIT — confirm all 8 rows updated, tagline/description non-null,
-- season='fall', year=2026, ends_at NULL
SELECT id, title, is_active, tagline, description, season, year, ends_at
FROM public.curated_lists
WHERE id IN (
  '4ae154ea-37af-4d5f-b567-1744df7b5e0d'::uuid,
  '479a4fb9-5cf1-4c5c-8f26-3b9de5442df7'::uuid,
  '2c4dc895-2334-45ba-9fa9-650f7b065b6f'::uuid,
  'ae9a28da-6258-4771-8f3d-c701f6e7d483'::uuid,
  '2e0d0da2-41e4-418a-9398-9643cf05698f'::uuid,
  '75007717-5485-4e99-a614-8f606bf12e00'::uuid,
  '13ceeec3-8f2c-4487-83cf-de21cf04222a'::uuid,
  '1fbc0c98-4589-48ac-8e74-9eb6da49844d'::uuid
)
ORDER BY title;

COMMIT;
