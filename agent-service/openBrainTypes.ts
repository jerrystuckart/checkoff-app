// Phase 0F — types for Chief's Durable Memory write-back. Decisions are
// the FIRST memory-producing domain, not the only one Open Brain will
// ever hold — see the provenance shape below, which is deliberately
// general rather than CheckOff-decision-specific, without inventing
// formats for domains (email/calendar/meetings) that don't exist yet.
//
// IMPORTANT — read before using any of this: the actual Open Brain MCP
// surface available to Claude Code (mcp__Open_Brain__capture_thought,
// get_thought, get_thought_by_source, list_thoughts, search_thoughts,
// thought_stats — inspected directly, not assumed, including a live
// end-to-end capture/backfill/read-back against production Open Brain) is
// richer than earlier revisions of this module assumed:
//   - capture_thought(content: string, source_system?, source_identity?) —
//     when both source fields are supplied, this is idempotent BY DATABASE
//     UNIQUENESS on the backend: a repeat call with the same pair and
//     IDENTICAL content returns the existing thought (created: false)
//     instead of a duplicate; a repeat with the same pair but DIFFERENT
//     content is a genuine conflict the backend rejects outright.
//   - get_thought_by_source(source_system, source_identity) — a
//     DETERMINISTIC exact lookup, never a semantic/similarity match. This
//     is the sole identity/idempotency/reconciliation mechanism this
//     module uses now.
//   - NO get-a-thought-by-id-that-agent-service-can-use capability exists
//     (get_thought(id) is keyed by Open Brain's own thought id, which
//     agent-service never has reason to look up directly).
//   - NO update-a-thought capability exists at all — recorded sync
//     metadata (open_brain_thought_id/snapshots) is immutable once written,
//     by design (see the 20260901 migration's record_decision_open_brain_sync).
//   - search_thoughts(query, threshold?, limit?) is explicitly semantic
//     ("search by meaning") — an embedding-similarity search. It remains
//     available for DISCOVERY use cases, but is no longer used anywhere in
//     this module for identity, idempotency, or reconciliation now that
//     get_thought_by_source is confirmed to exist: a semantic hit is never
//     proof of identity, and this module never uses one as such.
//   - list_thoughts filters by type/topic/person/days — no id or source-
//     identifier filter (unaffected by the above; still discovery only).
//
// On top of that: mcp__Open_Brain__* tools are reachable only from inside
// a Claude Code session — agent-service is a standalone Node/`pg` process
// with no MCP access at all, and nothing in this repo (or available to
// this session) documents a directly-callable HTTP endpoint, URL, or key
// for whatever service backs Open Brain. So even this capability-matched
// adapter has no confirmed transport to actually reach Open Brain from a
// standalone agent-service process today — see openBrainClient.ts.
//
// Consequence: local state (open_brain_thought_id) is the ONLY
// authoritative record that Chief previously synced a memory — never the
// result of a search or a lookup. An exact get_thought_by_source lookup
// can add EXACT_MATCH as supporting confirmation on top of that, or report
// UNVERIFIED if it comes back empty (which, unlike semantic search, is
// meaningful — but local state still governs the reported sync status; a
// miss here never downgrades "already recorded" to "missing").

/** `agent_decision:<decision uuid>` — embedded verbatim in the thought body since there is no metadata field to put it in instead. */
export function decisionSourceIdentity(decisionId: string): string {
  return `agent_decision:${decisionId}`
}

/**
 * General enough for future Chief memory-producing domains (email,
 * calendar, meetings, ...) without designing those now — `memoryType`
 * and `sourceIdentity`'s prefix are what future domains would vary;
 * `sourceSystem` stays "CheckOff Chief" regardless of domain, since Open
 * Brain is Jerry's one shared durable memory system across all of them,
 * not a CheckOff-only store.
 */
export interface DecisionOpenBrainProvenance {
  decisionId: string
  decisionKey: string
  projectId: string | null
  projectKey: string | null
  decidedAt: Date
  sourceSystem: 'CheckOff Chief'
  memoryType: 'decision'
  sourceIdentity: string
}

export interface DecisionOpenBrainContent {
  /** Human-readable title — never a bare UUID. */
  title: string
  /** The exact text that would be sent as capture_thought's `content`. Includes the provenance marker inline, since there is no metadata field to carry it separately. */
  body: string
  provenance: DecisionOpenBrainProvenance
}

export interface DecisionOpenBrainSyncState {
  thoughtId: string | null
  titleSnapshot: string | null
  summarySnapshot: string | null
}

export interface DecisionOpenBrainPreview {
  decisionId: string
  project: { id: string; projectKey: string; name: string } | null
  content: DecisionOpenBrainContent
  decidedAt: Date
  existingSyncState: DecisionOpenBrainSyncState
  eligible: boolean
  ineligibleReason: string | null
}

/**
 * What an exact get_thought_by_source lookup contributed, if anything, to
 * a state where LOCAL state already says "synced." Never the primary
 * signal for "is this synced" — local state governs that — but unlike the
 * old semantic-search-based version of this type, a lookup here IS a
 * deterministic exact check, not a best-effort similarity guess.
 *   - EXACT_MATCH: get_thought_by_source returned a thought whose id
 *     matches what's recorded locally.
 *   - UNVERIFIED: get_thought_by_source found nothing for this exact pair.
 *     Local state is still authoritative — this is reported honestly
 *     rather than silently upgraded to "confirmed," but it never downgrades
 *     the LOCAL_RECORDED status itself.
 */
export type RemoteVerificationState = 'EXACT_MATCH' | 'UNVERIFIED'

export type DecisionOpenBrainWriteResult =
  | { status: 'CREATED'; decisionId: string; thoughtId: string }
  // Local state (open_brain_thought_id already present) is authoritative
  // that Chief previously recorded a sync — this status is returned
  // regardless of remoteVerification's value; an exact-lookup miss never
  // downgrades it or implies the remote thought is gone.
  | { status: 'LOCAL_RECORDED'; decisionId: string; thoughtId: string; remoteVerification: RemoteVerificationState }
  // capture_thought's own idempotency (same source pair, identical
  // content) returned a pre-existing thought rather than creating a new
  // one — deterministic, not a corroboration guess, so no
  // remoteVerification field is needed here.
  | { status: 'RECONCILED_EXISTING'; decisionId: string; thoughtId: string }

export type DecisionOpenBrainReconcileResult =
  | { status: 'ALREADY_RECORDED'; decisionId: string; thoughtId: string }
  // Found via an exact get_thought_by_source lookup — deterministic, so no
  // remoteVerification field is needed here either.
  | { status: 'RECONCILED'; decisionId: string; thoughtId: string }
  | { status: 'NOTHING_TO_RECONCILE'; decisionId: string }

export interface WriteDecisionToOpenBrainInput {
  decisionId: string
  actorOwnerKey: string
  /**
   * Meaningful concurrency precondition for THIS table: agent.decisions
   * has no updated_at/version column (decisions are content-immutable by
   * design — see Phase 0A), so the only thing that can meaningfully
   * change here is open_brain_thought_id itself. Pass what the caller
   * currently believes it is (usually null, from a fresh preview) — a
   * mismatch means someone else's write already landed since that preview
   * was taken.
   */
  expectedOpenBrainThoughtId: string | null
}
