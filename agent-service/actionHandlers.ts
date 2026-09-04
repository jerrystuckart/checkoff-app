// Phase 1D — the trusted action-handler registry. THIS is the capability
// boundary, not the planning/reasoning layer. Every ActionHandler owns its
// own ActionType and ActionPolicy permanently, as immutable properties of
// the handler object itself, defined here in reviewed code. Nothing in
// this codebase can construct an ActionPlan except a handler's own plan()
// method (so a plan's `actionType` always genuinely matches the handler
// that produced it), and nothing consults policy from anywhere except
// ACTION_REGISTRY (so a plan's `policy` field, copied from the handler for
// display purposes, is never re-read as the authority by the execution
// loop — actionExecution.ts looks the handler up by actionType and reads
// ITS `.policy`, never the plan's).
//
// SELECTION IS DETERMINISTIC, NEVER A GUESS: selectApplicablePlan() below
// calls every registered handler's plan(task) and only returns a result
// when EXACTLY ONE handler claims the task. Zero matches -> no plan (the
// task simply isn't in scope for any registered capability yet — no
// autonomous OR approval-required action is proposed, and that is a
// correct, honest outcome, not a gap to paper over). More than one match
// -> also no plan (ambiguous — never silently pick one).
//
// STRUCTURED SELECTION SIGNAL: handlers below select by task.projectType
// (a real, Phase 0A-designed structured field, duplicated onto TaskSummary
// directly in Phase 1D — see types.ts) plus
// task.contact (whether a contact is linked) — never by parsing
// task.title/description/nextAction text. This is coarser than a perfect
// per-task classifier would be, but it is honest about what it is: if a
// task doesn't fit cleanly (e.g. a PRODUCT-project task WITH a linked
// contact), the internal handler's own applicability check below
// deliberately declines it rather than guessing.
//
// DELIBERATELY SMALL REGISTRY: exactly two handlers for Phase 1D —
// internal_design_definition (AUTO_ALLOWED, has an execute() — the "one
// safe internal capability" called for) and outbound_communication
// (APPROVAL_REQUIRED, plan() only, no execute() at all — structurally
// cannot be dispatched by the execution loop regardless of anything else,
// since actionExecution.ts refuses any handler whose policy isn't
// AUTO_ALLOWED before ever calling execute()). No contact_record_create
// handler — see this module's tail comment on the createContact() gap.

import type { TaskSummary } from './types'
import type { ActionType, ActionPolicy, ActionPlan, ActionExpectedEffect } from './actionPolicyTypes'
import { writeArtifact, readArtifact, type ArtifactWriter } from './artifactWriter'
import { ARTIFACT_FILENAME, ARTIFACT_PATH, buildDiscoveryArtifact, verifyDiscoveryArtifact } from './whatsGoodWidgetDiscoveryArtifact'

export type ActionExecuteOutcome =
  | { outcome: 'CLAIMED_ONLY'; note: string }
  | {
      outcome: 'OPERATIONAL_CONDITION'
      /** Deliberately excludes DONE and CANCELED — a handler can never request either through this path. See actionExecution.ts. */
      nonterminalStatus: 'WAITING' | 'BLOCKED' | 'NEEDS_JERRY'
      note: string
      blockerNote?: string
      nextCheckAt?: Date
      jerryRequest?: string
    }
  | { outcome: 'READY_TO_VERIFY'; note: string }
  /**
   * Phase 1E. A bounded, deterministically-verified artifact was created
   * (or already existed with correct content) and the task's plan should
   * be advanced — but the task itself is NOT done. The execution loop
   * routes this to updateTaskPlan(), never to a status transition beyond
   * the claim it already made. Still deliberately excludes DONE/CANCELED,
   * same as OPERATIONAL_CONDITION above.
   */
  | { outcome: 'CLAIMED_WITH_PLAN_UPDATE'; note: string; nextAction: string }

