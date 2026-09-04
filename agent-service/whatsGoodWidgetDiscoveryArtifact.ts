// Phase 1E — the fixed, reviewed content for the What's Good / What to Get
// widget's FIRST autonomous artifact. Deliberately separate from
// actionHandlers.ts (see that module's header doc): a trusted capability
// registry should hold policy and dispatch logic, not product prose.
//
// WHAT THIS DOCUMENT IS NOT: a design specification. No product decisions
// have been made yet, and this module does not make any on Chief's behalf.
// Every substantive open question is listed under DECISION_AREAS with an
// explicit classification — KNOWN items are stated as fact because they
// are already true today (schema, an existing recorded decision, existing
// repo infrastructure); everything else is left open. JERRY_DECISION items
// are never resolved here, only surfaced.
//
// This module owns BOTH the content builder and its own verifier, because
// they must stay in lock-step with the same DECISION_AREAS list — a
// verifier that duplicated the section list as separate literal strings
// could silently drift from what buildDiscoveryArtifact() actually emits.

export const ARTIFACT_FILENAME = 'product-discovery.md'
export const ARTIFACT_PATH = 'docs/whats-good-widget/product-discovery.md'

export const TASK_ID = '3c677529-9c53-4d83-94b5-502a71636c26'
export const SOURCE_REF = 'whats-good-widget-build'
export const IDENTITY_MARKER = `<!-- checkoff-chief:task-id=${TASK_ID} source-ref=${SOURCE_REF} -->`

/**
 * The two Jerry decisions recorded 2026-09-01, resolving Decision Areas 1
 * and 11 below. Single-sourced here so the decision text embedded in this
 * document and the text actually written to agent.decisions can never
 * drift apart — both the artifact content and the decision-creation call
 * read from these same constants.
 */
export const WIDGET_CORE_MEANING_DECISION = {
  decisionKey: 'widget_core_meaning_definition',
  decision:
    `"What's Good / What to Get" is one connected recommendation experience. "What's Good" helps users choose a small, opinionated set of worthwhile places or experiences. "What to Get" tells them the specific signature item, experience, or thing worth checking off once they choose. The feature should stay intentionally selective rather than becoming another broad content rail.`,
  rationale: `Resolves Decision Area 1 ('What "What's Good / What to Get" means to a user') in ${'docs/whats-good-widget/product-discovery.md'}.`,
} as const

export const WIDGET_FIRST_PLATFORM_FORM_DECISION = {
  decisionKey: 'widget_first_platform_form',
  decision:
    `The first version of "What's Good / What to Get" will be an in-app HomeScreen module. Native iPhone and Android home-screen widgets are deferred until the in-app experience is proven and may become a later distribution/engagement extension.`,
  rationale: `Resolves Decision Area 11 ('OS-level home-screen widget vs. in-app home-screen module') in ${'docs/whats-good-widget/product-discovery.md'}.`,
} as const

/**
 * Five more Jerry decisions, recorded 2026-09-01. Two (geofence state,
 * nearby-discovery scope) refine existing Decision Areas without flipping
 * them to KNOWN (see WIDGET_LOCATION_REFRESH_STABILITY_DECISION and
 * WIDGET_WHATS_GOOD_NEAREST_DISCOVERY_DECISION's usage in DECISION_AREAS
 * below — Areas 2, 5, 8 stay open, just narrower). The other three resolve
 * three genuinely NEW decision areas (17-19) outside the original 16 —
 * see DECISION_AREAS' tail entries.
 */
export const WIDGET_GEOFENCE_STATE_DECISION = {
  decisionKey: 'widget_whats_the_thing_geofence_state',
  decision:
    `When the #1 Home Rail item is inside its geofence, the card changes into a more prominent "You're Here / What's the Thing?" state. It should clearly stand out through hierarchy, size, motion, or emphasis without flashing, overwhelming, or visually dominating the screen.`,
  rationale: `The Home Rail already owns immediate proximity. The geofence state should make the exact CheckOff thing at the user's current place obvious without competing with the rest of HomeScreen.`,
} as const

export const WIDGET_NEARBY_DISCOVERY_DECISION = {
  decisionKey: 'widget_whats_good_nearby_discovery',
  decision:
    `"What's Good" is nearby discovery beyond the current five-item Home Rail. Its recommendations should come from experiences outside the current Home Rail set and rotate over time so the surface does not become stagnant.`,
  rationale: `This gives Home Rail and What's Good distinct jobs: Home Rail answers what is closest/right here, while What's Good helps users discover worthwhile nearby experiences beyond those immediate five.`,
} as const

