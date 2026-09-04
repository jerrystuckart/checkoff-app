<!-- checkoff-chief:task-id=3c677529-9c53-4d83-94b5-502a71636c26 source-ref=whats-good-widget-build -->
# What's Good / What to Get — Product Discovery Brief

Status: discovery only. No product or design decisions have been made in this document. It organizes what is already known, what already constrains the work, and what still needs research or a decision from Jerry before a UX/design specification can be written.

## Known Facts

- Task 3c677529-9c53-4d83-94b5-502a71636c26 ("Build What's Good / What to Get widget", source ref "whats-good-widget-build") is READY under the "whats_good_widget" project (type PRODUCT, owner Jerry). Its description states only high-level discussion has occurred — no product/design work or development has begun.
- A second task in the same project, "Market What's Good / What to Get widget", is BLOCKED on this build task.
- screens/HomeScreen.jsx is currently a single scrollable stack of rail/section components (e.g. ExperiencesRail) — the concrete integration point for any home-screen placement decision.
- Feature-flag infrastructure already exists in this codebase: lib/featureFlags.js reads a feature_flags table plus per-user feature_flag_overrides.
- Tier/badge progression UI already exists in this codebase (components/BadgeCelebrationModal.jsx, components/TierUpgradeCelebrationModal.jsx) as a reference point if progression mechanics are ever wanted for this widget.
- Candidate content-source tables already exist in the schema: curated_lists, audience_groups, featured_experiences, metro_areas.

## Existing Constraints