export interface ActionHandler {
  readonly actionType: ActionType
  readonly policy: ActionPolicy
  readonly expectedEffect: ActionExpectedEffect
  /** Deterministic. Returns null if this handler does not apply to this task — never guesses, never inspects free-text fields. */
  plan(task: TaskSummary): Promise<ActionPlan | null>
  /**
   * Only ever invoked by actionExecution.ts, and only for AUTO_ALLOWED
   * handlers, after fresh state re-validation. Absent entirely for
   * APPROVAL_REQUIRED/HUMAN_ONLY handlers (see outboundCommunicationHandler
   * below) — there is no execute function to even accidentally call.
   */
  execute?(task: TaskSummary): Promise<ActionExecuteOutcome>
  /**
   * Structured, independent completion proof for THIS handler's own
   * literal acceptance condition — never "a transition happened, so it
   * must be done." If absent, this handler can never autonomously reach
   * DONE; actionExecution.ts enforces this (throws if a handler reports
   * READY_TO_VERIFY without defining this).
   */
  verifyCompletion?(task: TaskSummary): Promise<boolean>
}

const PRODUCT_LIKE_PROJECT_TYPES = new Set(['PRODUCT', 'INTERNAL'])
const RELATIONSHIP_PROJECT_TYPES = new Set(['DESTINATION_HUB', 'METRO'])

export const internalDesignDefinitionHandler: ActionHandler = {
  actionType: 'internal_design_definition',
  policy: 'AUTO_ALLOWED',
  expectedEffect: 'internal_reversible',

  async plan(task) {
    if (task.status !== 'READY') return null
    if (!task.projectType || !PRODUCT_LIKE_PROJECT_TYPES.has(task.projectType)) return null
    if (task.contact !== null) return null // a linked contact is structured evidence of an external touchpoint — decline rather than guess
    if (task.blockedBy !== null) return null

    return {
      taskId: task.id,
      actionType: 'internal_design_definition',
      description: `Begin internal research/design-definition work for "${task.title}".`,
      reason: `Project type ${task.projectType} indicates internal product/engineering work, and no external contact is linked to this task.`,
      expectedEffect: 'internal_reversible',
      policy: 'AUTO_ALLOWED',
    }
  },

  async execute(task) {
    // Delegates to the injectable-writer implementation below with NO
    // override — this is the real, unchanged production path, always
    // bound to the real docs/whats-good-widget/ writer. See
    // performInternalDesignDefinitionExecution's own doc for why it takes
    // a writer parameter at all: it exists purely so tests can inject a
    // writer bound to a temporary directory instead of touching the live
    // artifact — this call site never does that.
    return performInternalDesignDefinitionExecution(task)
  },
  // No verifyCompletion — this handler can never autonomously reach DONE,
  // structurally, not just by convention. Writing one discovery brief is
  // not evidence the "Build widget" task is finished.
}

/**
 * The actual body of internalDesignDefinitionHandler.execute(), factored
 * out ONLY so tests can inject an ArtifactWriter bound to a temporary
 * directory (via createArtifactWriterForTesting) instead of the real
 * production one. The real handler above always calls this with no
 * `writer` argument, so it always uses the production
 * writeArtifact/readArtifact bound to docs/whats-good-widget/ — this
 * function's existence changes nothing about the live executor's
 * behavior.
 *
 * Writes and deterministically verifies the What's Good / What to Get
 * widget's product-discovery brief (see whatsGoodWidgetDiscoveryArtifact.ts
 * for the fixed, reviewed content; this handler contains no product prose
 * of its own). Claiming READY -> IN_PROGRESS already happened in
 * actionExecution.ts before this was called.
 *
 * The content is NOT generated at runtime by an unconstrained model call
 * — there is no such call anywhere in this pipeline. It is a fixed
 * constant authored and code-reviewed as part of this handler, written
 * via the bounded artifactWriter (hardened path containment) and then
 * re-read and structurally re-verified — never trusted just because the
 * write didn't throw.
 *
 * Even on success this NEVER reports READY_TO_VERIFY or DONE: this
 * handler has no verifyCompletion() and produces one discovery artifact,
 * not a finished "Build widget" task. See actionExecution.ts's
 * CLAIMED_WITH_PLAN_UPDATE handling — the plan update is the only further
 * effect.
 */
