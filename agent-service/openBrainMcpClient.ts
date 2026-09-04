// Phase 0G — the real OpenBrainClient implementation, using the official
// @modelcontextprotocol/sdk client over StreamableHTTPClientTransport
// against the live Open Brain MCP server (Supabase Edge Function
// `open-brain-mcp`, verify_jwt=false — auth is via the `x-brain-key`
// header, checked directly in that function's Hono app; see
// /Users/jerrystuckart/supabase/functions/open-brain-mcp/index.ts,
// inspected directly before writing this file, not assumed).
//
// STATELESS SERVER, SHORT-LIVED CLIENT: the Open Brain server constructs a
// brand-new `StreamableHTTPTransport` and calls `server.connect(transport)`
// inside every single Hono request handler invocation — there is no
// server-side session persistence across HTTP requests. This module
// deliberately mirrors that: every call opens a fresh SDK `Client` +
// `StreamableHTTPClientTransport`, does exactly one MCP operation
// (connect → callTool), and closes — never holding a client across calls,
// never assuming session continuity. Reusing one long-lived `Client` here
// would silently rely on server behavior (session persistence) that does
// not exist.
//
// AUTH: the key is read once into a local `config.key` value and passed
// ONLY via `requestInit.headers['x-brain-key']` on the transport — never
// via Authorization, never appended to the URL/query string (the server
// does accept a `?key=` query param as a fallback, but this client never
// uses it — confirmed acceptable/required by Jerry). Nothing in this file
// logs `config.key`, includes it in a thrown error's message, or
// interpolates it into a URL string.
//
// SEMANTICS UNCHANGED: this file implements the `OpenBrainClient`
// interface from openBrainClient.ts only — decision-sync semantics
// (eligibility gate, record_decision_open_brain_sync, source-identity
// idempotency) live entirely in openBrainDecisions.ts and are untouched by
// this transport swap.

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import { OpenBrainUnavailableError, OpenBrainWriteFailedError, OpenBrainSourceIdentityConflictError } from './errors'
import type { OpenBrainClient, OpenBrainCreateResult, OpenBrainSearchResult, OpenBrainThought } from './openBrainClient'

export interface OpenBrainMcpClientConfig {
  /** Base URL of the Open Brain MCP Supabase Edge Function, e.g. https://<project-ref>.supabase.co/functions/v1/open-brain-mcp — never includes the key. */
  url: string
  /** The x-brain-key value. Read once here; never logged, never put in a URL. */
  key: string
  /** Per-call network timeout in ms. Default 15000. */
  timeoutMs?: number
  /** Test-only injection point — defaults to the global fetch. Never used to bypass the timeout wrapper. */
  fetchImpl?: FetchLike
}

const DEFAULT_TIMEOUT_MS = 15000
/** get_thought_by_source only: total attempts (1 initial + up to this many retries) for a transport-level (never a well-formed tool response) failure. capture_thought is NEVER retried — see createThought below. */
const READ_RETRY_ATTEMPTS = 3
const READ_RETRY_DELAY_MS = 250

/**
 * The two substrings that, together, uniquely identify
 * capture_thought_idempotent's own conflict-rejection message (see
 * /Users/jerrystuckart/supabase/migrations/20260902_fix_capture_thought_idempotent_ambiguity.sql):
 * "...is already recorded (thought id=...) with different content —
 * refusing to treat this as an idempotent retry...". Matching on the
 * server's actual, inspected wording (not a guess) keeps this mapping
 * deterministic rather than a heuristic over arbitrary error text.
 */
const CONFLICT_TEXT_MARKERS = ['with different content', 'idempotent retry']
const NOT_FOUND_TEXT_MARKER = 'No thought found for'

interface ToolCallResult {
  content: Array<{ type: string; text?: string }>
  isError?: boolean
  structuredContent?: Record<string, unknown>
}

function withTimeout(timeoutMs: number, fetchImpl: FetchLike): FetchLike {
  return async (url, init) => {
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const signal = init?.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal
    return fetchImpl(url, { ...init, signal })
  }
}

function isTimeoutOrAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')
}

function isNetworkFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const cause = 'cause' in err && err.cause instanceof Error ? err.cause.message : String((err as { cause?: unknown }).cause ?? '')
  const combined = `${err.message} ${cause}`
  return /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network/i.test(combined)
}

/**
 * Maps a raw transport/protocol-level failure. NEVER receives or reads
 * config.key — this function only ever sees the thrown Error, so there is
 * nothing to accidentally include in the mapped error's message.
 */
function mapTransportError(err: unknown): Error {
  if (isTimeoutOrAbort(err)) return new OpenBrainUnavailableError('request timed out')
  if (isNetworkFailure(err)) return new OpenBrainUnavailableError(`network error: ${err instanceof Error ? err.message : String(err)}`)
  return new OpenBrainWriteFailedError(err instanceof Error ? err.message : String(err))
}

