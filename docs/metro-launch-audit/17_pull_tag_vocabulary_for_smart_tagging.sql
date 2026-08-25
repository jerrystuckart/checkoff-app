-- READ-ONLY. Run via `supabase db query -f ... --linked` and paste the output back.
-- Purpose: get the real tag vocabulary so the 12-item coffee/bakery insert's tagging can be
-- rewritten to match the confidence-tiered, up-to-8-tags-per-item approach Jerry actually uses
-- (per his own reference example), instead of the flat 3-tag/confidence=1.0 pattern currently in
-- the file. Nothing here writes to anything.

-- 1. Decode the 6 unknown tag ids from Jerry's reference example (Coyoacán's Bakery, Phoenix)
SELECT id, name
FROM public.tags
WHERE id IN (
  'b4417401-b23e-4fe7-96ad-5e8f1447e00a'::uuid,
  'b2da718f-1e34-4b4a-92d1-44eaa8cdf818'::uuid,
  '00d4a098-e0a5-449d-826f-8e717a04efe2'::uuid,
  'c8f08af1-dbd2-413e-9137-0bf97738bc92'::uuid,
  '578908a3-ee6f-41be-98dc-56af7e4796b3'::uuid,
  '60131172-557b-43e1-8048-1eed4887fb64'::uuid
);

-- 2. Full tag vocabulary (all rows) — needed to pick real, existing tags for the 12 new items
-- rather than inventing plausible-sounding ones. If this is too large to paste in full (749 tags
-- per an earlier project log), at minimum get every tag whose name suggests food/drink/coffee/
-- bakery/cuisine/vibe relevance, via a broad ILIKE net — better to over-include than miss real
-- candidates:
SELECT id, name
FROM public.tags
ORDER BY name;

-- 3. Real-world comparable: what tags do EXISTING coffee shops / bakeries / cafes already carry
-- in production (any metro), as a concrete pattern to match — not just Jerry's one example.
SELECT i.id, i.body, array_agg(t.name ORDER BY it.confidence DESC) AS tags,
       array_agg(it.confidence ORDER BY it.confidence DESC) AS confidences
FROM public.items i
JOIN public.item_tags it ON it.item_id = i.id
JOIN public.tags t ON t.id = it.tag_id
WHERE i.body ILIKE '%coffee%' OR i.body ILIKE '%café%' OR i.body ILIKE '%cafe%'
   OR i.body ILIKE '%bakery%' OR i.body ILIKE '%pastry%' OR i.body ILIKE '%espresso%'
GROUP BY i.id, i.body
ORDER BY array_length(array_agg(t.name), 1) DESC
LIMIT 20;

-- 4. Confirm item_tags.source's actual allowed values (check constraint or just observed usage)
-- — need to know if 'ai' vs 'auto' actually matters functionally or is just an inconsistent label.
SELECT DISTINCT source, count(*) AS row_count
FROM public.item_tags
GROUP BY source
ORDER BY row_count DESC;

SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.item_tags'::regclass
  AND contype = 'c';