export const WIDGET_REFRESH_STABILITY_DECISION = {
  decisionKey: 'widget_location_refresh_stability',
  decision:
    `Home Rail and What's Good should refresh when the user's location or context changes meaningfully, not continuously every few seconds and not merely because the app briefly backgrounds and resumes. Recommendation sets should remain stable long enough for a user to act on what they saw.`,
  rationale: `Location-aware surfaces need to stay relevant without reshuffling so aggressively that users lose an item they were navigating toward or discussing.`,
} as const

export const APP_WIDE_SAVED_EXPERIENCES_DECISION = {
  decisionKey: 'app_wide_saved_experiences',
  decision:
    `Experiences can be saved app-wide with a heart control. The heart means "Save," not "Like," so users can retain experiences they want to revisit later even when dynamic recommendation surfaces change.`,
  rationale: `Dynamic discovery becomes more useful when users can preserve something that caught their attention instead of losing it after recommendations refresh.`,
} as const

export const SAVED_ITEMS_LISTS_TAB_DECISION = {
  decisionKey: 'saved_items_live_in_lists_tab',
  decision:
    `Saved experiences will live in the existing Lists tab alongside user-created lists. Saved should give the Lists tab immediate utility for users who have not created custom lists while continuing to support heavier list users.`,
  rationale: `This avoids adding another top-level destination and gives the existing Lists tab useful content even for users with few or no custom lists.`,
} as const

/**
 * Five more Jerry decisions, recorded 2026-09-01, locking the V1 What's
 * Good selection architecture and the foreground "You're Here / What's
 * the Thing?" presence radius. The four `whats_good_v1_*` decisions
 * collectively resolve Decision Area 8 to KNOWN (see DECISION_AREAS
 * below) — exact numeric ranking weights remain implementation-tunable
 * and undecided, by explicit design (see each decision's own text).
 * `whats_the_thing_foreground_presence_radius` refines Area 17 (already
 * KNOWN) without changing its classification.
 */
export const WHATS_THE_THING_FOREGROUND_PRESENCE_RADIUS_DECISION = {
  decisionKey: 'whats_the_thing_foreground_presence_radius',
  decision:
    `The foreground "You're Here / What's the Thing?" state uses each item's existing geo_radius_m, capped at 150 meters. The foreground presence radius is therefore min(geo_radius_m, 150m), with NULL/default oversized radii also capped at 150m. Background visit-detection continues to use the item's full existing geo_radius_m and remains a separate concept.`,
  rationale: `Most active non-Universal items already use intentionally calibrated 100m or 150m radii, so those values should be preserved. However, some experiences intentionally use much larger geofences for background visit detection or broad/regional experiences. Capping foreground presence at 150m prevents CheckOff from claiming "You're Here" when the user is still materially far from the place, while reusing the precise per-item data that already exists.`,
} as const

export const WHATS_GOOD_V1_CANDIDATE_POOL_AND_FALLBACK_DECISION = {
  decisionKey: 'whats_good_v1_candidate_pool_and_fallback',
  decision:
    `What's Good displays 3 picks selected from a nearby candidate pool of approximately 15 experiences. The current Home Rail 5 are always excluded from the pool. If the candidate pool is insufficient, expand geographically using existing CheckOff proximity/tiering mechanics; if still insufficient, use existing Universal items as the final fallback.`,
  rationale: `This defines how the What's Good candidate set is assembled and bounded before any ranking is applied, reusing the same proximity-tiering and Universal-fallback mechanics Home Rail already has rather than inventing new geographic logic.`,
} as const

export const WHATS_GOOD_V1_UNCHECKED_PREFERENCE_DECISION = {
  decisionKey: 'whats_good_v1_unchecked_preference',
  decision:
    `Experiences the current user has never checked off (lifetime, not season-scoped) receive a strong preference in What's Good ranking. Previously checked-off experiences are downranked, not hard-excluded, so highly active users who have checked off most nearby items never reach a dead end.`,
  rationale: `Lifetime checkoff history is the right scope for "have you actually done this before" — not season-only. Downranking instead of excluding prevents the surface from going empty for the app's most engaged users.`,
} as const