function textOf(result: ToolCallResult): string {
  return result.content
    .filter((c): c is { type: string; text: string } => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n')
}

type ResolvedConfig = { url: string; key: string; timeoutMs: number; fetchImpl: FetchLike }

/**
 * One connect -> call -> close cycle against the Open Brain server. See
 * this module's header doc for why this never reuses a client/session
 * across calls.
 */
async function callTool(config: ResolvedConfig, name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
  const transport = new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: { headers: { 'x-brain-key': config.key } },
    fetch: withTimeout(config.timeoutMs, config.fetchImpl),
  })

  const client = new Client({ name: 'checkoff-agent-service', version: '1.0.0' }, { capabilities: {} })

  try {
    await client.connect(transport)
    const result = await client.callTool({ name, arguments: args })
    return result as ToolCallResult
  } catch (err) {
    throw mapTransportError(err)
  } finally {
    await client.close().catch(() => {
      // Best-effort close — a failure here must never mask the real
      // outcome of the call above (already returned or already thrown).
    })
  }
}

/**
 * Real transport for the Open Brain MCP server. Fails closed at
 * construction if url/key are missing (see createOpenBrainClientFromEnv in
 * openBrainClient.ts, which is the only place that should call this).
 */
export function createOpenBrainMcpClient(config: OpenBrainMcpClientConfig): OpenBrainClient {
  const resolved: ResolvedConfig = {
    url: config.url,
    key: config.key,
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    fetchImpl: config.fetchImpl ?? fetch,
  }

  return {
    async createThought(content, sourceSystem, sourceIdentity): Promise<OpenBrainCreateResult> {
      // Exactly one call. No blind automatic retry on capture_thought —
      // an ambiguous outcome (e.g. a timeout after the remote write
      // already landed) is surfaced to the caller (openBrainDecisions.ts
      // wraps repository.recordSync failure as AmbiguousSyncOutcomeError);
      // recovery is always via reconcileDecisionOpenBrainWrite's exact
      // get_thought_by_source lookup, never a second capture_thought call
      // from this client.
      const result = await callTool(resolved, 'capture_thought', {
        content,
        source_system: sourceSystem,
        source_identity: sourceIdentity,
      })

      if (result.isError) {
        const text = textOf(result)
        if (CONFLICT_TEXT_MARKERS.every((marker) => text.includes(marker))) {
          throw new OpenBrainSourceIdentityConflictError(sourceSystem, sourceIdentity, text)
        }
        throw new OpenBrainWriteFailedError(text || 'capture_thought returned isError with no message')
      }

      const structured = result.structuredContent
      if (!structured || typeof structured.id !== 'string' || typeof structured.created !== 'boolean') {
        throw new OpenBrainWriteFailedError('capture_thought succeeded but returned no usable structuredContent.id/created')
      }

      return { id: structured.id, created: structured.created }
    },

    async getThoughtBySource(sourceSystem, sourceIdentity): Promise<OpenBrainThought | null> {
      let lastErr: unknown
      for (let attempt = 1; attempt <= READ_RETRY_ATTEMPTS; attempt++) {
        try {
          const result = await callTool(resolved, 'get_thought_by_source', {
            source_system: sourceSystem,
            source_identity: sourceIdentity,
          })

          if (result.isError) {
            const text = textOf(result)
            // Deterministic not-found contract (see index.ts's own doc
            // comment on this tool) — a miss is a normal outcome, not an
            // error, and this is the ONLY isError text this method ever
            // treats as non-fatal.
            if (text.includes(NOT_FOUND_TEXT_MARKER)) return null
            throw new OpenBrainWriteFailedError(text || 'get_thought_by_source returned isError with no message')
          }

          const structured = result.structuredContent
          if (!structured || typeof structured.id !== 'string' || typeof structured.content !== 'string') {
            throw new OpenBrainWriteFailedError('get_thought_by_source succeeded but returned no usable structuredContent.id/content')
          }

          return { id: structured.id, content: structured.content }
        } catch (err) {
          lastErr = err
          // Retry ONLY a genuine transport-level failure (never even got a
          // well-formed response) — a well-formed isError or a parsed
          // OpenBrainWriteFailedError above is never retried, since
          // retrying those would not change the outcome.
          if (!(err instanceof OpenBrainUnavailableError) || attempt === READ_RETRY_ATTEMPTS) throw err
          await new Promise((resolve) => setTimeout(resolve, READ_RETRY_DELAY_MS))
        }
      }
      // Unreachable — the loop above always returns or throws — but keeps
      // the function's return type honest for TypeScript.
      throw lastErr instanceof Error ? lastErr : new OpenBrainWriteFailedError(String(lastErr))
    },

    async searchByText(query, options): Promise<OpenBrainSearchResult[]> {
      const result = await callTool(resolved, 'search_thoughts', {
        query,
        threshold: options?.threshold,
        limit: options?.limit,
      })
      if (result.isError) return []

      const structured = result.structuredContent as { thoughts?: Array<{ id?: unknown }> } | undefined
      const thoughts = structured?.thoughts ?? []
      // search_thoughts's structuredContent carries only id/similarity/
      // created_at per result — the real per-item content is not broken
      // out separately, only combined into the single display-text blob
      // (see index.ts's search_thoughts handler). DISCOVERY ONLY (see
      // openBrainClient.ts): no caller in this codebase uses
      // OpenBrainSearchResult.content for identity/idempotency, so this is
      // an honest best-effort value, not a per-item guarantee.
      const combinedText = textOf(result)
      return thoughts.map((t) => ({ id: typeof t.id === 'string' ? t.id : null, content: combinedText }))
    },
  }
}