- Decision "widget_marketing_after_build" (recorded, decided by Jerry): "Aggressive onboarding and in-app promotion of What's Good / What to Get begins only after the widget exists." This document does not extrapolate beyond that sequencing statement into any broader marketing strategy.
- Decision "widget_core_meaning_definition" (recorded, decided by Jerry, 2026-09-01): ""What's Good / What to Get" is one connected recommendation experience. "What's Good" helps users choose a small, opinionated set of worthwhile places or experiences. "What to Get" tells them the specific signature item, experience, or thing worth checking off once they choose. The feature should stay intentionally selective rather than becoming another broad content rail."
- Decision "widget_first_platform_form" (recorded, decided by Jerry, 2026-09-01): "The first version of "What's Good / What to Get" will be an in-app HomeScreen module. Native iPhone and Android home-screen widgets are deferred until the in-app experience is proven and may become a later distribution/engagement extension."
- Decision "widget_whats_the_thing_geofence_state" (recorded, decided by Jerry, 2026-09-01): "When the #1 Home Rail item is inside its geofence, the card changes into a more prominent "You're Here / What's the Thing?" state. It should clearly stand out through hierarchy, size, motion, or emphasis without flashing, overwhelming, or visually dominating the screen."
- Decision "widget_whats_good_nearby_discovery" (recorded, decided by Jerry, 2026-09-01): ""What's Good" is nearby discovery beyond the current five-item Home Rail. Its recommendations should come from experiences outside the current Home Rail set and rotate over time so the surface does not become stagnant."
- Decision "widget_location_refresh_stability" (recorded, decided by Jerry, 2026-09-01): "Home Rail and What's Good should refresh when the user's location or context changes meaningfully, not continuously every few seconds and not merely because the app briefly backgrounds and resumes. Recommendation sets should remain stable long enough for a user to act on what they saw."
- Decision "app_wide_saved_experiences" (recorded, decided by Jerry, 2026-09-01): "Experiences can be saved app-wide with a heart control. The heart means "Save," not "Like," so users can retain experiences they want to revisit later even when dynamic recommendation surfaces change."
- Decision "saved_items_live_in_lists_tab" (recorded, decided by Jerry, 2026-09-01): "Saved experiences will live in the existing Lists tab alongside user-created lists. Saved should give the Lists tab immediate utility for users who have not created custom lists while continuing to support heavier list users."
- Decision "whats_the_thing_foreground_presence_radius" (recorded, decided by Jerry, 2026-09-01): "The foreground "You're Here / What's the Thing?" state uses each item's existing geo_radius_m, capped at 150 meters. The foreground presence radius is therefore min(geo_radius_m, 150m), with NULL/default oversized radii also capped at 150m. Background visit-detection continues to use the item's full existing geo_radius_m and remains a separate concept."
- Decision "whats_good_v1_candidate_pool_and_fallback" (recorded, decided by Jerry, 2026-09-01): "What's Good displays 3 picks selected from a nearby candidate pool of approximately 15 experiences. The current Home Rail 5 are always excluded from the pool. If the candidate pool is insufficient, expand geographically using existing CheckOff proximity/tiering mechanics; if still insufficient, use existing Universal items as the final fallback."
- Decision "whats_good_v1_unchecked_preference" (recorded, decided by Jerry, 2026-09-01): "Experiences the current user has never checked off (lifetime, not season-scoped) receive a strong preference in What's Good ranking. Previously checked-off experiences are downranked, not hard-excluded, so highly active users who have checked off most nearby items never reach a dead end."
- Decision "whats_good_v1_exposure_rotation" (recorded, decided by Jerry, 2026-09-01): "What's Good rotates across genuine sessions and revisits rather than reshuffling continuously. Recently shown experiences receive a deterministic exposure penalty (never pure random selection); older exposures naturally become eligible again as the unseen/recently-unseen pool is exhausted. A short app interruption or background/foreground cycle does not change the 3 displayed items. Exposure state is tracked in a dedicated lightweight table (not folded into interaction_events), storing at minimum user, item, and last-shown timestamp."
- Decision "whats_good_v1_momentum_ranking" (recorded, decided by Jerry, 2026-09-01): "Recent genuine community checkoff activity contributes a bounded positive ranking signal ("momentum") to What's Good. Momentum is based on distinct recent users, not raw checkoff count, and only begins once at least 3 distinct users have contributed within the active momentum window. The momentum window is a rolling 30 days for V1, with newer activity weighted more than older activity within that window. Verification-method weighting applies lightly, so higher-confidence checkoffs contribute more than legacy/admin-style activity. A small capped "rising" bonus applies when an experience's recent unique-user activity is increasing versus the preceding comparable period. Momentum is capped and can never become a popularity leaderboard: it may nudge ranking, but must never overcome both discovery freshness (unchecked preference) and rotation freshness (recent-exposure penalty) at the same time — an already-checked-off, recently-shown item must never be boosted by momentum above a never-checked-off, meaningfully-less-recently-exposed item. Paid/sponsored placement remains entirely separate from this organic ranking signal. Exact numeric weights are implementation-tunable, not decided here."

## Known Product Intent

- "What's Good / What to Get" is one connected recommendation experience: "What's Good" curates a small, opinionated set of worthwhile places/experiences; "What to Get" surfaces the specific signature item or thing worth checking off once a place is chosen. Intentionally selective, not a broad content rail (Decision Area 1, resolved 2026-09-01).
- The first version ships as an in-app HomeScreen module, not a native OS-level widget; native widgets are deferred until the in-app experience is proven (Decision Area 11, resolved 2026-09-01).
- The Home Rail's #1 item already owns immediate proximity and transforms into a "You're Here / What's the Thing?" state inside its geofence; "What's Good" is a distinct surface for nearby discovery beyond that immediate item, not a duplicate of it (decisions `widget_whats_the_thing_geofence_state` and `widget_whats_good_nearby_discovery`, resolved 2026-09-01).
- "What's Good" sources from experiences outside the current five-item Home Rail and rotates over time, rather than statically repeating the rail's own contents (decision `widget_whats_good_nearby_discovery`, resolved 2026-09-01).
- Experiences can be saved app-wide (a heart means "Save," not "Like"), and saved experiences surface inside the existing Lists tab — a connected but distinct product area from the widget itself, extending beyond the original 16 discovery decision areas (decisions `app_wide_saved_experiences` and `saved_items_live_in_lists_tab`, resolved 2026-09-01).
- The V1 What's Good selection architecture is locked (Decision Area 8, resolved 2026-09-01): a ~15-item nearby candidate pool excluding the current Home Rail 5, strong lifetime unchecked-preference (downranked not excluded), deterministic exposure-based rotation via a dedicated table, and a bounded community-momentum signal that can never override unchecked preference and exposure rotation together. Exact numeric ranking weights remain undecided by design.
- The foreground "You're Here / What's the Thing?" trigger is now a precise, per-item, capped rule — min(geo_radius_m, 150m) — rather than an open threshold, and is explicitly distinct from the larger radius background visit-detection continues to use (decision `whats_the_thing_foreground_presence_radius`, resolved 2026-09-01).

