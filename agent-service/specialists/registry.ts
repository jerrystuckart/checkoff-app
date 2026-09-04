// Chief Phase 2C — the specialist registry. Deliberately small (5
// specialists) per the explicit instruction not to create an agent for
// every tiny task — creative/asset production is an invoked capability
// of destination_activation, not its own agent.
//
// A specialist is a ROLE, not a vendor/model. This registry never names
// an AI provider — "capabilities" describe what kind of work/tool
// access the role needs (research, DB read/write, email, documents),
// and whatever executes that role (a Claude session, a future different
// provider, a human even) is an implementation detail outside this
// framework's concern.

import type { SpecialistDefinition, SpecialistKey } from './types'

export const SPECIALIST_REGISTRY: Readonly<Record<SpecialistKey, SpecialistDefinition>> = Object.freeze({
  metro_builder: {
    key: 'metro_builder',
    ownerKey: 'metro_builder',
    name: 'Metro Builder',
    owns: [
      'geography/neighborhood map',
      'category coverage plan',
      'item research coordination',
      'coverage audit (category + geography)',
      'targeted gap-filling',
      'catalog build readiness',
    ],
    capabilities: ['checkoff_db_read', 'checkoff_db_write_staged', 'research_verifier_delegation'],
    canChangeStrategicScope: false,
  },
  research_verifier: {
    key: 'research_verifier',
    ownerKey: 'research_verifier',
    name: 'Research Verifier',
    owns: ['live external research', 'closure checks', 'exact-thing verification', 'address/location evidence', 'contact research'],
    capabilities: ['live_web_research', 'live_browser_research'],
    canChangeStrategicScope: false,
  },
  /**
   * Phase 2D addition — the item-language specialist named in the Phase
   * 2D spec section 2, previously missing from the registry entirely.
   * Owns ONLY the transformation from a research_verifier-verified fact
   * to final CheckOff wording; never discovers or verifies anything
   * itself. See methodologies/checkoff_editor/v1.md.
   */
  checkoff_editor: {
    key: 'checkoff_editor',
    ownerKey: 'checkoff_editor',
    name: 'CheckOff Editor',
    owns: ['final CheckOff item wording', 'editorial voice/style enforcement', 'factual-fidelity check against the researched source'],
    capabilities: ['content_editorial'],
    canChangeStrategicScope: false,
  },
  business_outreach: {
    key: 'business_outreach',
    ownerKey: 'business_outreach',
    name: 'Business Outreach',
    owns: ['contact queue', 'channel choice', 'prior-relationship evidence', 'email/DM/contact-form execution under authority', 'replies', 'confirmation', 'photo', 'cling', 'follow-up'],
    capabilities: ['gmail', 'web_form_research', 'business_outreach_token_system'],
    canChangeStrategicScope: false,
  },
  destination_strategist: {
    key: 'destination_strategist',
    ownerKey: 'destination_strategist',
    name: 'Destination Strategist',
    owns: [
      'discovery (D0)',
      'pre-DVA screening (D1)',
      // NOTE: DVA-1/DVA-2/DAP methodology itself lives in three external
      // Claude Projects (Phase 2C correction, 2026-09-04) — this
      // specialist orchestrates the hand-off (initiate/receive/validate/
      // route), it does not reproduce their question sets.
      'DVA-1/DVA-2/DAP orchestration (initiate stage, receive artifact, validate, route)',
      'pipeline-state decisions (D5)',
    ],
    capabilities: ['open_brain_read', 'live_web_research', 'destination_data_read'],
    canChangeStrategicScope: false,
  },
  /**
   * Phase 2C correction (2026-09-04): the ongoing HUMAN relationship
   * after a destination passes evaluation was missing from the original
   * Phase 2C design — this specialist owns it. Narrower than
   * destination_activation was originally scoped: relationship_manager
   * owns the day-to-day contact/reply/follow-up/meeting lifecycle;
   * destination_activation keeps proposal/pitch coordination and
   * activation readiness once a relationship is far enough along.
   */
  destination_relationship_manager: {
    key: 'destination_relationship_manager',
    ownerKey: 'destination_relationship_manager',
    name: 'Destination Relationship Manager',
    owns: [
      'identify/contact the best first person',
      'channel selection',
      'personalized outreach drafting',
      'reply management',
      'follow-up timing',
      'meeting request/coordination',
      'stakeholder sentiment tracking',
      'champion/blocker identification',
      'introduction provenance ("who introduced whom")',
      'relationship momentum',
      'next-requested-material coordination',
      'escalation of negotiations/important replies to Jerry',
    ],
    capabilities: ['gmail', 'google_contacts', 'google_calendar', 'checkoff_operational_state'],
    canChangeStrategicScope: false,
  },
  destination_activation: {
    key: 'destination_activation',
    ownerKey: 'destination_activation',
    name: 'Destination Activation',
    owns: [
      'proposal/pitch coordination (once relationship_manager has qualified the relationship)',
      'sales-enablement asset production (invoked capability, not a separate agent)',
      'activation readiness (D15-D16 handoff)',
    ],
    capabilities: ['documents_presentation_assets', 'checkoff_operational_state'],
    canChangeStrategicScope: false,
  },
})

export function getSpecialist(key: SpecialistKey): SpecialistDefinition {
  return SPECIALIST_REGISTRY[key]
}

export function listSpecialists(): SpecialistDefinition[] {
  return Object.values(SPECIALIST_REGISTRY)
}
