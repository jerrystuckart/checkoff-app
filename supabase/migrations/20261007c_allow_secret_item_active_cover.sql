-- Secret items may have a normal active cover (Jerry decision 2026-10-07).
-- Drops ONLY the items trigger that refused a non-null active_cover_candidate_id
-- on is_secret items. Safe because the locked Secret CheckOff screen reads only
-- items.secret_business_photo_storage_path (never covers / candidate pools);
-- covers display only in unlocked/normal surfaces.
-- Other item protections are untouched (no other trigger/function is modified).
BEGIN;

DROP TRIGGER IF EXISTS items_reject_secret_active_cover ON public.items;
DROP FUNCTION IF EXISTS public.reject_secret_item_active_cover();

COMMIT;
