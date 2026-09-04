// Phase 1E — whatsGoodWidgetDiscoveryArtifact.ts unit tests. Pure string
// generation/parsing, no filesystem, no DB.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DECISION_AREAS,
  IDENTITY_MARKER,
  TASK_ID,
  SOURCE_REF,
  WIDGET_CORE_MEANING_DECISION,
  WIDGET_FIRST_PLATFORM_FORM_DECISION,
  WIDGET_GEOFENCE_STATE_DECISION,
  WIDGET_NEARBY_DISCOVERY_DECISION,
  WIDGET_REFRESH_STABILITY_DECISION,
  APP_WIDE_SAVED_EXPERIENCES_DECISION,
  SAVED_ITEMS_LISTS_TAB_DECISION,
  WHATS_THE_THING_FOREGROUND_PRESENCE_RADIUS_DECISION,
  WHATS_GOOD_V1_CANDIDATE_POOL_AND_FALLBACK_DECISION,
  WHATS_GOOD_V1_UNCHECKED_PREFERENCE_DECISION,
  WHATS_GOOD_V1_EXPOSURE_ROTATION_DECISION,
  WHATS_GOOD_V1_MOMENTUM_RANKING_DECISION,
  buildDiscoveryArtifact,
  verifyDiscoveryArtifact,
} from './whatsGoodWidgetDiscoveryArtifact'

test('identity marker embeds the real task id and source ref', () => {
  assert.equal(IDENTITY_MARKER, `<!-- checkoff-chief:task-id=${TASK_ID} source-ref=${SOURCE_REF} -->`)
  assert.equal(TASK_ID, '3c677529-9c53-4d83-94b5-502a71636c26')
  assert.equal(SOURCE_REF, 'whats-good-widget-build')
})

test('DECISION_AREAS covers all 19 areas (the original 16 plus 3 added outside that scope), each with a valid classification', () => {
  assert.equal(DECISION_AREAS.length, 19)
  const validClassifications = new Set(['KNOWN', 'RESEARCH_NEEDED', 'JERRY_DECISION', 'TECHNICAL_DISCOVERY'])
  for (const area of DECISION_AREAS) {
    assert.ok(validClassifications.has(area.classification), `invalid classification for ${area.title}`)
    assert.ok(area.title.length > 0)
    assert.ok(area.notes.length > 0)
  }
})

test('exactly Decision Areas 1, 8, 11, 17, 18, 19 are KNOWN — every other area (including 2 and 5, which were only narrowed) stays genuinely open, nothing else was silently pre-resolved', () => {
  const knownAreas = DECISION_AREAS.filter((a) => a.classification === 'KNOWN')
  assert.equal(knownAreas.length, 6)
  assert.deepEqual(
    knownAreas.map((a) => a.title),
    [
      `What "What's Good / What to Get" means to a user`,
      'Business/list/item distribution logic',
      'OS-level home-screen widget vs. in-app home-screen module',
      `Home Rail geofence-triggered "You're Here / What's the Thing?" state`,
      'App-wide Saved/favoriting mechanism',
      'Saved-items surface placement',
    ]
  )
})

test('Decision Area 8 resolved to KNOWN citing all four whats_good_v1_* decisions, and explicitly preserves exact numeric ranking weights as undecided', () => {
  const area8 = DECISION_AREAS.find((a) => a.title === 'Business/list/item distribution logic')!
  assert.equal(area8.classification, 'KNOWN')
  for (const decision of [
    WHATS_GOOD_V1_CANDIDATE_POOL_AND_FALLBACK_DECISION,
    WHATS_GOOD_V1_UNCHECKED_PREFERENCE_DECISION,
    WHATS_GOOD_V1_EXPOSURE_ROTATION_DECISION,
    WHATS_GOOD_V1_MOMENTUM_RANKING_DECISION,
  ]) {
    assert.ok(area8.notes.includes(decision.decisionKey), `Area 8 notes missing ${decision.decisionKey}`)
  }
  assert.match(area8.notes, /implementation-tunable and undecided/i)
})