export const WHATS_GOOD_V1_EXPOSURE_ROTATION_DECISION = {
  decisionKey: 'whats_good_v1_exposure_rotation',
  decision:
    `What's Good rotates across genuine sessions and revisits rather than reshuffling continuously. Recently shown experiences receive a deterministic exposure penalty (never pure random selection); older exposures naturally become eligible again as the unseen/recently-unseen pool is exhausted. A short app interruption or background/foreground cycle does not change the 3 displayed items. Exposure state is tracked in a dedicated lightweight table (not folded into interaction_events), storing at minimum user, item, and last-shown timestamp.`,
  rationale: `Rotation needs to feel deliberate, not stagnant or randomly shuffled, and must not punish a user for briefly leaving the app. A dedicated table keeps this rotation-specific read/write pattern simple and independent of interaction_events' broader, differently-scoped event log.`,
} as const

export const WHATS_GOOD_V1_MOMENTUM_RANKING_DECISION = {
  decisionKey: 'whats_good_v1_momentum_ranking',
  decision:
    `Recent genuine community checkoff activity contributes a bounded positive ranking signal ("momentum") to What's Good. Momentum is based on distinct recent users, not raw checkoff count, and only begins once at least 3 distinct users have contributed within the active momentum window. The momentum window is a rolling 30 days for V1, with newer activity weighted more than older activity within that window. Verification-method weighting applies lightly, so higher-confidence checkoffs contribute more than legacy/admin-style activity. A small capped "rising" bonus applies when an experience's recent unique-user activity is increasing versus the preceding comparable period. Momentum is capped and can never become a popularity leaderboard: it may nudge ranking, but must never overcome both discovery freshness (unchecked preference) and rotation freshness (recent-exposure penalty) at the same time — an already-checked-off, recently-shown item must never be boosted by momentum above a never-checked-off, meaningfully-less-recently-exposed item. Paid/sponsored placement remains entirely separate from this organic ranking signal. Exact numeric weights are implementation-tunable, not decided here.`,
  rationale: `This creates the activation loop CheckOff wants (genuine local activity increases discoverability) while structurally preventing it from becoming a raw popularity leaderboard or overriding the two things that actually make the surface feel fresh and personally relevant.`,
} as const

export type DecisionClassification = 'KNOWN' | 'RESEARCH_NEEDED' | 'JERRY_DECISION' | 'TECHNICAL_DISCOVERY'

export interface DecisionArea {
  title: string
  classification: DecisionClassification
  notes: string
}

/**
 * The 16 decision areas Jerry named as required coverage for this brief.
 * Order is the proposed research/decision order's natural grouping, not
 * significant beyond that — DECISION_SEQUENCE below is the actual
 * sequencing recommendation.
 */
