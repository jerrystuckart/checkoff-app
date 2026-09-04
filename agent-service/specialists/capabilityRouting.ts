// Chief Phase 2C — capability/tool routing. Which specialist needs
// which KIND of capability — never a vendor/model, never a specific
// tool-call binding (that's an execution-runtime concern outside this
// framework).

import type { SpecialistKey } from './types'
import { SPECIALIST_REGISTRY } from './registry'

export type Capability =
  | 'checkoff_db_read'
  | 'checkoff_db_write_staged'
  | 'research_verifier_delegation'
  | 'live_web_research'
  | 'live_browser_research'
  | 'gmail'
  | 'web_form_research'
  | 'business_outreach_token_system'
  | 'open_brain_read'
  | 'destination_data_read'
  | 'documents_presentation_assets'
  | 'checkoff_operational_state'
  | 'content_editorial'
  /**
   * Chief Phase 2E — outbound relationship execution PREP (spec section
   * 11). These are granular capability DECLARATIONS only: no Gmail/
   * Calendar integration exists anywhere in this codebase yet (see
   * DESTINATION_EXECUTOR_GAPS's 'gmail_calendar_execution' entry).
   * Splitting the old generic 'gmail'/'google_calendar' entries into
   * read/send and freebusy/create lets a future capability-routing check
   * distinguish "read a reply" (plausibly AUTO once wired) from "send an
   * email" or "create a calendar event" (both already APPROVAL_REQUIRED
   * in standingAuthority.ts, unconditionally, with no exception path) —
   * the authority level itself is UNCHANGED by this split.
   */
  | 'gmail_read'
  | 'gmail_send'
  | 'google_contacts'
  | 'google_calendar_freebusy'
  | 'google_calendar_event_create'

export function capabilitiesFor(specialist: SpecialistKey): string[] {
  return SPECIALIST_REGISTRY[specialist].capabilities
}

export function specialistsWithCapability(capability: Capability): SpecialistKey[] {
  return (Object.keys(SPECIALIST_REGISTRY) as SpecialistKey[]).filter((key) => SPECIALIST_REGISTRY[key].capabilities.includes(capability))
}

/**
 * research_verifier is the ONLY specialist that may treat live external
 * research as authoritative-for-now data — every other specialist that
 * needs "is this still open / is this still true" evidence must
 * delegate to it rather than trusting a static DB row or an Open Brain
 * thought as current. Enforced here as a lookup other modules can
 * consult; not a runtime guard (no execution runtime exists in this
 * framework to intercept a violation of it).
 */
export function requiresLiveVerification(evidenceKind: 'closure_status' | 'contact_currency' | 'exact_thing_still_offered'): SpecialistKey {
  void evidenceKind
  return 'research_verifier'
}
