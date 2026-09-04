#!/usr/bin/env node
// Chief Phase 2A — one-time (but idempotent/rerunnable) reconciliation of
// tonight's real CheckOff operational state into agent.tasks, per the
// explicit Phase 2A instruction: "Reconcile the active CheckOff work so
// Chief accurately knows tonight's state... Do not store these temporary
// statuses as durable Open Brain thoughts."
//
// Two parts:
//   1. Seeds one agent.tasks row per real business_outreach_tokens row
//      (all 140) via the Business Photo Outreach playbook engine —
//      idempotent via (source_type, source_ref), safe to re-run.
//   2. Captures the other real state areas (App Release, Business Photo
//      Infrastructure, Home 2026, Destination Hubs, Visit Reminders,
//      Chief Phase 2A itself) as a handful of createTask calls under the
//      closest-fitting EXISTING project (no new projects created) — also
//      idempotent via source_type='phase2a_state_capture'.
//
// `npm run agent:reconcile-state` (see package.json).

import { query, closePool } from './db'
import { createTask } from './mutations'
import { seedBusinessPhotoOutreachTasks, reconcileBusinessPhotoOutreach, type OutreachTokenSeed } from './playbooks/businessPhotoOutreachEngine'

const ACTOR = 'chief'
const STATE_CAPTURE_SOURCE_TYPE = 'phase2a_state_capture'

interface TokenJoinRow {
  id: string
  business_name: string
  exact_checkoff_item: string
  is_secret: boolean
}

async function seedRealOutreachTasks(): Promise<void> {
  const rows = await query<TokenJoinRow>(
    `select t.id, t.business_name, t.exact_checkoff_item, i.is_secret
     from public.business_outreach_tokens t
     join public.items i on i.id = t.item_id
     where t.campaign = 'business_photo_outreach_2026_09'
     order by t.business_name`
  )
  const seeds: OutreachTokenSeed[] = rows.map((r) => ({ tokenId: r.id, businessName: r.business_name, itemBody: r.exact_checkoff_item, isSecretItem: r.is_secret }))
  const result = await seedBusinessPhotoOutreachTasks(seeds)
  console.log(`[seed] Business Photo Outreach: ${result.created} created, ${result.alreadyExisted} already existed (of ${seeds.length} live tokens).`)

  const reconciled = await reconcileBusinessPhotoOutreach()
  console.log(`[reconcile] Business Photo Outreach: ${reconciled.length} task(s) advanced (expected 0 on a fresh seed — nothing has been sent yet).`)
}

interface StateCapture {
  ref: string
  title: string
  projectKey: string
  description: string
  nextAction: string
}

const STATE_CAPTURES: StateCapture[] = [
  {
    ref: 'app_release_candidate_2026_09_04',
    title: 'App Release: iOS 145 + Android 8 — awaiting Jerry\'s public-rollout approval',
    projectKey: 'agent_platform',
    description:
      'iOS release candidate 1.1.6 (145) built and submitted to App Store Connect (auto-submit succeeded, processing). ' +
      'Android versionCode 8 (1.1.6) built via EAS. Neither has been rolled out publicly — public App Store / Play Store ' +
      'release requires Jerry\'s separate, explicit approval per the release-candidate task\'s hard boundary.',
    nextAction: 'Needs Jerry: review both release candidates and decide on public rollout.',
  },
  {
    ref: 'business_photo_infrastructure_2026_09_04',
    title: 'Business Photo Infrastructure: confirm/photo/moderation/rotation verified end-to-end',
    projectKey: 'business_photo_campaign',
    description:
      'getcheckoff.com/confirm/<token> live and verified: item confirmation/correction, business photo upload ' +
      '(source=business_submission, submitted_by_user_id=null), Admin -> Images -> Cover Candidates moderation, ' +
      'and multi-image rotation (display_eligible/is_primary/display_weight, items.active_cover_candidate_id kept in sync) ' +
      'all confirmed working against real production data and cleaned up afterward.',
    nextAction: 'No action needed — infrastructure verified. The Business Photo Outreach playbook (Phase 2A) now runs on top of it.',
  },
  {
    ref: 'home_2026_redesign_2026_09_04',
    title: 'Home 2026 redesign: release-candidate, behind whats_good_v1 (Jerry-only)',
    projectKey: 'whats_good_widget',
    description:
      'What\'s Good discovery, What\'s the Thing at-place hero, compact Near You, and image/no-image presentation are ' +
      'release-candidate quality. whats_good_v1 and community_cover_photos remain disabled globally — only Jerry\'s ' +
      'own tester override sees the redesign today.',
    nextAction: 'No action needed — awaiting Jerry\'s decision on when to enable the flags more broadly.',
  },
  {
    ref: 'destination_hubs_willcox_2026_09_04',
    title: 'Destination Hub: Willcox arrival hero regression fixed, generic behavior restored',
    projectKey: 'destination_hubs_wave_1',
    description:
      'Root cause was a broken embedded column reference (curated_lists.hero_image_url does not exist) silently ' +
      'swallowed by a bare catch, so the destination zone never resolved regardless of the admin toggle. Fixed to read ' +
      'destinations.hero_image_url; Willcox is currently ON (admin destination_zones.is_active=true) and verified ' +
      'end-to-end (ON/OFF/outside-zone, generic destinationId routing, no hardcoding).',
    nextAction: 'No action needed — fix verified. Generalizes to future Destination Hubs (Buena Vista, Rim Country, Grand Lake, etc).',
  },
  {
    ref: 'visit_reminders_2026_09_04',
    title: 'Visit Reminders V1/V1.5: code exists, migrations deliberately unapplied',
    projectKey: 'visit_detection_reminders',
    description:
      'Visit detection Phase 1 code and the V1/V1.5 reminder code paths exist in the repo, but their migrations ' +
      '(at_place_checkoff_reminders_flag, visit_reminder_v1_notify_trigger) remain unapplied — confirmed live: no ' +
      'at_place_checkoff_reminders feature_flags row exists, no notify trigger exists. Field testing and the missing ' +
      'visit-profile audit remain deferred, per Jerry\'s prior explicit instruction.',
    nextAction: 'No action needed — deliberately paused. Do not apply these migrations without a separate explicit go-ahead.',
  },
]

async function captureOtherStateAreas(): Promise<void> {
  for (const c of STATE_CAPTURES) {
    const result = await createTask({
      title: c.title,
      projectKey: c.projectKey,
      status: 'DONE',
      changedByOwnerKey: ACTOR,
      ownerKey: ACTOR,
      description: c.description,
      nextAction: c.nextAction,
      sourceType: STATE_CAPTURE_SOURCE_TYPE,
      sourceRef: c.ref,
    })
    console.log(`[state] ${c.ref}: ${result.created ? 'created' : 'already existed'} (task ${result.task.id})`)
  }
}

async function main(): Promise<void> {
  await seedRealOutreachTasks()
  await captureOtherStateAreas()
}

main()
  .catch((err) => {
    console.error('[agent-service/reconcilePhase2AState] failed:', err)
    process.exitCode = 1
  })
  .finally(() => {
    void closePool()
  })
