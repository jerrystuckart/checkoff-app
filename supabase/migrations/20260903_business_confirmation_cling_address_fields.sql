-- Splits the single free-text cling mailing address box into proper
-- street/city/state/zip fields (Jerry's real-device test caught this —
-- the single box captured only a street address, not enough to actually
-- ship a cling). Additive only; cling_mailing_address (street line) is
-- kept, not renamed, so nothing already written needs backfilling.
--
-- Review-ready, NOT applied automatically — same convention as every
-- other migration in this directory:
--   supabase db query -f supabase/migrations/20260903_business_confirmation_cling_address_fields.sql --linked

BEGIN;

ALTER TABLE business_confirmation_submissions ADD COLUMN IF NOT EXISTS cling_mailing_city text;
ALTER TABLE business_confirmation_submissions ADD COLUMN IF NOT EXISTS cling_mailing_state text;
ALTER TABLE business_confirmation_submissions ADD COLUMN IF NOT EXISTS cling_mailing_zip text;

COMMIT;