test('Decision Area 17 stays KNOWN and now also cites the foreground-presence-radius decision, distinguished from background visit detection', () => {
  const area17 = DECISION_AREAS.find((a) => a.title === `Home Rail geofence-triggered "You're Here / What's the Thing?" state`)!
  assert.equal(area17.classification, 'KNOWN')
  assert.ok(area17.notes.includes(WHATS_THE_THING_FOREGROUND_PRESENCE_RADIUS_DECISION.decisionKey))
  assert.match(area17.notes, /min\(geo_radius_m, 150m\)/)
  assert.match(area17.notes, /background visit-detection/i)
})

test('Decision Areas 2 and 5 remain unchanged JERRY_DECISION — no arbitrary movement-refresh distance threshold, exact score weight, or UX visual spec is claimed anywhere', () => {
  const area2 = DECISION_AREAS.find((a) => a.title === 'Home-screen placement and prominence')!
  const area5 = DECISION_AREAS.find((a) => a.title === 'Refresh/freshness behavior')!
  assert.equal(area2.classification, 'JERRY_DECISION')
  assert.equal(area5.classification, 'JERRY_DECISION')
  assert.ok(area5.notes.includes('Still undecided'))
  // Area 5's own notes must not have picked up a decided movement-distance
  // number — the 150m foreground-presence radius (Area 17) and the ~15/3
  // pool/pick counts (Area 8) are legitimately decided elsewhere and must
  // not leak a "meaningful change" refresh threshold into Area 5.
  assert.doesNotMatch(area5.notes, /\d+\s?(m|meter|meters|mi|mile|miles|km)\b/i)
})

test('Decision Areas 4, 6, 7 (personalization, progression/locking, thin markets) are unchanged and still open', () => {
  const area4 = DECISION_AREAS.find((a) => a.title === 'Personalization vs. market-wide recommendations')!
  const area6 = DECISION_AREAS.find((a) => a.title === 'Locking/unlocking or progression mechanics, if any')!
  const area7 = DECISION_AREAS.find((a) => a.title === 'Behavior in thin/new markets')!
  assert.equal(area4.classification, 'JERRY_DECISION')
  assert.equal(area6.classification, 'JERRY_DECISION')
  assert.equal(area7.classification, 'JERRY_DECISION')
})

test('the six KNOWN decision areas cite the actual recorded decisionKey and text — no drift between the document and the decision constants', () => {
  const singleDecisionCases: Array<[string, { decisionKey: string; decision: string }]> = [
    [`What "What's Good / What to Get" means to a user`, WIDGET_CORE_MEANING_DECISION],
    ['OS-level home-screen widget vs. in-app home-screen module', WIDGET_FIRST_PLATFORM_FORM_DECISION],
    ['App-wide Saved/favoriting mechanism', APP_WIDE_SAVED_EXPERIENCES_DECISION],
    ['Saved-items surface placement', SAVED_ITEMS_LISTS_TAB_DECISION],
  ]
  for (const [title, decision] of singleDecisionCases) {
    const area = DECISION_AREAS.find((a) => a.title === title)!
    assert.ok(area.notes.includes(decision.decisionKey), `${title} notes missing decisionKey`)
    assert.ok(area.notes.includes(decision.decision), `${title} notes missing decision text`)
  }
  // Area 17 and Area 8 are checked more specifically in their own tests
  // above, since they now cite multiple decisions each.
})