export const DECISION_AREAS: readonly DecisionArea[] = [
  {
    title: `What "What's Good / What to Get" means to a user`,
    classification: 'KNOWN',
    notes: `Resolved by Jerry decision \`${WIDGET_CORE_MEANING_DECISION.decisionKey}\` (2026-09-01): ${WIDGET_CORE_MEANING_DECISION.decision}`,
  },
  {
    title: 'Home-screen placement and prominence',
    classification: 'JERRY_DECISION',
    notes: `HomeScreen.jsx is currently a scrollable stack of rail/section components (see ExperiencesRail). Placement could be a new top-of-screen section, a rail alongside the existing nearby/themed rails, or a persistent header module — each has different prominence and different displacement cost against existing home-screen content. Decision \`${WIDGET_GEOFENCE_STATE_DECISION.decisionKey}\` (2026-09-01) clarifies that Home Rail already owns the immediate-proximity slot, which narrows but does not resolve where the separate What's Good module itself sits on HomeScreen.`,
  },
  {
    title: 'What content/data feeds it',
    classification: 'TECHNICAL_DISCOVERY',
    notes:
      'Candidate sources already exist in the schema (curated_lists, audience_groups, featured_experiences, metro_areas — see prior admin-tool work). Needs a concrete mapping exercise against those tables before a UX spec can reference real data shapes; not yet done.',
  },
  {
    title: 'Personalization vs. market-wide recommendations',
    classification: 'JERRY_DECISION',
    notes: 'Whether the widget shows the same content to everyone in a market or is personalized per user (and by what signal) is undecided.',
  },
  {
    title: 'Refresh/freshness behavior',
    classification: 'JERRY_DECISION',
    notes: `Directional principle now known (decision \`${WIDGET_REFRESH_STABILITY_DECISION.decisionKey}\`, 2026-09-01): refresh on meaningful location/context change, not continuous polling, not on mere background/resume; recommendation sets stay stable long enough to act on. Still undecided: the specific "meaningful change" threshold and minimum stability duration — the next scheduled decision (see Proposed Decision Sequence).`,
  },
  {
    title: 'Locking/unlocking or progression mechanics, if any',
    classification: 'JERRY_DECISION',
    notes:
      'The app already has tier/badge progression mechanics elsewhere (BadgeCelebrationModal, TierUpgradeCelebrationModal) — undecided whether this widget hooks into that system or stays fully ungated.',
  },
  {
    title: 'Behavior in thin/new markets',
    classification: 'JERRY_DECISION',
    notes:
      'Metro-launch work elsewhere in this repo shows content coverage varies significantly by market. An empty or sparse widget in a new/thin market needs an explicit fallback decision, not silent emptiness.',
  },
  {
    title: 'Business/list/item distribution logic',
    classification: 'KNOWN',
    notes: `Resolved by four Jerry decisions (2026-09-01): \`${WHATS_GOOD_V1_CANDIDATE_POOL_AND_FALLBACK_DECISION.decisionKey}\` (pool of ~15, Home Rail-5 exclusion, geographic expansion then Universal fallback), \`${WHATS_GOOD_V1_UNCHECKED_PREFERENCE_DECISION.decisionKey}\` (lifetime unchecked preference, downranked not excluded), \`${WHATS_GOOD_V1_EXPOSURE_ROTATION_DECISION.decisionKey}\` (deterministic exposure-based rotation via a dedicated table, no pure randomness), and \`${WHATS_GOOD_V1_MOMENTUM_RANKING_DECISION.decisionKey}\` (bounded community-momentum ranking signal that can never override unchecked preference and exposure rotation together). Exact numeric score weights remain implementation-tunable and undecided — see each decision's own text.`,
  },
  {
    title: 'iPhone-specific behavior',
    classification: 'TECHNICAL_DISCOVERY',
    notes: 'Not yet investigated — depends heavily on the OS-widget-vs-in-app-module decision below.',
  },
  {
    title: 'Android-specific behavior',
    classification: 'TECHNICAL_DISCOVERY',
    notes: 'Not yet investigated — same dependency as iPhone-specific behavior above.',
  },
  {
    title: 'OS-level home-screen widget vs. in-app home-screen module',
    classification: 'KNOWN',
    notes: `Resolved by Jerry decision \`${WIDGET_FIRST_PLATFORM_FORM_DECISION.decisionKey}\` (2026-09-01): ${WIDGET_FIRST_PLATFORM_FORM_DECISION.decision}`,
  },
  {
    title: 'Analytics and success metrics',
    classification: 'JERRY_DECISION',
    notes: 'No success definition (engagement, conversion to a check-in, retention lift, or something else) has been proposed yet.',
  },
  {
    title: 'Rollout/feature flags',
    classification: 'JERRY_DECISION',
    notes:
      'Feature-flag infrastructure already exists (lib/featureFlags.js, feature_flags / feature_flag_overrides tables, per-user overrides) and could gate this rollout — whether and how to use it here is a decision, not a technical blocker.',
  },
  {
    title: 'Advertising/monetization implications, if any',
    classification: 'JERRY_DECISION',
    notes: 'Whether featured/sponsored placement is ever part of this surface is completely open and not assumed here.',
  },
  {
    title: 'Onboarding and in-app promotion after the feature exists',
    classification: 'JERRY_DECISION',
    notes:
      'The SEQUENCING is already decided (see Existing Constraints below) — this area is about the specific onboarding/promotion mechanics once that gate opens, which are not yet defined.',
  },
  {
    title: 'External marketing/launch strategy after build',
    classification: 'JERRY_DECISION',
    notes: 'Same sequencing constraint applies. No strategy beyond "after the widget exists" has been discussed, and none is assumed here.',
  },
  {
    title: `Home Rail geofence-triggered "You're Here / What's the Thing?" state`,
    classification: 'KNOWN',
    notes: `Resolved by Jerry decision \`${WIDGET_GEOFENCE_STATE_DECISION.decisionKey}\` (2026-09-01): ${WIDGET_GEOFENCE_STATE_DECISION.decision} Exact visual/motion execution remains a later UX-design task, not an unresolved product decision — the principle itself is decided. The exact foreground trigger is min(geo_radius_m, 150m) — see decision \`${WHATS_THE_THING_FOREGROUND_PRESENCE_RADIUS_DECISION.decisionKey}\` (2026-09-01) — kept distinct from the larger radius background visit-detection continues to use.`,
  },
  {
    title: 'App-wide Saved/favoriting mechanism',
    classification: 'KNOWN',
    notes: `Resolved by Jerry decision \`${APP_WIDE_SAVED_EXPERIENCES_DECISION.decisionKey}\` (2026-09-01): ${APP_WIDE_SAVED_EXPERIENCES_DECISION.decision} A new product area outside the original 16 discovery decision areas — connected to but distinct from the What's Good / What to Get widget itself.`,
  },
  {
    title: 'Saved-items surface placement',
    classification: 'KNOWN',
    notes: `Resolved by Jerry decision \`${SAVED_ITEMS_LISTS_TAB_DECISION.decisionKey}\` (2026-09-01): ${SAVED_ITEMS_LISTS_TAB_DECISION.decision}`,
  },
]