## Decision Areas

### 1. What "What's Good / What to Get" means to a user

Classification: KNOWN

Resolved by Jerry decision `widget_core_meaning_definition` (2026-09-01): "What's Good / What to Get" is one connected recommendation experience. "What's Good" helps users choose a small, opinionated set of worthwhile places or experiences. "What to Get" tells them the specific signature item, experience, or thing worth checking off once they choose. The feature should stay intentionally selective rather than becoming another broad content rail.

### 2. Home-screen placement and prominence

Classification: JERRY_DECISION

HomeScreen.jsx is currently a scrollable stack of rail/section components (see ExperiencesRail). Placement could be a new top-of-screen section, a rail alongside the existing nearby/themed rails, or a persistent header module — each has different prominence and different displacement cost against existing home-screen content. Decision `widget_whats_the_thing_geofence_state` (2026-09-01) clarifies that Home Rail already owns the immediate-proximity slot, which narrows but does not resolve where the separate What's Good module itself sits on HomeScreen.

### 3. What content/data feeds it

Classification: TECHNICAL_DISCOVERY

Candidate sources already exist in the schema (curated_lists, audience_groups, featured_experiences, metro_areas — see prior admin-tool work). Needs a concrete mapping exercise against those tables before a UX spec can reference real data shapes; not yet done.

### 4. Personalization vs. market-wide recommendations

Classification: JERRY_DECISION

Whether the widget shows the same content to everyone in a market or is personalized per user (and by what signal) is undecided.

### 5. Refresh/freshness behavior

Classification: JERRY_DECISION

Directional principle now known (decision `widget_location_refresh_stability`, 2026-09-01): refresh on meaningful location/context change, not continuous polling, not on mere background/resume; recommendation sets stay stable long enough to act on. Still undecided: the specific "meaningful change" threshold and minimum stability duration — the next scheduled decision (see Proposed Decision Sequence).

### 6. Locking/unlocking or progression mechanics, if any

Classification: JERRY_DECISION

The app already has tier/badge progression mechanics elsewhere (BadgeCelebrationModal, TierUpgradeCelebrationModal) — undecided whether this widget hooks into that system or stays fully ungated.

### 7. Behavior in thin/new markets

Classification: JERRY_DECISION

Metro-launch work elsewhere in this repo shows content coverage varies significantly by market. An empty or sparse widget in a new/thin market needs an explicit fallback decision, not silent emptiness.

### 8. Business/list/item distribution logic

Classification: KNOWN

Resolved by four Jerry decisions (2026-09-01): `whats_good_v1_candidate_pool_and_fallback` (pool of ~15, Home Rail-5 exclusion, geographic expansion then Universal fallback), `whats_good_v1_unchecked_preference` (lifetime unchecked preference, downranked not excluded), `whats_good_v1_exposure_rotation` (deterministic exposure-based rotation via a dedicated table, no pure randomness), and `whats_good_v1_momentum_ranking` (bounded community-momentum ranking signal that can never override unchecked preference and exposure rotation together). Exact numeric score weights remain implementation-tunable and undecided — see each decision's own text.

### 9. iPhone-specific behavior

Classification: TECHNICAL_DISCOVERY

Not yet investigated — depends heavily on the OS-widget-vs-in-app-module decision below.

### 10. Android-specific behavior

Classification: TECHNICAL_DISCOVERY

