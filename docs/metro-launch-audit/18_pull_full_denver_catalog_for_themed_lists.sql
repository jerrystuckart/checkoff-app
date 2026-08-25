-- READ-ONLY. Run via `supabase db query -f ... --linked` and paste the output back.
-- Purpose: full visibility into the Denver catalog so 3 real themed lists (Hidden Bars, a
-- renamed Date Spots list, and one more) can be curated from actual items, not guessed.

SELECT
  i.id,
  i.body,
  n.name AS neighborhood,
  c.name AS category,
  i.checkin_type,
  i.is_active,
  i.formatted_address,
  i.maps_query,
  array_agg(DISTINCT t.name ORDER BY t.name) FILTER (WHERE t.name IS NOT NULL) AS tags
FROM public.items i
JOIN public.neighborhoods n ON n.id = i.neighborhood_id
JOIN public.categories c ON c.id = i.category_id
LEFT JOIN public.item_tags it ON it.item_id = i.id
LEFT JOIN public.tags t ON t.id = it.tag_id
WHERE n.metro_id = 'b00f7f91-3176-48c5-aaf1-6ded7426f756'::uuid
GROUP BY i.id, i.body, n.name, c.name, i.checkin_type, i.is_active, i.formatted_address, i.maps_query
ORDER BY c.name, n.name, i.body;