const KNOWN_FACTS: readonly string[] = [
  `Task ${TASK_ID} ("Build What's Good / What to Get widget", source ref "${SOURCE_REF}") is READY under the "whats_good_widget" project (type PRODUCT, owner Jerry). Its description states only high-level discussion has occurred — no product/design work or development has begun.`,
  `A second task in the same project, "Market What's Good / What to Get widget", is BLOCKED on this build task.`,
  `screens/HomeScreen.jsx is currently a single scrollable stack of rail/section components (e.g. ExperiencesRail) — the concrete integration point for any home-screen placement decision.`,
  `Feature-flag infrastructure already exists in this codebase: lib/featureFlags.js reads a feature_flags table plus per-user feature_flag_overrides.`,
  `Tier/badge progression UI already exists in this codebase (components/BadgeCelebrationModal.jsx, components/TierUpgradeCelebrationModal.jsx) as a reference point if progression mechanics are ever wanted for this widget.`,
  `Candidate content-source tables already exist in the schema: curated_lists, audience_groups, featured_experiences, metro_areas.`,
]

const EXISTING_CONSTRAINTS: readonly string[] = [
  `Decision "widget_marketing_after_build" (recorded, decided by Jerry): "Aggressive onboarding and in-app promotion of What's Good / What to Get begins only after the widget exists." This document does not extrapolate beyond that sequencing statement into any broader marketing strategy.`,
  `Decision "${WIDGET_CORE_MEANING_DECISION.decisionKey}" (recorded, decided by Jerry, 2026-09-01): "${WIDGET_CORE_MEANING_DECISION.decision}"`,
  `Decision "${WIDGET_FIRST_PLATFORM_FORM_DECISION.decisionKey}" (recorded, decided by Jerry, 2026-09-01): "${WIDGET_FIRST_PLATFORM_FORM_DECISION.decision}"`,
  `Decision "${WIDGET_GEOFENCE_STATE_DECISION.decisionKey}" (recorded, decided by Jerry, 2026-09-01): "${WIDGET_GEOFENCE_STATE_DECISION.decision}"`,
  `Decision "${WIDGET_NEARBY_DISCOVERY_DECISION.decisionKey}" (recorded, decided by Jerry, 2026-09-01): "${WIDGET_NEARBY_DISCOVERY_DECISION.decision}"`,
  `Decision "${WIDGET_REFRESH_STABILITY_DECISION.decisionKey}" (recorded, decided by Jerry, 2026-09-01): "${WIDGET_REFRESH_STABILITY_DECISION.decision}"`,
  `Decision "${APP_WIDE_SAVED_EXPERIENCES_DECISION.decisionKey}" (recorded, decided by Jerry, 2026-09-01): "${APP_WIDE_SAVED_EXPERIENCES_DECISION.decision}"`,
  `Decision "${SAVED_ITEMS_LISTS_TAB_DECISION.decisionKey}" (recorded, decided by Jerry, 2026-09-01): "${SAVED_ITEMS_LISTS_TAB_DECISION.decision}"`,
  `Decision "${WHATS_THE_THING_FOREGROUND_PRESENCE_RADIUS_DECISION.decisionKey}" (recorded, decided by Jerry, 2026-09-01): "${WHATS_THE_THING_FOREGROUND_PRESENCE_RADIUS_DECISION.decision}"`,
  `Decision "${WHATS_GOOD_V1_CANDIDATE_POOL_AND_FALLBACK_DECISION.decisionKey}" (recorded, decided by Jerry, 2026-09-01): "${WHATS_GOOD_V1_CANDIDATE_POOL_AND_FALLBACK_DECISION.decision}"`,
  `Decision "${WHATS_GOOD_V1_UNCHECKED_PREFERENCE_DECISION.decisionKey}" (recorded, decided by Jerry, 2026-09-01): "${WHATS_GOOD_V1_UNCHECKED_PREFERENCE_DECISION.decision}"`,
  `Decision "${WHATS_GOOD_V1_EXPOSURE_ROTATION_DECISION.decisionKey}" (recorded, decided by Jerry, 2026-09-01): "${WHATS_GOOD_V1_EXPOSURE_ROTATION_DECISION.decision}"`,
  `Decision "${WHATS_GOOD_V1_MOMENTUM_RANKING_DECISION.decisionKey}" (recorded, decided by Jerry, 2026-09-01): "${WHATS_GOOD_V1_MOMENTUM_RANKING_DECISION.decision}"`,
]

