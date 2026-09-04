// Phase 0F — the only write surface from agent.decisions into Open Brain.
// Three functions: previewDecisionOpenBrainWrite (no I/O beyond a read),
// writeDecisionToOpenBrain, reconcileDecisionOpenBrainWrite. See
// openBrainTypes.ts's module doc for the real, inspected MCP capability
// surface this design works within — capture_thought's source_system/
// source_identity idempotency and the deterministic get_thought_by_source
// exact lookup are both confirmed live (including an actual end-to-end
// capture, backfill, and read-back), and are now the sole identity/
// idempotency/reconciliation mechanism used below. Semantic search
// (search_thoughts) is no longer used anywhere in this file for that
// purpose — see openBrainClient.ts.
//
// supabase/migrations/20260901_agent_decisions_open_brain_sync.sql (which
// adds open_brain_eligible and agent.record_decision_open_brain_sync) has
// been applied to the live database.
//
// Both external dependencies — the Open Brain transport (OpenBrainClient)
// and the database (DecisionOpenBrainRepository) — are injected with real
// default implementations. This is deliberate, not just for symmetry: the
// Phase 0F test list explicitly calls for exercising mutation behavior
// (remote create + local record, remote-success/local-failure, source
// identity conflicts, etc.) without touching a live database or a live
// Open Brain — agent-service still has no MCP transport to Open Brain from
// a standalone process (see openBrainClient.ts), so a real OpenBrainClient
// cannot be exercised in this test file regardless of migration status.
// Injecting both dependencies makes every one of those scenarios a pure,
// fast, fully-deterministic unit test (see openBrainDecisions.test.ts).

import { query, withWriteTransaction } from './db'
import type { PoolClient } from 'pg'
import { formatDecisionForOpenBrain, type DecisionContentSource } from './openBrainFormat'
import { decisionSourceIdentity } from './openBrainTypes'
import type {
  DecisionOpenBrainPreview,
  DecisionOpenBrainSyncState,
  DecisionOpenBrainWriteResult,
  DecisionOpenBrainReconcileResult,
  WriteDecisionToOpenBrainInput,
} from './openBrainTypes'
import { getDefaultOpenBrainClient, type OpenBrainClient } from './openBrainClient'
import {
  AgentServiceError,
  DecisionNotFoundError,
  DecisionNotEligibleError,
  DecisionSyncStateMismatchError,
  OwnerNotFoundError,
  OpenBrainWriteFailedError,
  DecisionOpenBrainConflictError,
  AmbiguousSyncOutcomeError,
} from './errors'

// ---------------------------------------------------------------------------
// Repository boundary — deliberately separate from Phase 0C's shared
// DecisionSummary/getCurrentDecisions() (see openBrainFormat.ts's doc
// comment for why). The real implementation reads open_brain_eligible,
// which exists as of
// supabase/migrations/20260901_agent_decisions_open_brain_sync.sql
// (applied). It still fails loudly if that column is somehow missing
// (e.g. against a stale/rolled-back database), matching this repo's
// established "fail loudly on a missing required schema piece" convention
// (see mutations.ts's createTask / the source-ref unique index), rather
// than silently degrading.
// ---------------------------------------------------------------------------

export interface DecisionForOpenBrainRow {
  id: string
  decisionKey: string
  decision: string
  decidedAt: Date
  project: { id: string; projectKey: string; name: string } | null
  decidedBy: { displayName: string } | null
  openBrainThoughtId: string | null
  openBrainTitleSnapshot: string | null
  openBrainSummarySnapshot: string | null
  openBrainEligible: boolean
  /** Phase 1A. Chief's own recommendation-state cache — NOT the approval gate (openBrainEligible remains that). */
  durableMemoryRecommendation: 'RECOMMENDED' | 'REJECTED' | null
  metadata: Record<string, unknown>
}

