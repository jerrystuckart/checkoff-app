// Phase 0F — Open Brain transport boundary. The rest of agent-service
// (openBrainDecisions.ts) knows nothing about how a thought actually gets
// created or looked up; it only calls this interface.
//
// The interface below is shaped by the REAL Open Brain MCP capabilities,
// inspected directly (not assumed) via a live Claude Code session:
//   - capture_thought(content, source_system?, source_identity?) — when
//     both source_system and source_identity are supplied, this is
//     idempotent BY DATABASE UNIQUENESS on the backend: a repeat call with
//     the same pair and IDENTICAL content returns the existing thought
//     (created: false) instead of creating a duplicate; a repeat with the
//     same pair but DIFFERENT content is a genuine conflict the backend
//     rejects outright, never silently treated as a successful retry.
//   - get_thought_by_source(source_system, source_identity) — a
//     DETERMINISTIC exact lookup, never a semantic/similarity match. This
//     is the sole identity/reconciliation mechanism this module uses: a
//     hit means the pair was genuinely captured, a miss means it genuinely
//     was not (unlike search_thoughts, absence here is meaningful).
//   - search_thoughts(query, threshold?, limit?) — semantic/embedding
//     search ("by meaning"). Still exposed here for DISCOVERY use cases,
//     but openBrainDecisions.ts no longer uses it for identity, idempotency,
//     or reconciliation now that get_thought_by_source is confirmed to
//     exist — a semantic hit is never proof of identity.
//   - There is still no get-a-thought-by-id capability (get_thought exists
//     on the real MCP surface but is keyed by Open Brain's own thought id,
//     not by our source identity, and agent-service has no use for it) —
//     this interface does not expose one.
//
// TRANSPORT (Phase 0G): agent-service now has a real, direct transport to
// the Open Brain MCP server — see openBrainMcpClient.ts, which implements
// this interface using the official @modelcontextprotocol/sdk client over
// StreamableHTTPClientTransport against the live Open Brain Supabase Edge
// Function (`open-brain-mcp`), inspected directly at
// /Users/jerrystuckart/supabase/functions/open-brain-mcp/index.ts before
// building this. getDefaultOpenBrainClient() below wires that in when
// OPEN_BRAIN_MCP_URL/OPEN_BRAIN_MCP_KEY are both set, and otherwise still
// fails closed with OpenBrainUnavailableError — configuration is required,
// never assumed or defaulted. Tests inject a mock implementing this same
// interface; they never exercise the real network path.
//
// UNIT-TEST SAFETY BOUNDARY (Phase 1A hardening): this is NOT redundant
// with "tests inject a mock" above — a real incident proved it. Once
// OPEN_BRAIN_MCP_URL/KEY are genuinely populated in the repo root .env
// (which they are, post Phase 0G/0H), a test that calls
// getDefaultOpenBrainClient() WITHOUT injecting anything silently gets the
// REAL client and makes a REAL network call — exactly what happened to a
// Phase 0F-era "unconfigured client" test the moment live credentials
// existed. Deleting/restoring env vars inside that one test fixed that one
// test, but is not a structural guarantee: any future test (or test
// author unaware of this hazard) that calls getDefaultOpenBrainClient()
// without first clearing the env is one accidental live write away from
// the same incident.
//
// The fix lives here, at the single chokepoint every caller goes through,
// not scattered across individual tests: whenever this process is running
// under Node's own test runner — detected via process.env.NODE_TEST_CONTEXT,
// which `node --test` sets automatically on every test child process,
// regardless of how it was invoked (npm script, direct tsx, direct
// `node --test`) and regardless of what any individual test file does or
// forgets to do — constructing the real live client additionally requires
// an explicit AGENT_SERVICE_ALLOW_OPEN_BRAIN_LIVE_TEST=1 opt-in, even when
// OPEN_BRAIN_MCP_URL/KEY are both genuinely set. `npm run agent:test`
// never sets that opt-in, so it is structurally incapable of reaching live
// Open Brain — not because any test remembers to guard itself, but because
// this one function refuses regardless. verifyOpenBrainLive.ts — the one
// script whose entire purpose is a deliberate live read-only call — sets
// the opt-in itself before calling this function (defense-in-depth: it
// isn't running under node --test at all, so the NODE_TEST_CONTEXT check
// wouldn't even fire for it, but setting the opt-in explicitly keeps the
// real gating signal self-documenting in that file rather than relying on
// an absence). Ordinary production/service execution (the eventual real
// Chief process) never runs under `node --test` either, so
// NODE_TEST_CONTEXT is never set there, and this guard never engages —
// nothing about real service execution changes.

import { OpenBrainUnavailableError } from './errors'
import { createOpenBrainMcpClient } from './openBrainMcpClient'

