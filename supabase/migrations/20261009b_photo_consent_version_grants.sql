-- Follow up to 20261009a (found by the disposable account test): item_cover_candidates has COLUMN LEVEL insert grants, so the new consent_version column
-- must be granted explicitly or updated clients' cover submissions fail with 42501. check_ins has a table level grant (no change needed).
-- Also restricts both version columns to the expected format so the evidence column cannot hold arbitrary text. The value is attested by the client; the
-- owner can still edit their own rows through existing policies (documented limitation, see docs/release/PHOTO_TERMS_PROPOSAL.md).
-- Rollback: revoke insert (consent_version) on public.item_cover_candidates from authenticated; alter table ... drop constraint ...
grant insert (consent_version) on public.item_cover_candidates to authenticated;
alter table public.check_ins add constraint check_ins_photo_terms_version_format check (photo_terms_version is null or photo_terms_version ~ '^photo-terms-v[0-9]{1,3}$');
alter table public.item_cover_candidates add constraint item_cover_candidates_consent_version_format check (consent_version is null or consent_version ~ '^photo-terms-v[0-9]{1,3}$');
alter table public.retained_checkin_photos add constraint retained_checkin_photos_consent_version_format check (consent_version is null or consent_version ~ '^photo-terms-v[0-9]{1,3}$');