export interface DecisionOpenBrainRepository {
  ownerExists(ownerKey: string): Promise<boolean>
  fetchDecision(decisionId: string): Promise<DecisionForOpenBrainRow | null>
  /** The only place agent.decisions is ever written after INSERT — must go through agent.record_decision_open_brain_sync(), never a bare UPDATE. */
  recordSync(decisionId: string, thoughtId: string, titleSnapshot: string, summarySnapshot: string): Promise<void>
  /** Phase 1A. The only path to durable_memory_recommendation = 'RECOMMENDED' — must go through agent.recommend_decision_for_open_brain(), never a bare UPDATE. Chief has EXECUTE on this function only — never approve/reject/reconsider. */
  recommend(decisionId: string, reason: string): Promise<void>
  /** Phase 1A. Ordinary agent_service INSERT into agent.decision_events, RLS-allow-listed to exactly OPEN_BRAIN_SYNC_SUCCEEDED/FAILED here (see decisionPromotion.ts's syncDecisionToOpenBrain, the only caller). */
  recordSyncEvent(decisionId: string, eventType: 'OPEN_BRAIN_SYNC_SUCCEEDED' | 'OPEN_BRAIN_SYNC_FAILED', note: string | null): Promise<void>
}

interface DecisionForOpenBrainSqlRow {
  id: string
  decision_key: string
  decision: string
  decided_at: Date
  project_id: string | null
  project_key: string | null
  project_name: string | null
  decided_by_display_name: string | null
  open_brain_thought_id: string | null
  open_brain_title_snapshot: string | null
  open_brain_summary_snapshot: string | null
  open_brain_eligible: boolean
  durable_memory_recommendation: 'RECOMMENDED' | 'REJECTED' | null
  metadata: Record<string, unknown> | null
}

const DECISION_FOR_OPEN_BRAIN_SELECT = `
  d.id, d.decision_key, d.decision, d.decided_at,
  d.open_brain_thought_id, d.open_brain_title_snapshot, d.open_brain_summary_snapshot, d.open_brain_eligible,
  d.durable_memory_recommendation, d.metadata,
  p.id AS project_id, p.project_key AS project_key, p.name AS project_name,
  o.display_name AS decided_by_display_name
  FROM agent.decisions d
  LEFT JOIN agent.projects p ON p.id = d.project_id
  LEFT JOIN agent.owners o ON o.id = d.decided_by_owner_id
`

function isMissingColumnError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === '42703'
}

function mapSqlRow(row: DecisionForOpenBrainSqlRow): DecisionForOpenBrainRow {
  return {
    id: row.id,
    decisionKey: row.decision_key,
    decision: row.decision,
    decidedAt: row.decided_at,
    project: row.project_id && row.project_key && row.project_name ? { id: row.project_id, projectKey: row.project_key, name: row.project_name } : null,
    decidedBy: row.decided_by_display_name ? { displayName: row.decided_by_display_name } : null,
    openBrainThoughtId: row.open_brain_thought_id,
    openBrainTitleSnapshot: row.open_brain_title_snapshot,
    openBrainSummarySnapshot: row.open_brain_summary_snapshot,
    openBrainEligible: row.open_brain_eligible,
    durableMemoryRecommendation: row.durable_memory_recommendation,
    metadata: row.metadata ?? {},
  }
}

export function getDefaultDecisionRepository(): DecisionOpenBrainRepository {
  return {
    async ownerExists(ownerKey) {
      const rows = await query<{ id: string }>('SELECT id FROM agent.owners WHERE owner_key = $1', [ownerKey])
      return rows.length > 0
    },
    async fetchDecision(decisionId) {
      let rows: DecisionForOpenBrainSqlRow[]
      try {
        rows = await query<DecisionForOpenBrainSqlRow>(`SELECT ${DECISION_FOR_OPEN_BRAIN_SELECT} WHERE d.id = $1`, [decisionId])
      } catch (err) {
        if (isMissingColumnError(err)) {
          throw new Error(
            'agent.decisions is missing an expected column (open_brain_eligible or durable_memory_recommendation). Apply ' +
              'supabase/migrations/20260901_agent_decisions_open_brain_sync.sql and ' +
              'supabase/migrations/20260901_agent_decisions_promotion_workflow.sql before using this layer.'
          )
        }
        throw err
      }
      return rows.length > 0 ? mapSqlRow(rows[0]) : null
    },
    async recordSync(decisionId, thoughtId, titleSnapshot, summarySnapshot) {
      await withWriteTransaction(async (dbClient: PoolClient) => {
        await dbClient.query('SELECT agent.record_decision_open_brain_sync($1, $2, $3, $4)', [decisionId, thoughtId, titleSnapshot, summarySnapshot])
      })
    },
    async recommend(decisionId, reason) {
      await withWriteTransaction(async (dbClient: PoolClient) => {
        await dbClient.query('SELECT agent.recommend_decision_for_open_brain($1, $2)', [decisionId, reason])
      })
    },
    async recordSyncEvent(decisionId, eventType, note) {
      await withWriteTransaction(async (dbClient: PoolClient) => {
        const chiefOwnerRows = await dbClient.query<{ id: string }>("SELECT id FROM agent.owners WHERE owner_key = 'chief'")
        if (chiefOwnerRows.rows.length === 0) throw new OwnerNotFoundError('chief')
        await dbClient.query('INSERT INTO agent.decision_events (decision_id, event_type, actor_owner_id, note) VALUES ($1, $2, $3, $4)', [
          decisionId,
          eventType,
          chiefOwnerRows.rows[0].id,
          note,
        ])
      })
    },
  }
}