export async function performInternalDesignDefinitionExecution(
  task: TaskSummary,
  writer: Pick<ArtifactWriter, 'writeArtifact' | 'readArtifact'> = { writeArtifact, readArtifact }
): Promise<ActionExecuteOutcome> {
  try {
    const content = buildDiscoveryArtifact()
    writer.writeArtifact(ARTIFACT_FILENAME, content)
  } catch (err) {
    return {
      outcome: 'OPERATIONAL_CONDITION',
      nonterminalStatus: 'NEEDS_JERRY',
      note: 'Attempting to write the product-discovery artifact failed.',
      jerryRequest: `writeArtifact threw while creating ${ARTIFACT_PATH}: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const written = writer.readArtifact(ARTIFACT_FILENAME)
  const verification = written === null ? { valid: false, reasons: ['artifact does not exist after write'] } : verifyDiscoveryArtifact(written)

  if (!verification.valid) {
    return {
      outcome: 'OPERATIONAL_CONDITION',
      nonterminalStatus: 'NEEDS_JERRY',
      note: 'The product-discovery artifact was written but failed deterministic verification.',
      jerryRequest: `Verification of ${ARTIFACT_PATH} failed: ${verification.reasons.join('; ')}`,
    }
  }

  return {
    outcome: 'CLAIMED_WITH_PLAN_UPDATE',
    note: `Product discovery brief created and verified at ${ARTIFACT_PATH}.`,
    nextAction: 'Product discovery brief created. Next: research and resolve the highest-priority widget product decisions before producing the UX/design specification.',
  }
}

/**
 * Plan-only. No execute() at all — there is no method for
 * actionExecution.ts to even accidentally invoke, on top of it already
 * refusing any non-AUTO_ALLOWED handler before dispatch. Chief may
 * research/plan outreach; sending is a permanently separate, human-gated
 * action outside this handler's (or any current handler's) scope.
 */
export const outboundCommunicationHandler: ActionHandler = {
  actionType: 'outbound_communication',
  policy: 'APPROVAL_REQUIRED',
  expectedEffect: 'external',

  async plan(task) {
    if (task.status !== 'READY') return null
    if (!task.projectType || !RELATIONSHIP_PROJECT_TYPES.has(task.projectType)) return null

    const contactNote = task.contact ? '' : ' No contact record is currently linked — one would need to be created before any message could be sent.'

    return {
      taskId: task.id,
      actionType: 'outbound_communication',
      description: `Research and prepare outreach for "${task.title}".${contactNote}`,
      reason: `Project type ${task.projectType} indicates external relationship/outreach work.`,
      expectedEffect: 'external',
      policy: 'APPROVAL_REQUIRED',
    }
  },
}

/**
 * Deliberately small — see this module's header doc. Order does not
 * imply priority; selectApplicablePlan() requires an EXACT single match
 * regardless of position.
 */
export const ACTION_REGISTRY: readonly ActionHandler[] = [internalDesignDefinitionHandler, outboundCommunicationHandler]

/**
 * The ONLY way a plan gets produced. Tries every registered handler's own
 * plan() and returns a result only when exactly one applies — see this
 * module's header doc for the zero/many-matches behavior. The reasoning
 * layer calls this; it can request "plan this task" but cannot choose,
 * construct, or relabel which handler/actionType answers.
 */
export async function selectApplicablePlan(task: TaskSummary, registry: readonly ActionHandler[] = ACTION_REGISTRY): Promise<ActionPlan | null> {
  const results = await Promise.all(registry.map((h) => h.plan(task)))
  const matches = results.filter((p): p is ActionPlan => p !== null)
  if (matches.length !== 1) return null
  return matches[0]
}

export function findHandler(actionType: ActionType, registry: readonly ActionHandler[] = ACTION_REGISTRY): ActionHandler | undefined {
  return registry.find((h) => h.actionType === actionType)
}

// ---------------------------------------------------------------------------
// contact_record_create — DELIBERATELY UNREGISTERED. Verified during Phase
// 1D implementation: agent_service already has GRANT SELECT, INSERT,
// UPDATE ON agent.contacts (Phase 0A) — the DATABASE privilege exists —
// but no createContact()-equivalent function exists anywhere in
// mutations.ts or agent-service/index.ts. Per explicit Phase 1D
// instruction: do not quietly add contact_record_create execution just
// because the table happens to be writable. A handler for this ActionType
// would need a narrow, reviewed mutation (mirroring createTask()'s shape:
// column-scoped fields, actor tracking, a real dedup strategy — e.g.
// against organization_name/person_name, since agent.contacts has no
// unique business key today) designed and built as its own deliberate
// step, not bundled into this one.
// ---------------------------------------------------------------------------
