-- ============================================================
-- Tiered creator list visibility — is_featured_eligible
-- 2026-06-30
--
-- goes_public_at controls whether a creator list is visible/followable
-- at all (private-until-first-partner gate). is_featured_eligible
-- controls whether it additionally gets app-wide promotional placement
-- (HomeScreen amber border + byline, Creators tile / CreatorListScreen
-- discovery). Historically these flipped together (first partner
-- activation), but separating them means a list manually created +
-- published by an admin for demo purposes doesn't automatically earn
-- featured placement it hasn't won via a real partner.
-- ============================================================

ALTER TABLE lists
ADD COLUMN IF NOT EXISTS is_featured_eligible boolean DEFAULT false;