function toContentSource(row: DecisionForOpenBrainRow): DecisionContentSource {
  const rationale = row.metadata?.rationale
  return {
    id: row.id,
    decisionKey: row.decisionKey,
    decision: row.decision,
    decidedAt: row.decidedAt,
    project: row.project,
    decidedBy: row.decidedBy,
    // Only a non-blank string is ever passed through — a malformed/wrong-typed
    // metadata.rationale is silently ignored rather than thrown on, matching
    // this repo's existing defensive convention for untrusted jsonb content.
    rationale: typeof rationale === 'string' && rationale.trim() !== '' ? rationale : null,
  }
}

function toSyncState(row: DecisionForOpenBrainRow): DecisionOpenBrainSyncState {
  return {
    thoughtId: row.openBrainThoughtId,
    titleSnapshot: row.openBrainTitleSnapshot,
    summarySnapshot: row.openBrainSummarySnapshot,
  }
}

// ---------------------------------------------------------------------------
// 1. Preview — no external write, no DB mutation.
// ---------------------------------------------------------------------------

export async function previewDecisionOpenBrainWrite(
  decisionId: string,
  repository: DecisionOpenBrainRepository = getDefaultDecisionRepository()
): Promise<DecisionOpenBrainPreview> {
  const row = await repository.fetchDecision(decisionId)
  if (!row) throw new DecisionNotFoundError(decisionId)

  const content = formatDecisionForOpenBrain(toContentSource(row))

  return {
    decisionId: row.id,
    project: row.project,
    content,
    decidedAt: row.decidedAt,
    existingSyncState: toSyncState(row),
    eligible: row.openBrainEligible,
    ineligibleReason: row.openBrainEligible
      ? null
      : 'open_brain_eligible is false for this decision — existence of a decision row does not imply eligibility (see the Phase 0F migration)',
  }
}

// ---------------------------------------------------------------------------
// 2. Write.
// ---------------------------------------------------------------------------

