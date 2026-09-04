// Phase 1A — decision creation. Uses exactly the existing column-scoped
// INSERT grant on agent.decisions (project_id, decision_key, decision,
// decided_at, decided_by_owner_id, supersedes_decision_id, metadata) — see
// supabase/migrations/20260901_agent_decisions_open_brain_sync.sql. No new
// grant or migration is needed for creation itself; open_brain_eligible and
// durable_memory_recommendation are never named here, so this INSERT
// structurally cannot set either — the same "not in the column list, can't
// be set" property Phase 0F already relies on.
//
// This does NOT create a durable-memory recommendation. That's a separate,
// explicit step — see decisionPromotion.ts's recommendDecisionForOpenBrain().

import { withWriteTransaction } from './db'
import type { PoolClient } from 'pg'
import { ProjectNotFoundError, OwnerNotFoundError, DecisionKeyConflictError, DecisionNotFoundError } from './errors'

export interface CreateDecisionInput {
  decisionKey: string
  decision: string
  /** Omit for a decision with no project. */
  projectKey?: string
  /** Who is recorded as having decided this — defaults to 'jerry', matching the existing Bootstrap v1 convention (Chief is the scribe, not the decider). */
  decidedByOwnerKey?: string
  decidedAt?: Date
  /** The decision this one supersedes, if any. Writes a SUPERSEDED decision_event against that decision — see below. */
  supersedesDecisionId?: string
  /** May include { rationale: string } — surfaced in the durable Open Brain body by openBrainFormat.ts when non-blank. */
  metadata?: Record<string, unknown>
}

export interface CreatedDecision {
  id: string
  decisionKey: string
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === '23505'
}

function isForeignKeyViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === '23503'
}

export async function createDecision(input: CreateDecisionInput): Promise<CreatedDecision> {
  return withWriteTransaction(async (client: PoolClient) => {
    let projectId: string | null = null
    if (input.projectKey) {
      const rows = await client.query<{ id: string }>('SELECT id FROM agent.projects WHERE project_key = $1', [input.projectKey])
      if (rows.rows.length === 0) throw new ProjectNotFoundError(input.projectKey)
      projectId = rows.rows[0].id
    }

    const decidedByOwnerKey = input.decidedByOwnerKey ?? 'jerry'
    const decidedByOwnerRows = await client.query<{ id: string }>('SELECT id FROM agent.owners WHERE owner_key = $1', [decidedByOwnerKey])
    if (decidedByOwnerRows.rows.length === 0) throw new OwnerNotFoundError(decidedByOwnerKey)
    const decidedByOwnerId = decidedByOwnerRows.rows[0].id

    // 'chief' is the actor for decision_events rows this module writes
    // directly (CREATED, SUPERSEDED) — distinct from decided_by_owner_id,
    // which records who decided the CONTENT of the decision, not who
    // performed the create action. Created by the Phase 1A promotion-
    // workflow migration; see that migration if this ever fails to resolve.
    const chiefOwnerRows = await client.query<{ id: string }>("SELECT id FROM agent.owners WHERE owner_key = 'chief'")
    if (chiefOwnerRows.rows.length === 0) throw new OwnerNotFoundError('chief')
    const chiefOwnerId = chiefOwnerRows.rows[0].id

    let insertResult
    try {
      insertResult = await client.query<{ id: string; decision_key: string }>(
        `INSERT INTO agent.decisions (project_id, decision_key, decision, decided_at, decided_by_owner_id, supersedes_decision_id, metadata)
         VALUES ($1, $2, $3, COALESCE($4, now()), $5, $6, COALESCE($7, '{}'::jsonb))
         RETURNING id, decision_key`,
        [
          projectId,
          input.decisionKey,
          input.decision,
          input.decidedAt ?? null,
          decidedByOwnerId,
          input.supersedesDecisionId ?? null,
          input.metadata ? JSON.stringify(input.metadata) : null,
        ]
      )
    } catch (err) {
      if (isUniqueViolation(err)) throw new DecisionKeyConflictError(input.decisionKey)
      if (isForeignKeyViolation(err) && input.supersedesDecisionId) throw new DecisionNotFoundError(input.supersedesDecisionId)
      throw err
    }

    const row = insertResult.rows[0]

    await client.query(`INSERT INTO agent.decision_events (decision_id, event_type, actor_owner_id) VALUES ($1, 'CREATED', $2)`, [row.id, chiefOwnerId])

    if (input.supersedesDecisionId) {
      await client.query(
        `INSERT INTO agent.decision_events (decision_id, event_type, actor_owner_id, metadata) VALUES ($1, 'SUPERSEDED', $2, $3)`,
        [input.supersedesDecisionId, chiefOwnerId, JSON.stringify({ supersededBy: row.id })]
      )
    }

    return { id: row.id, decisionKey: row.decision_key }
  })
}
