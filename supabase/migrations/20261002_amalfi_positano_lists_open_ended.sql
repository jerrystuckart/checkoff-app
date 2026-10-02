-- 2026-10-02: the two Positano official lists were seeded with ends_at = 2027-12-31 as a placeholder
-- (20260927_amalfi_04_positano_hub.sql), which Home rendered as a fabricated "455 days left" countdown.
-- They are open ended reference lists, the same shape as Florence, Munich, Vienna and Green Bay official
-- lists (ends_at NULL). Before: ends_at = '2027-12-31' for both. After: NULL. Applied to production
-- 2026-10-02 with the same guarded statement.
UPDATE public.lists SET ends_at = NULL
WHERE id IN ('fb5ed539-39ad-43c9-aae6-f6597a5ee76e','5bb9bc06-6406-4c82-b5e7-f6d3d3129606')
  AND ends_at = '2027-12-31' AND is_official AND metro_id = 'b3e00b75-59f0-4b8f-ad3a-f6a203365821';
