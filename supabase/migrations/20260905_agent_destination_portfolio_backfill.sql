-- Chief Phase 2M — per-destination relationship isolation backfill.
--
-- WHY: Phase 2L's real overnight proof showed a genuine Willcox
-- correspondence (Desiree Gerth, relayed through forwarder@getcheckoff.com)
-- correctly recovered its original sender but still could not associate
-- to anything, because agent.contacts/agent.interactions were completely
-- empty and every real Destination Hub opportunity (Willcox, Buena Vista,
-- Grand Lake, Rim Country) lived only as a handful of summary tasks under
-- one shared umbrella project (destination_hubs_wave_1). That umbrella
-- project is fine as a portfolio/grouping construct, but using it as the
-- canonical relationship scope means Willcox mail could in principle
-- collide with Grand Lake's — the exact cross-contamination this whole
-- system exists to prevent (see destinationDossier.ts's own
-- assertAllSameDestination doc, which already calls this out by name:
-- "so 'Give me the full picture on Grand Lake' can never silently include
-- Willcox's champion or Buena Vista's budget notes").
--
-- WHAT THIS DOES (idempotent — every statement below is safe to re-run):
--   1. Creates one DESTINATION_HUB project per real, already-in-progress
--      Destination opportunity found in the live audit: Willcox, Buena
--      Vista, Grand Lake, Rim Country. No other genuine Destination
--      opportunity was found in agent.tasks/agent.projects at audit time
--      (2026-09-05) — this migration does not invent one.
--   2. Reparents the FOUR existing agent.tasks rows that already
--      reference one of these destinations by name (three bootstrap_v1
--      outreach/follow-up tasks plus the Willcox arrival-hero regression
--      fix) from the umbrella project to their own destination's project.
--      Task ids, statuses, and created_at/task_events history are
--      untouched — only project_id moves, which is exactly what "attach
--      existing evidence to the correct per-destination project" means.
--   3. Inserts ONE verified contact: Desiree A. Gerth
--      (dez@strivevineyards.com, Strive Vineyards, Willcox AZ) — the
--      real, verified sender of last night's forwarded correspondence
--      (her own email signature block confirms identity; see
--      agent-service/playbooks/gmailForwardUnwrapping.ts's Reply-To
--      recovery path). No contact is created for "Lisa" (the Willcox
--      Chamber president mentioned only by first name in the email body)
--      because no verified email/identity for her exists anywhere in
--      current records — inventing one would violate the explicit "do
--      not infer Lisa's email" instruction. No contacts are created for
--      Buena Vista/Grand Lake/Rim Country because agent.contacts has
--      zero rows and no email/identity for anyone at those destinations
--      is recorded anywhere in this codebase or database.
--   4. Inserts ONE interaction record for the real Gmail message itself
--      (channel='EMAIL', source_ref='gmail:<real message id>', occurred_at
--      = the message's own real Date header, not "now") — durable
--      evidence that this correspondence happened, independent of
--      whether any relationship-driver run exists yet to consume it.
--
-- Review-ready, NOT applied automatically — same convention as every
-- other migration in this directory. Run manually once reviewed:
--   supabase db query -f supabase/migrations/20260905_agent_destination_portfolio_backfill.sql --linked

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM agent.projects WHERE project_key = 'destination_hubs_wave_1') THEN
    RAISE EXCEPTION 'Preflight failed: destination_hubs_wave_1 project not found — expected from earlier bootstrap. Aborting.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. One project per real Destination opportunity
-- ---------------------------------------------------------------------------

INSERT INTO agent.projects (project_key, name, project_type, status, summary, owner_id)
SELECT 'destination-willcox', 'Willcox', 'DESTINATION_HUB', 'ACTIVE',
  'Willcox, AZ — live Destination Hub (destination_zones.is_active=true). Anchor contact: Desiree Gerth / Strive Vineyards, connected via Ryan Gerth. Reparented from destination_hubs_wave_1 during the Phase 2M portfolio backfill.',
  (SELECT owner_id FROM agent.projects WHERE project_key = 'destination_hubs_wave_1')
WHERE NOT EXISTS (SELECT 1 FROM agent.projects WHERE project_key = 'destination-willcox');

INSERT INTO agent.projects (project_key, name, project_type, status, summary, owner_id)
SELECT 'destination-buena-vista', 'Buena Vista', 'DESTINATION_HUB', 'ACTIVE',
  'DVA-1/DVA-2/DAP evaluation complete per the existing outreach task; outreach itself had not started as of the Phase 2M backfill. Reparented from destination_hubs_wave_1.',
  (SELECT owner_id FROM agent.projects WHERE project_key = 'destination_hubs_wave_1')
WHERE NOT EXISTS (SELECT 1 FROM agent.projects WHERE project_key = 'destination-buena-vista');

INSERT INTO agent.projects (project_key, name, project_type, status, summary, owner_id)
SELECT 'destination-grand-lake', 'Grand Lake', 'DESTINATION_HUB', 'ACTIVE',
  'Initial outreach already sent; awaiting a response/follow-up per the existing task. Reparented from destination_hubs_wave_1.',
  (SELECT owner_id FROM agent.projects WHERE project_key = 'destination_hubs_wave_1')
WHERE NOT EXISTS (SELECT 1 FROM agent.projects WHERE project_key = 'destination-grand-lake');

INSERT INTO agent.projects (project_key, name, project_type, status, summary, owner_id)
SELECT 'destination-rim-country', 'Rim Country', 'DESTINATION_HUB', 'ACTIVE',
  'Initial outreach already sent; kept in Wave 1 despite greater complexity per the recorded rim_country_wave1 decision. Reparented from destination_hubs_wave_1.',
  (SELECT owner_id FROM agent.projects WHERE project_key = 'destination_hubs_wave_1')
WHERE NOT EXISTS (SELECT 1 FROM agent.projects WHERE project_key = 'destination-rim-country');

-- ---------------------------------------------------------------------------
-- 2. Reparent the 4 existing tasks that already name one of these
--    destinations — real evidence, moved to its correct isolated scope.
--    Guarded by id AND current project_id so this is a no-op on rerun.
-- ---------------------------------------------------------------------------

UPDATE agent.tasks SET project_id = (SELECT id FROM agent.projects WHERE project_key = 'destination-buena-vista')
WHERE id = '65527405-1714-40ad-9924-4238955fbd9d'
  AND project_id = (SELECT id FROM agent.projects WHERE project_key = 'destination_hubs_wave_1');

UPDATE agent.tasks SET project_id = (SELECT id FROM agent.projects WHERE project_key = 'destination-grand-lake')
WHERE id = 'ed241e54-e21f-413f-aeb1-4e7e9b65fdd8'
  AND project_id = (SELECT id FROM agent.projects WHERE project_key = 'destination_hubs_wave_1');

UPDATE agent.tasks SET project_id = (SELECT id FROM agent.projects WHERE project_key = 'destination-rim-country')
WHERE id = '0812519a-6302-4a79-8807-622d8725d81e'
  AND project_id = (SELECT id FROM agent.projects WHERE project_key = 'destination_hubs_wave_1');

UPDATE agent.tasks SET project_id = (SELECT id FROM agent.projects WHERE project_key = 'destination-willcox')
WHERE id = 'dd9bbd68-f234-4a74-969d-929ca318ee6b'
  AND project_id = (SELECT id FROM agent.projects WHERE project_key = 'destination_hubs_wave_1');

-- ---------------------------------------------------------------------------
-- 3. Verified contact — Desiree Gerth (Willcox). No other contact is
--    invented for any destination.
-- ---------------------------------------------------------------------------

INSERT INTO agent.contacts (organization_name, person_name, role, email, website, notes, source)
SELECT 'Strive Vineyards, LLC', 'Desiree A. Gerth', 'Owner & Winemaker', 'dez@strivevineyards.com', 'www.strivevineyards.com',
  'Jerry''s cousin; co-owns the Willcox tasting room with Ryan Gerth. Real correspondence recovered via Phase 2L forwarded-message unwrapping (Gmail message 1a071eba028425e5, relayed through forwarder@getcheckoff.com, recovered via Reply-To).',
  'gmail:1a071eba028425e5'
WHERE NOT EXISTS (SELECT 1 FROM agent.contacts WHERE email = 'dez@strivevineyards.com');

-- ---------------------------------------------------------------------------
-- 4. Interaction record for the real forwarded message — durable
--    evidence, keyed by the real Gmail message id (channel+source_ref is
--    already a unique index — interactions_channel_source_ref_idx).
-- ---------------------------------------------------------------------------

INSERT INTO agent.interactions (contact_id, project_id, channel, direction, occurred_at, subject, summary, requires_action, source_ref, metadata)
SELECT
  (SELECT id FROM agent.contacts WHERE email = 'dez@strivevineyards.com'),
  (SELECT id FROM agent.projects WHERE project_key = 'destination-willcox'),
  'EMAIL', 'INBOUND', '2026-09-05T14:14:21Z'::timestamptz,
  'Reviewing Check-Off App before Chamber meeting',
  'Desiree Gerth wrote ahead of the Willcox Chamber board meeting (Thursday) to confirm the pricing Jerry had proposed (Willcox Destination Champion $5,200/12mo; Additional Destination Partners $1,000 each/12mo) before the board votes on adopting CheckOff. Relayed through forwarder@getcheckoff.com; original sender recovered via Reply-To (dez@strivevineyards.com) since the body carried no forwarded-header block.',
  true,
  'gmail:1a071eba028425e5',
  '{"transportSender":"forwarder@getcheckoff.com","originalSender":"dez@strivevineyards.com","recoveredVia":"REPLY_TO","gmailMessageId":"1a071eba028425e5","gmailThreadId":"1a071eba028425e5"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM agent.interactions WHERE channel = 'EMAIL' AND source_ref = 'gmail:1a071eba028425e5');

DO $$
BEGIN
  IF (SELECT count(*) FROM agent.projects WHERE project_key IN ('destination-willcox', 'destination-buena-vista', 'destination-grand-lake', 'destination-rim-country')) <> 4 THEN
    RAISE EXCEPTION 'Postflight failed: expected 4 per-destination projects to exist.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM agent.contacts WHERE email = 'dez@strivevineyards.com') THEN
    RAISE EXCEPTION 'Postflight failed: Desiree Gerth contact not found after insert.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM agent.interactions WHERE channel = 'EMAIL' AND source_ref = 'gmail:1a071eba028425e5') THEN
    RAISE EXCEPTION 'Postflight failed: Willcox interaction record not found after insert.';
  END IF;
END $$;

COMMIT;