const KNOWN_PRODUCT_INTENT: readonly string[] = [
  `"What's Good / What to Get" is one connected recommendation experience: "What's Good" curates a small, opinionated set of worthwhile places/experiences; "What to Get" surfaces the specific signature item or thing worth checking off once a place is chosen. Intentionally selective, not a broad content rail (Decision Area 1, resolved 2026-09-01).`,
  `The first version ships as an in-app HomeScreen module, not a native OS-level widget; native widgets are deferred until the in-app experience is proven (Decision Area 11, resolved 2026-09-01).`,
  `The Home Rail's #1 item already owns immediate proximity and transforms into a "You're Here / What's the Thing?" state inside its geofence; "What's Good" is a distinct surface for nearby discovery beyond that immediate item, not a duplicate of it (decisions \`${WIDGET_GEOFENCE_STATE_DECISION.decisionKey}\` and \`${WIDGET_NEARBY_DISCOVERY_DECISION.decisionKey}\`, resolved 2026-09-01).`,
  `"What's Good" sources from experiences outside the current five-item Home Rail and rotates over time, rather than statically repeating the rail's own contents (decision \`${WIDGET_NEARBY_DISCOVERY_DECISION.decisionKey}\`, resolved 2026-09-01).`,
  `Experiences can be saved app-wide (a heart means "Save," not "Like"), and saved experiences surface inside the existing Lists tab — a connected but distinct product area from the widget itself, extending beyond the original 16 discovery decision areas (decisions \`${APP_WIDE_SAVED_EXPERIENCES_DECISION.decisionKey}\` and \`${SAVED_ITEMS_LISTS_TAB_DECISION.decisionKey}\`, resolved 2026-09-01).`,
  `The V1 What's Good selection architecture is locked (Decision Area 8, resolved 2026-09-01): a ~15-item nearby candidate pool excluding the current Home Rail 5, strong lifetime unchecked-preference (downranked not excluded), deterministic exposure-based rotation via a dedicated table, and a bounded community-momentum signal that can never override unchecked preference and exposure rotation together. Exact numeric ranking weights remain undecided by design.`,
  `The foreground "You're Here / What's the Thing?" trigger is now a precise, per-item, capped rule — min(geo_radius_m, 150m) — rather than an open threshold, and is explicitly distinct from the larger radius background visit-detection continues to use (decision \`${WHATS_THE_THING_FOREGROUND_PRESENCE_RADIUS_DECISION.decisionKey}\`, resolved 2026-09-01).`,
]

const SUGGESTED_RESEARCH: readonly string[] = [
  'Define What\'s Good candidate/selection/rotation rules (Decision Area 8) against real curated_lists/audience_groups data, honoring the "outside current Home Rail set" constraint.',
  'Define concrete refresh/stability thresholds (Decision Area 5) — what counts as a "meaningful" location/context change, and how long a set stays stable.',
  'Investigate thin/new-market and checkoff-history fallback behavior (Decision Area 7) once selection rules exist to apply them against.',
]