export async function writeDecisionToOpenBrain(
  input: WriteDecisionToOpenBrainInput,
  client: OpenBrainClient = getDefaultOpenBrainClient(),
  repository: DecisionOpenBrainRepository = getDefaultDecisionRepository()
): Promise<DecisionOpenBrainWriteResult> {
  if (!(await repository.ownerExists(input.actorOwnerKey))) {
    throw new OwnerNotFoundError(input.actorOwnerKey)
  }

  const row = await repository.fetchDecision(input.decisionId)
  if (!row) throw new DecisionNotFoundError(input.decisionId)
  if (!row.openBrainEligible) throw new DecisionNotEligibleError(input.decisionId)

  if (row.openBrainThoughtId !== input.expectedOpenBrainThoughtId) {
    throw new DecisionSyncStateMismatchError(input.decisionId, input.expectedOpenBrainThoughtId, row.openBrainThoughtId)
  }

  const content = formatDecisionForOpenBrain(toContentSource(row))
  const { sourceSystem, sourceIdentity } = content.provenance

  // Already synced locally. Verify via an EXACT lookup (never semantic
  // search) rather than blindly trusting the local flag — but never
  // overwrite: any inconsistency is a typed conflict for human review, per
  // Phase 0F's explicit "do not overwrite externally modified Open Brain
  // content" rule.
  if (row.openBrainThoughtId) {
    const found = await client.getThoughtBySource(sourceSystem, sourceIdentity)

    if (!found) {
      // NOT proof the remote thought is gone — get_thought_by_source is
      // exact, but a miss could still reflect a transient issue. Local
      // state remains authoritative that this decision was previously
      // synced; this is reported honestly as unverified, never escalated.
      return { status: 'LOCAL_RECORDED', decisionId: input.decisionId, thoughtId: row.openBrainThoughtId, remoteVerification: 'UNVERIFIED' }
    }

    if (found.id !== row.openBrainThoughtId) {
      throw new DecisionOpenBrainConflictError(
        input.decisionId,
        `exact lookup for source identity ${sourceIdentity} returned thought ${found.id}, which does not match the locally recorded thought ${row.openBrainThoughtId}`,
        [found.id]
      )
    }

    // content.body is a pure function of the decision's own (immutable —
    // see Phase 0A) fields, so a fresh render must exactly equal what we
    // captured, byte for byte. NOTE: this deliberately does NOT check for
    // the formatted title substring — buildBody() never embeds the title
    // text (title and body are separate fields; see openBrainFormat.ts) —
    // an earlier version of this check compared against the title and
    // would have false-positived on every real (non-mock) thought.
    if (found.content !== content.body) {
      throw new DecisionOpenBrainConflictError(
        input.decisionId,
        'the Open Brain thought content no longer matches what this decision would render — it may have been edited externally since this decision was synced',
        [found.id]
      )
    }

    return { status: 'LOCAL_RECORDED', decisionId: input.decisionId, thoughtId: row.openBrainThoughtId, remoteVerification: 'EXACT_MATCH' }
  }

  // Not yet synced locally. capture_thought is idempotent on (sourceSystem,
  // sourceIdentity) BY DATABASE UNIQUENESS on the backend — this single
  // call safely covers both "genuinely new" and "a prior capture already
  // succeeded but local recording didn't" (Phase 0F's core reliability
  // scenario) without any search/reconcile-before-create step. A same-pair-
  // different-content rejection surfaces as OpenBrainSourceIdentityConflictError
  // (a subclass of AgentServiceError) and is preserved, not collapsed into
  // a generic write failure.
  let createResult: { id: string; created: boolean }
  try {
    createResult = await client.createThought(content.body, sourceSystem, sourceIdentity)
  } catch (err) {
    if (err instanceof AgentServiceError) throw err
    throw new OpenBrainWriteFailedError(err instanceof Error ? err.message : String(err))
  }

  try {
    await repository.recordSync(input.decisionId, createResult.id, content.title, row.decision)
  } catch (err) {
    // The remote write already happened — this is exactly Phase 0F's core
    // reliability scenario. Preserve the thought id in the error so it is
    // never silently lost, and point at the designed recovery path.
    throw new AmbiguousSyncOutcomeError(input.decisionId, createResult.id, err instanceof Error ? err.message : String(err))
  }

  return {
    status: createResult.created ? 'CREATED' : 'RECONCILED_EXISTING',
    decisionId: input.decisionId,
    thoughtId: createResult.id,
  }
}

// ---------------------------------------------------------------------------
// 3. Reconcile — the designed recovery path after a remote-success/local-
// failure, or any time a caller isn't sure of local state. Never creates a
// new thought; only ever performs an EXACT get_thought_by_source lookup
// and, if found, records it.
// ---------------------------------------------------------------------------

export async function reconcileDecisionOpenBrainWrite(
  decisionId: string,
  client: OpenBrainClient = getDefaultOpenBrainClient(),
  repository: DecisionOpenBrainRepository = getDefaultDecisionRepository()
): Promise<DecisionOpenBrainReconcileResult> {
  const row = await repository.fetchDecision(decisionId)
  if (!row) throw new DecisionNotFoundError(decisionId)

  if (row.openBrainThoughtId) {
    return { status: 'ALREADY_RECORDED', decisionId, thoughtId: row.openBrainThoughtId }
  }

  const sourceSystem = 'CheckOff Chief'
  const sourceIdentity = decisionSourceIdentity(decisionId)
  const found = await client.getThoughtBySource(sourceSystem, sourceIdentity)

  if (!found) {
    // Exact lookup found nothing for this pair. Reported as its own state
    // rather than an exception, since it is the expected outcome when a
    // decision genuinely was never written yet.
    return { status: 'NOTHING_TO_RECONCILE', decisionId }
  }

  const content = formatDecisionForOpenBrain(toContentSource(row))
  await repository.recordSync(decisionId, found.id, content.title, row.decision)

  return { status: 'RECONCILED', decisionId, thoughtId: found.id }
}