test('all twelve decision constants carry the exact approved decision text', () => {
  const cases: Array<[{ decisionKey: string; decision: string }, string, string]> = [
    [WIDGET_CORE_MEANING_DECISION, 'widget_core_meaning_definition', `"What's Good / What to Get" is one connected recommendation experience. "What's Good" helps users choose a small, opinionated set of worthwhile places or experiences. "What to Get" tells them the specific signature item, experience, or thing worth checking off once they choose. The feature should stay intentionally selective rather than becoming another broad content rail.`],
    [WIDGET_FIRST_PLATFORM_FORM_DECISION, 'widget_first_platform_form', `The first version of "What's Good / What to Get" will be an in-app HomeScreen module. Native iPhone and Android home-screen widgets are deferred until the in-app experience is proven and may become a later distribution/engagement extension.`],
    [WIDGET_GEOFENCE_STATE_DECISION, 'widget_whats_the_thing_geofence_state', `When the #1 Home Rail item is inside its geofence, the card changes into a more prominent "You're Here / What's the Thing?" state. It should clearly stand out through hierarchy, size, motion, or emphasis without flashing, overwhelming, or visually dominating the screen.`],
    [WIDGET_NEARBY_DISCOVERY_DECISION, 'widget_whats_good_nearby_discovery', `"What's Good" is nearby discovery beyond the current five-item Home Rail. Its recommendations should come from experiences outside the current Home Rail set and rotate over time so the surface does not become stagnant.`],
    [WIDGET_REFRESH_STABILITY_DECISION, 'widget_location_refresh_stability', `Home Rail and What's Good should refresh when the user's location or context changes meaningfully, not continuously every few seconds and not merely because the app briefly backgrounds and resumes. Recommendation sets should remain stable long enough for a user to act on what they saw.`],
    [APP_WIDE_SAVED_EXPERIENCES_DECISION, 'app_wide_saved_experiences', `Experiences can be saved app-wide with a heart control. The heart means "Save," not "Like," so users can retain experiences they want to revisit later even when dynamic recommendation surfaces change.`],
    [SAVED_ITEMS_LISTS_TAB_DECISION, 'saved_items_live_in_lists_tab', `Saved experiences will live in the existing Lists tab alongside user-created lists. Saved should give the Lists tab immediate utility for users who have not created custom lists while continuing to support heavier list users.`],
    [WHATS_THE_THING_FOREGROUND_PRESENCE_RADIUS_DECISION, 'whats_the_thing_foreground_presence_radius', `The foreground "You're Here / What's the Thing?" state uses each item's existing geo_radius_m, capped at 150 meters. The foreground presence radius is therefore min(geo_radius_m, 150m), with NULL/default oversized radii also capped at 150m. Background visit-detection continues to use the item's full existing geo_radius_m and remains a separate concept.`],
    [WHATS_GOOD_V1_CANDIDATE_POOL_AND_FALLBACK_DECISION, 'whats_good_v1_candidate_pool_and_fallback', `What's Good displays 3 picks selected from a nearby candidate pool of approximately 15 experiences. The current Home Rail 5 are always excluded from the pool. If the candidate pool is insufficient, expand geographically using existing CheckOff proximity/tiering mechanics; if still insufficient, use existing Universal items as the final fallback.`],
    [WHATS_GOOD_V1_UNCHECKED_PREFERENCE_DECISION, 'whats_good_v1_unchecked_preference', `Experiences the current user has never checked off (lifetime, not season-scoped) receive a strong preference in What's Good ranking. Previously checked-off experiences are downranked, not hard-excluded, so highly active users who have checked off most nearby items never reach a dead end.`],
    [WHATS_GOOD_V1_EXPOSURE_ROTATION_DECISION, 'whats_good_v1_exposure_rotation', `What's Good rotates across genuine sessions and revisits rather than reshuffling continuously. Recently shown experiences receive a deterministic exposure penalty (never pure random selection); older exposures naturally become eligible again as the unseen/recently-unseen pool is exhausted. A short app interruption or background/foreground cycle does not change the 3 displayed items. Exposure state is tracked in a dedicated lightweight table (not folded into interaction_events), storing at minimum user, item, and last-shown timestamp.`],
    [WHATS_GOOD_V1_MOMENTUM_RANKING_DECISION, 'whats_good_v1_momentum_ranking', `Recent genuine community checkoff activity contributes a bounded positive ranking signal ("momentum") to What's Good. Momentum is based on distinct recent users, not raw checkoff count, and only begins once at least 3 distinct users have contributed within the active momentum window. The momentum window is a rolling 30 days for V1, with newer activity weighted more than older activity within that window. Verification-method weighting applies lightly, so higher-confidence checkoffs contribute more than legacy/admin-style activity. A small capped "rising" bonus applies when an experience's recent unique-user activity is increasing versus the preceding comparable period. Momentum is capped and can never become a popularity leaderboard: it may nudge ranking, but must never overcome both discovery freshness (unchecked preference) and rotation freshness (recent-exposure penalty) at the same time — an already-checked-off, recently-shown item must never be boosted by momentum above a never-checked-off, meaningfully-less-recently-exposed item. Paid/sponsored placement remains entirely separate from this organic ranking signal. Exact numeric weights are implementation-tunable, not decided here.`],
  ]
  for (const [decision, key, text] of cases) {
    assert.equal(decision.decisionKey, key)
    assert.equal(decision.decision, text)
  }
})