const DECISION_SEQUENCE: readonly string[] = [
  'What\'s Good candidate/selection rules (Decision Area 8, with the Decision Area 3 data-mapping work).',
  'Refresh/stability thresholds (Decision Area 5).',
  'Thin-market/checkoff-history behavior (Decision Area 7).',
  'Personalization and progression/locking mechanics (Decision Areas 4 and 6).',
  'Home-screen placement/prominence (Decision Area 2), platform-specific behavior (Areas 9, 10), analytics (12), feature flags (13), monetization (14).',
  'Onboarding/promotion mechanics and external marketing strategy last (Areas 15, 16) — unchanged, still gated behind the widget existing by the recorded sequencing decision.',
]

function section(heading: string, lines: readonly string[]): string {
  return `## ${heading}\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`
}

/** The exact, deterministic content this handler writes. No runtime generation, no free-form model output — every line here is reviewed code. */
export function buildDiscoveryArtifact(): string {
  const decisionAreasBlock = DECISION_AREAS.map((area, i) => {
    return `### ${i + 1}. ${area.title}\n\nClassification: ${area.classification}\n\n${area.notes}\n`
  }).join('\n')

  return [
    IDENTITY_MARKER,
    `# What's Good / What to Get — Product Discovery Brief`,
    '',
    'Status: discovery only. No product or design decisions have been made in this document. It organizes what is already known, what already constrains the work, and what still needs research or a decision from Jerry before a UX/design specification can be written.',
    '',
    section('Known Facts', KNOWN_FACTS),
    section('Existing Constraints', EXISTING_CONSTRAINTS),
    section('Known Product Intent', KNOWN_PRODUCT_INTENT),
    '## Decision Areas\n',
    decisionAreasBlock,
    section('Suggested Research Work', SUGGESTED_RESEARCH),
    section('Proposed Decision Sequence', DECISION_SEQUENCE),
  ].join('\n')
}

const REQUIRED_TOP_LEVEL_SECTIONS = ['Known Facts', 'Existing Constraints', 'Known Product Intent', 'Decision Areas', 'Suggested Research Work', 'Proposed Decision Sequence']

const VALID_CLASSIFICATIONS: readonly DecisionClassification[] = ['KNOWN', 'RESEARCH_NEEDED', 'JERRY_DECISION', 'TECHNICAL_DISCOVERY']

/**
 * Deterministic, structural verification — never "looks about right".
 * Checks: identity marker present; every required top-level section
 * heading present; every DECISION_AREAS title present as its own
 * subheading with an immediately-following, validly-classified
 * "Classification: X" line; non-empty beyond the headings themselves.
 */
export function verifyDiscoveryArtifact(content: string): { valid: boolean; reasons: string[] } {
  const reasons: string[] = []

  if (!content.includes(IDENTITY_MARKER)) {
    reasons.push('missing identity marker')
  }

  for (const heading of REQUIRED_TOP_LEVEL_SECTIONS) {
    if (!content.includes(`## ${heading}`)) {
      reasons.push(`missing required section: ${heading}`)
    }
  }

  for (const area of DECISION_AREAS) {
    const headingIndex = content.indexOf(`. ${area.title}`)
    if (headingIndex === -1) {
      reasons.push(`missing decision area heading: ${area.title}`)
      continue
    }
    // Bounded to THIS area's own block — up to the next "### " subheading
    // (the next decision area) or the "## Suggested Research Work" section
    // that follows the last one — so a missing/invalid classification on
    // one area can never be masked by a valid one on the next.
    const nextHeadingIndex = content.indexOf('\n### ', headingIndex + 1)
    const nextSectionIndex = content.indexOf('\n## Suggested Research Work', headingIndex + 1)
    const candidates = [nextHeadingIndex, nextSectionIndex].filter((i) => i !== -1)
    const windowEnd = candidates.length > 0 ? Math.min(...candidates) : content.length
    const block = content.slice(headingIndex, windowEnd)
    const classificationMatch = block.match(/Classification:\s*(\S+)/)
    if (!classificationMatch) {
      reasons.push(`missing classification line for decision area: ${area.title}`)
    } else if (!VALID_CLASSIFICATIONS.includes(classificationMatch[1] as DecisionClassification)) {
      reasons.push(`invalid classification "${classificationMatch[1]}" for decision area: ${area.title}`)
    }
  }

  if (content.trim().length < 500) {
    reasons.push('artifact content is suspiciously short — below minimum non-empty threshold')
  }

  return { valid: reasons.length === 0, reasons }
}
