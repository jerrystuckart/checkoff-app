// Chief Phase 2C — Specialist Agent Architecture. Types only, no I/O
// (mirrors the rest of this codebase's type/logic-vs-wiring split).
//
// A "specialist" is a ROLE + CAPABILITY SET, never a specific AI
// vendor/model — see registry.ts's own doc. Chief delegates a bounded
// unit of work to a specialist by creating an agent.tasks row owned by
// that specialist (existing Phase 0D primitive, no new write path); the
// specialist's execution (however it actually runs — this framework
// does not assume or require any particular runtime) reports back
// through the ONE standard result envelope defined here. Chief validates
// that envelope before ever advancing a playbook stage — a specialist's
// own claim of "done" is never itself the evidence (same discipline
// already used in actionExecution.ts's verifyCompletion() requirement).

export type SpecialistKey =
  | 'metro_builder'
  | 'research_verifier'
  | 'checkoff_editor'
  | 'business_outreach'
  | 'destination_strategist'
  | 'destination_relationship_manager'
  | 'destination_activation'

export interface SpecialistDefinition {
  key: SpecialistKey
  ownerKey: string // agent.owners.owner_key this specialist's tasks are assigned to
  name: string
  /** What this specialist owns — documentation, not enforced by types (enforced by which playbook stages route to it). */
  owns: string[]
  /** Capabilities/tools this role needs — see capabilityRouting.ts. Never a vendor/model name. */
  capabilities: string[]
  /** May this specialist independently change strategic scope or public/commercial commitments? Always false — enforced by standingAuthority.ts, restated here for readability. */
  canChangeStrategicScope: false
}

// ---------------------------------------------------------------------------
// Delegation — Chief -> specialist
// ---------------------------------------------------------------------------

export interface DelegationRequest {
  specialist: SpecialistKey
  playbookKey: string
  stage: string
  objective: string
  /** Structured inputs the specialist needs — never free prose the specialist has to re-derive. */
  inputs: Record<string, unknown>
  /** What evidence Chief requires back before this delegation can be accepted — checked by validateResultEnvelope. */
  requiredEvidenceKeys: string[]
  /**
   * Which versioned methodology (agent-service/specialists/methodologies/<id>/<version>.md) this
   * delegation executes — Phase 2D requirement: every specialist execution runs a versioned
   * CheckOff methodology, never an ad hoc prompt invented at delegation time. Checked by
   * validateMethodologyReference in executor.ts.
   */
  methodologyId: string
  methodologyVersion: string
}

// ---------------------------------------------------------------------------
// Handoff — specialist -> Chief. Every execution returns exactly this
// shape (Phase 2C spec section 10) — never an ad hoc result object.
// ---------------------------------------------------------------------------

export interface SpecialistResultEnvelope {
  taskId: string
  objective: string
  actionsPerformed: string[]
  /** Keyed by the requiredEvidenceKeys from the DelegationRequest — Chief checks these are present, never guesses they were gathered. */
  evidence: Record<string, unknown>
  /** File paths, URLs, or artifact ids produced — never inlined raw content here. */
  artifacts: string[]
  confidence: 'LOW' | 'MEDIUM' | 'HIGH'
  blockers: string[]
  discoveredFollowUpWork: string[]
  recommendedNextAction: string
  jerryRequired: boolean
  /** Why Jerry is required, when jerryRequired is true — never left implicit. */
  jerryReason: string | null
  /** Restated from the originating DelegationRequest — Chief validates this matches before ever accepting the envelope (see executor.ts's validateExecutionIdentity). */
  methodologyId: string
  methodologyVersion: string
  /**
   * Chief Phase 2F — which provider actually produced this result (e.g.
   * 'anthropic', 'openai'), when the executor is a REMOTE_AI_EXECUTOR
   * trying multiple configured providers with fallback (spec section
   * 19: "Record which provider actually produced the accepted result").
   * Optional and null for every executor type that isn't provider-based
   * (MANUAL_EXECUTOR, the deterministic TestExecutor) — never required,
   * so no existing envelope construction breaks.
   */
  providerKey?: string | null
  /**
   * Production-integrity pass — real per-execution token usage and
   * estimated USD cost, when the provider adapter reported it. null
   * whenever usage data is unexpectedly absent (a provider response
   * that omitted its usage field, a non-REMOTE_AI executor) — this NEVER
   * blocks the execution from completing; it just means cost tracking
   * has a genuine gap for that one call, recorded honestly rather than
   * guessed as $0. See usagePricing.ts / usageAggregation.ts.
   */
  providerUsage?: ProviderUsageInfo | null
}

export interface ProviderUsageInfo {
  provider: string
  /** The exact model id actually used for this call (post-routing) — never the routing target's name, the real one. */
  model: string | null
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  /** Estimated from usagePricing.ts's versioned table — null when the model isn't in the table or token counts are missing, never a guessed $0. */
  costUsd: number | null
  /** Which USAGE_PRICING_TABLE_VERSION produced costUsd — lets a stored record be understood even after the table is later updated. */
  pricingVersion: string | null
  /** False whenever the provider's response didn't include usable usage data — the execution still completes; this just marks the gap. */
  available: boolean
}

export interface EnvelopeValidationResult {
  valid: boolean
  missingEvidenceKeys: string[]
  reasons: string[]
}