const OPEN_BRAIN_LIVE_TEST_OPT_IN_VAR = 'AGENT_SERVICE_ALLOW_OPEN_BRAIN_LIVE_TEST'

/** True only inside a process Node's own test runner spawned (`node --test`) — never true for ordinary script/service execution. */
function isRunningUnderNodeTestRunner(): boolean {
  return Boolean(process.env.NODE_TEST_CONTEXT)
}

export interface OpenBrainSearchResult {
  /**
   * Best-effort only — the real search_thoughts return shape's id field has
   * not been confirmed against every possible response. If a concrete
   * implementation cannot confidently extract a stable id from a search
   * hit, it should return null here rather than guessing.
   */
  id: string | null
  content: string
}

export interface OpenBrainCreateResult {
  id: string
  /**
   * false when this call was an idempotent replay of an existing
   * (sourceSystem, sourceIdentity) pair with identical content — the
   * backend returned the pre-existing thought rather than creating a new
   * one. true when a genuinely new thought was created.
   */
  created: boolean
}

export interface OpenBrainThought {
  id: string
  content: string
}

export interface OpenBrainClient {
  /**
   * Maps to mcp__Open_Brain__capture_thought(content, source_system,
   * source_identity). Both source fields are always supplied by this
   * module's callers — sourceSystem/sourceIdentity are what make repeated
   * calls idempotent, enforced by the backend's own uniqueness constraint,
   * not by any client-side search. A concrete implementation must surface
   * a same-pair/different-content rejection as
   * OpenBrainSourceIdentityConflictError, never collapse it into a generic
   * write failure or silently treat it as success.
   */
  createThought(content: string, sourceSystem: string, sourceIdentity: string): Promise<OpenBrainCreateResult>

  /**
   * Maps to mcp__Open_Brain__get_thought_by_source(source_system,
   * source_identity) — a deterministic exact lookup, never a
   * semantic/similarity match. Returns null when nothing was captured with
   * this exact pair. This is the ONLY identity/idempotency/reconciliation
   * lookup this module performs; it is never used for open-ended discovery.
   */
  getThoughtBySource(sourceSystem: string, sourceIdentity: string): Promise<OpenBrainThought | null>

  /**
   * Maps to mcp__Open_Brain__search_thoughts — semantic/embedding search
   * ("by meaning"). DISCOVERY ONLY: openBrainDecisions.ts does not call
   * this for identity, idempotency, or reconciliation — getThoughtBySource
   * is the sole mechanism for those. A returned hit is never treated as
   * confirmed identity without an exact source-identity check.
   */
  searchByText(query: string, options?: { threshold?: number; limit?: number }): Promise<OpenBrainSearchResult[]>
}

/**
 * Fails closed if either env var is missing — configuration is required,
 * never assumed, never defaulted, never partially degraded. OPEN_BRAIN_MCP_KEY
 * is read directly into openBrainMcpClient's config and is never logged or
 * included in any error text in this file or in openBrainMcpClient.ts.
 *
 * ALSO fails closed under Node's test runner unless
 * AGENT_SERVICE_ALLOW_OPEN_BRAIN_LIVE_TEST=1 is explicitly set — see this
 * module's header doc for why this exists and what it does and does not
 * affect.
 */
export function getDefaultOpenBrainClient(): OpenBrainClient {
  const url = process.env.OPEN_BRAIN_MCP_URL
  const key = process.env.OPEN_BRAIN_MCP_KEY

  if (url && key) {
    if (isRunningUnderNodeTestRunner() && process.env[OPEN_BRAIN_LIVE_TEST_OPT_IN_VAR] !== '1') {
      return unavailableClient(
        `Refusing to construct a live Open Brain client while running under Node's test runner (NODE_TEST_CONTEXT is set), ` +
          `even though OPEN_BRAIN_MCP_URL/OPEN_BRAIN_MCP_KEY are configured. Set ${OPEN_BRAIN_LIVE_TEST_OPT_IN_VAR}=1 to explicitly ` +
          `opt in — only agent-service/verifyOpenBrainLive.ts should ever do this. Ordinary tests must inject a mock OpenBrainClient ` +
          `instead of relying on this opt-in.`
      )
    }
    return createOpenBrainMcpClient({ url, key })
  }

  const missing = [!url && 'OPEN_BRAIN_MCP_URL', !key && 'OPEN_BRAIN_MCP_KEY'].filter(Boolean).join(', ')
  return unavailableClient(`${missing} not set — Open Brain transport requires both to be configured. See openBrainClient.ts / openBrainMcpClient.ts.`)
}

function unavailableClient(message: string): OpenBrainClient {
  const unavailable = (): never => {
    throw new OpenBrainUnavailableError(message)
  }
  return {
    async createThought() {
      return unavailable()
    },
    async getThoughtBySource() {
      return unavailable()
    },
    async searchByText() {
      return unavailable()
    },
  }
}