test('buildDiscoveryArtifact: all twelve decisions appear under Existing Constraints', () => {
  const content = buildDiscoveryArtifact()
  assert.match(content, /Decision "widget_marketing_after_build"/)
  for (const decision of [
    WIDGET_CORE_MEANING_DECISION,
    WIDGET_FIRST_PLATFORM_FORM_DECISION,
    WIDGET_GEOFENCE_STATE_DECISION,
    WIDGET_NEARBY_DISCOVERY_DECISION,
    WIDGET_REFRESH_STABILITY_DECISION,
    APP_WIDE_SAVED_EXPERIENCES_DECISION,
    SAVED_ITEMS_LISTS_TAB_DECISION,
    WHATS_THE_THING_FOREGROUND_PRESENCE_RADIUS_DECISION,
    WHATS_GOOD_V1_CANDIDATE_POOL_AND_FALLBACK_DECISION,
    WHATS_GOOD_V1_UNCHECKED_PREFERENCE_DECISION,
    WHATS_GOOD_V1_EXPOSURE_ROTATION_DECISION,
    WHATS_GOOD_V1_MOMENTUM_RANKING_DECISION,
  ]) {
    assert.match(content, new RegExp(`Decision "${decision.decisionKey}"`))
  }
})

test('buildDiscoveryArtifact: passes its own verifier', () => {
  const content = buildDiscoveryArtifact()
  const result = verifyDiscoveryArtifact(content)
  assert.deepEqual(result.reasons, [])
  assert.equal(result.valid, true)
})

test('buildDiscoveryArtifact: contains the identity marker and every required top-level section', () => {
  const content = buildDiscoveryArtifact()
  assert.ok(content.startsWith(IDENTITY_MARKER))
  for (const heading of ['Known Facts', 'Existing Constraints', 'Known Product Intent', 'Decision Areas', 'Suggested Research Work', 'Proposed Decision Sequence']) {
    assert.ok(content.includes(`## ${heading}`), `missing section: ${heading}`)
  }
})

test('buildDiscoveryArtifact: the recorded sequencing decision is stated as a known constraint without extrapolation', () => {
  const content = buildDiscoveryArtifact()
  assert.match(content, /Aggressive onboarding and in-app promotion of What's Good \/ What to Get begins only after the widget exists/)
  // Must not contain invented marketing-strategy specifics beyond that sequencing statement.
  assert.doesNotMatch(content, /press release|paid campaign|influencer/i)
})

test('verifyDiscoveryArtifact: fails when the identity marker is missing', () => {
  const content = buildDiscoveryArtifact().replace(IDENTITY_MARKER, '')
  const result = verifyDiscoveryArtifact(content)
  assert.equal(result.valid, false)
  assert.ok(result.reasons.some((r) => r.includes('identity marker')))
})

test('verifyDiscoveryArtifact: fails when a required top-level section is missing', () => {
  const content = buildDiscoveryArtifact().replace('## Suggested Research Work', '## Renamed Section')
  const result = verifyDiscoveryArtifact(content)
  assert.equal(result.valid, false)
  assert.ok(result.reasons.some((r) => r.includes('Suggested Research Work')))
})

test('verifyDiscoveryArtifact: fails when a decision area is missing its classification line', () => {
  const content = buildDiscoveryArtifact().replace('Classification: JERRY_DECISION', 'Classification removed')
  const result = verifyDiscoveryArtifact(content)
  assert.equal(result.valid, false)
})

test('verifyDiscoveryArtifact: fails when a decision area carries an invalid classification value', () => {
  const content = buildDiscoveryArtifact().replace('Classification: TECHNICAL_DISCOVERY', 'Classification: MAYBE_LATER')
  const result = verifyDiscoveryArtifact(content)
  assert.equal(result.valid, false)
  assert.ok(result.reasons.some((r) => r.includes('invalid classification')))
})

test('verifyDiscoveryArtifact: fails on suspiciously short content', () => {
  const result = verifyDiscoveryArtifact(IDENTITY_MARKER + '\ntoo short')
  assert.equal(result.valid, false)
  assert.ok(result.reasons.some((r) => r.includes('short')))
})