Not yet investigated — same dependency as iPhone-specific behavior above.

### 11. OS-level home-screen widget vs. in-app home-screen module

Classification: KNOWN

Resolved by Jerry decision `widget_first_platform_form` (2026-09-01): The first version of "What's Good / What to Get" will be an in-app HomeScreen module. Native iPhone and Android home-screen widgets are deferred until the in-app experience is proven and may become a later distribution/engagement extension.

### 12. Analytics and success metrics

Classification: JERRY_DECISION

No success definition (engagement, conversion to a check-in, retention lift, or something else) has been proposed yet.

### 13. Rollout/feature flags

Classification: JERRY_DECISION

Feature-flag infrastructure already exists (lib/featureFlags.js, feature_flags / feature_flag_overrides tables, per-user overrides) and could gate this rollout — whether and how to use it here is a decision, not a technical blocker.

### 14. Advertising/monetization implications, if any

Classification: JERRY_DECISION

Whether featured/sponsored placement is ever part of this surface is completely open and not assumed here.

### 15. Onboarding and in-app promotion after the feature exists

Classification: JERRY_DECISION

The SEQUENCING is already decided (see Existing Constraints below) — this area is about the specific onboarding/promotion mechanics once that gate opens, which are not yet defined.

### 16. External marketing/launch strategy after build

Classification: JERRY_DECISION

Same sequencing constraint applies. No strategy beyond "after the widget exists" has been discussed, and none is assumed here.

### 17. Home Rail geofence-triggered "You're Here / What's the Thing?" state

Classification: KNOWN

Resolved by Jerry decision `widget_whats_the_thing_geofence_state` (2026-09-01): When the #1 Home Rail item is inside its geofence, the card changes into a more prominent "You're Here / What's the Thing?" state. It should clearly stand out through hierarchy, size, motion, or emphasis without flashing, overwhelming, or visually dominating the screen. Exact visual/motion execution remains a later UX-design task, not an unresolved product decision — the principle itself is decided. The exact foreground trigger is min(geo_radius_m, 150m) — see decision `whats_the_thing_foreground_presence_radius` (2026-09-01) — kept distinct from the larger radius background visit-detection continues to use.

### 18. App-wide Saved/favoriting mechanism

Classification: KNOWN

Resolved by Jerry decision `app_wide_saved_experiences` (2026-09-01): Experiences can be saved app-wide with a heart control. The heart means "Save," not "Like," so users can retain experiences they want to revisit later even when dynamic recommendation surfaces change. A new product area outside the original 16 discovery decision areas — connected to but distinct from the What's Good / What to Get widget itself.

### 19. Saved-items surface placement

Classification: KNOWN

Resolved by Jerry decision `saved_items_live_in_lists_tab` (2026-09-01): Saved experiences will live in the existing Lists tab alongside user-created lists. Saved should give the Lists tab immediate utility for users who have not created custom lists while continuing to support heavier list users.

## Suggested Research Work

- Define What's Good candidate/selection/rotation rules (Decision Area 8) against real curated_lists/audience_groups data, honoring the "outside current Home Rail set" constraint.
- Define concrete refresh/stability thresholds (Decision Area 5) — what counts as a "meaningful" location/context change, and how long a set stays stable.
- Investigate thin/new-market and checkoff-history fallback behavior (Decision Area 7) once selection rules exist to apply them against.

## Proposed Decision Sequence

- What's Good candidate/selection rules (Decision Area 8, with the Decision Area 3 data-mapping work).
- Refresh/stability thresholds (Decision Area 5).
- Thin-market/checkoff-history behavior (Decision Area 7).
- Personalization and progression/locking mechanics (Decision Areas 4 and 6).
- Home-screen placement/prominence (Decision Area 2), platform-specific behavior (Areas 9, 10), analytics (12), feature flags (13), monetization (14).
- Onboarding/promotion mechanics and external marketing strategy last (Areas 15, 16) — unchanged, still gated behind the widget existing by the recorded sequencing decision.
