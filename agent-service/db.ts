// Phase 0C database access — agent_service only, read-only at the
// application layer. See docs/agent-platform/phase0a-review.md §3 for the
// full access-model rationale (agent_service is a dedicated least-
// privilege Postgres role, reached via direct connection, never
// PostgREST/supabase-js and never Supabase service_role).

import { Pool, type QueryResultRow, type PoolClient } from 'pg'
import * as fs from 'fs'
import * as path from 'path'

// ─── minimal .env loader ───────────────────────────────────────────────
// Same convention as scripts/geocode-items.js: no dotenv dependency for
// this — .env is already gitignored, and values already present in
// process.env (e.g. exported by the shell) are never overwritten.
function loadEnvFile(relPath: string): void {
  const envPath = path.join(__dirname, '..', relPath)
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = val
  }
}
loadEnvFile('.env')

const connectionString = process.env.AGENT_SERVICE_DATABASE_URL

let pool: Pool | null = null

// Lazy singleton: importing this module (e.g. for types or in a context
// where DB access never actually happens) must not require the env var to
// be set. The error only fires the first time a query actually runs.
function getPool(): Pool {
  if (pool) return pool
  if (!connectionString) {
    throw new Error(
      'AGENT_SERVICE_DATABASE_URL is not set. This must be a Postgres connection ' +
        'string authenticated as the agent_service role created in Phase 0A — ' +
        'never the Supabase service_role key. See docs/agent-platform/ for setup notes.'
    )
  }
  pool = new Pool({
    connectionString,
    // Supabase requires TLS; this repo has no existing pattern for pinning
    // Supabase's CA bundle from Node, so this matches the common minimal
    // approach for a first-class Postgres client against Supabase. Revisit
    // if/when this service is deployed somewhere that wants a pinned CA.
    ssl: { rejectUnauthorized: false },
    max: 5,

    // Defense-in-depth: agent_service DOES have INSERT/UPDATE privileges on
    // several agent.* tables (projects, contacts, tasks, runs, and a
    // column-scoped UPDATE on interactions) for FUTURE phases — see
    // docs/agent-platform/phase0a-review.md §3.2. Phase 0C's own code
    // simply doesn't call any write statement, but that alone is one
    // missing `await` away from being wrong. `SET default_transaction_
    // read_only = on` makes every subsequent statement on the connection
    // run inside an implicit read-only transaction, so any INSERT/UPDATE/
    // DELETE that slips in — on ANY table, not just ones without write
    // grants — fails with a Postgres error instead of silently succeeding.
    //
    // This MUST use pg-pool's `onConnect` hook, not a `pool.on('connect',
    // ...)` listener: pg-pool awaits `onConnect` (via `_promiseTry(...)
    // .then(...)`) before handing the freshly-connected client to whichever
    // caller is waiting for it. A `pool.on('connect', ...)` listener, by
    // contrast, fires as a plain synchronous EventEmitter callback — the
    // pool does not wait for it, so it hands the client to the next
    // `pool.query()` caller immediately, before our fire-and-forget SET
    // command has necessarily finished. That's exactly the "Calling
    // client.query() when the client is already executing a query" race:
    // two overlapping, unawaited `.query()` calls on the same client. Using
    // `onConnect` instead makes the SET command complete (or fail — see
    // below) before the client is ever handed off, so the pool always
    // issues exactly one query on a brand-new client before any
    // application code can, and a real query is never sent concurrently
    // with (or ahead of) it.
    //
    // A bonus of this fix: previously, a failed SET call was only logged
    // (`.catch(console.error)`) and the connection stayed in the pool
    // anyway — a silent gap in the read-only guarantee. Because pg-pool
    // propagates a rejected `onConnect` as a connection failure (ending
    // the client and failing the pending request rather than completing
    // `_afterConnect`), a client that couldn't be set read-only is never
    // handed out at all.
    onConnect: async (client) => {
      await client.query('SET default_transaction_read_only = on')
    },
  })

  pool.on('error', (err) => {
    // Idle-client errors (e.g. connection dropped by the pooler) surface
    // here rather than crashing the process — matches this repo's existing
    // console.error-based error convention (see scripts/*.js), no logging
    // library introduced.
    console.error('[agent-service/db] idle client error', err)
  })

  return pool
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  try {
    const result = await getPool().query<T>(text, params)
    return result.rows
  } catch (err) {
    console.error('[agent-service/db] query failed', { text, params, error: err })
    throw err
  }
}

/** For CLI tools/tests that need to let the process exit cleanly. */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}

// ---------------------------------------------------------------------------
// Phase 0D: the ONLY way any code in this module can get a writable
// transaction. Deliberately not a general "get me a client" export — it
// takes a callback, runs it inside BEGIN/COMMIT, and the caller never sees
// a bare client outside that transaction's lifetime.
//
// HOW READ-ONLY-BY-DEFAULT IS PRESERVED: the pool's session-level default
// (`SET default_transaction_read_only = on`, set once per physical
// connection via `onConnect` above) is a SESSION default — Postgres lets a
// single transaction override its session's default characteristics with
// `SET TRANSACTION READ WRITE`, and that override is scoped to exactly that
// transaction: on COMMIT or ROLLBACK, Postgres reverts to the session
// default for whatever runs next on that connection (this is standard,
// documented Postgres transaction-characteristics behavior, not a pg-
// specific trick). So:
//   - `query()` above never opens an explicit transaction — every call is
//     its own implicit single-statement transaction, which inherits the
//     read-only session default. Every Phase 0C read function, and any
//     future code that just calls `query()`, stays read-only with zero
//     chance of writing, exactly as before.
//   - `withWriteTransaction()` is the only place that ever runs
//     `SET TRANSACTION READ WRITE`, and only for the duration of the one
//     transaction it wraps. There is no session-wide "turn writes on"
//     switch, and no caller can casually make a connection writable by
//     accident — they have to explicitly call this function and write
//     parameterized SQL inside its callback.
// The DB-level defense from Phase 0C (agent_service's actual table grants:
// no DELETE anywhere, no UPDATE on task_events — see phase0a-review.md
// §3.2) is unchanged and still the real backstop; this is the
// application-layer half of "read-only by default, explicitly writable
// only inside approved mutation code."
export async function withWriteTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    await client.query('SET TRANSACTION READ WRITE')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch (rollbackErr) {
      console.error('[agent-service/db] rollback failed after write-transaction error', rollbackErr)
    }
    throw err
  } finally {
    client.release()
  }
}
