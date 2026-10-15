# Winston resilience patch: Supabase connections and Gmail quota

Branch `winston/resilience` (not merged, not deployed). Written 2026-10-15 after two findings:

1. **Supabase connection exhaustion.** `FATAL 53300 remaining connection slots are reserved for roles with the SUPERUSER attribute`
   (monitor log, once, ~2026-10-14 23:00Z). The project allows `max_connections = 60` (3 reserved), shared by PostgREST, the app,
   Supabase internals and every tool/session. Winston is one sequential loop with one pool, so it is not leaking; a burst from several
   processes at once (monitor + ad hoc scripts/dry runs, each with a pool of up to 5) is the probable cause. The URL is the Supavisor
   pooler on port 5432 (**session mode**), not a direct connection.
2. **Gmail "Total Query Cost" per-minute quota.** Back-to-back full ticks (47 pre-follow-up checks, 2 searches + fetches each) returned
   403 `Quota exceeded`. A quota error raised by a READ was handled like a failed send: recipient `PAUSED` + `NEEDS_JERRY`, and
   `isSystemicSendError` (matches 403/quota/429) then **paused the whole campaign**.

## What changes

| Area | Change |
|---|---|
| `db.ts` | Pool max 5 -> **3** (`AGENT_DB_POOL_MAX`, clamp 1..10); `application_name = winston-agent-service` (`AGENT_DB_APP_NAME`) so connections are attributable in `pg_stat_activity`; `idleTimeoutMillis 10s`; `connectionTimeoutMillis 15s`; **connect-phase retry** (1s/3s/9s + jitter, 4 attempts) for `53300`, `57P03`, `ENOTFOUND`, `EAI_AGAIN`, `ECONNREFUSED`, connect timeout. Applied to `query()` and to acquiring the client in `withWriteTransaction` (before `BEGIN`, so a write is never duplicated). SQL errors are never retried. |
| `gmailResilience.ts` (new) | Error classes (`QUOTA`, `TRANSIENT`, `AUTH`, `OTHER`); `withGmailRetry` (reads only: 2s/6s/18s, honours "Retry after <ISO>", capped 60s); `GmailPacer` (min 120ms between reads). |
| `googleAdapters.ts` | `RealGmailAdapter` list/get/full reads go through the pacer + retry. **Sends are never retried.** |
| `bizDevOutreach.ts` | Transient Gmail errors (quota/5xx/network) **defer** work to the next tick: no `PAUSED`, no `NEEDS_JERRY`, no campaign pause, no state change. Circuit breaker: after the first one, remaining follow-ups and first touches in that tick are skipped (no hammering). The first-message fetch moved **before** the claim. A follow-up send rejected at admission by a per-minute quota releases its claim (guarded `releaseStep`) and retries next tick. Summary line: `gmail: rate limit / transient error (...); N item(s) deferred to the next tick; nothing paused, no state changed`. |

## Deliberately unchanged
- Real send failures still pause and escalate: auth (`401`, `invalid_grant`, `535`), `Daily user sending ...` limit, anything non-transient.
- First-touch send errors (including 429 on `messages.send`) still follow the existing pause-on-systemic-error rule. First touches are only *skipped* while Gmail is backing off. Revisit once the daily queue is live if per-minute send rejections show up.
- The 100/day shared cap, the 50/day first-touch limit, prior-contact suppression and the pre-follow-up reply/bounce check are untouched.

## Correction to the earlier suggestion
Moving to the pooler's transaction-mode port (6543) is **not** recommended. `db.ts` makes every session read-only with a session-level `SET default_transaction_read_only = on`; transaction pooling does not preserve session state, which would silently void that guard. Stay on session mode, hold fewer connections (pool 3, short idle timeout), identify them, and retry connect-phase failures.

## Tests
`gmailResilience.test.ts` (9): classification, retry-after, backoff, pacer, adapter reads retried / auth not retried / **send never retried**, db connect-error classification and retry.
`bizDevResilience.test.ts` (7): quota during scan defers all follow-ups with zero state change, then sends exactly once on recovery; quota on first-message fetch happens before the claim; admission-rejected send releases the claim and retries once; **auth / daily-limit send errors still pause + escalate**; circuit breaker bounds reads; non-transient read error still reported; first touches skipped while backing off.
Full suite: only the pre-existing environment-dependent failures remain (`destinationHubDriver` x2 on unmodified HEAD too; files needing `AGENT_SERVICE_DATABASE_URL` pass when it is set).

## Rollout plan (needs Jerry's approval; do before Mon Oct 19 ~22:47Z, the first follow-ups)
1. Pre-flight (read-only): confirm the shared checkout is on a branch that contains the Winston code (`git branch --contains 28bb391`), no uncommitted `agent-service/` changes; note monitor PID.
2. Overlap preflight, then fast-forward `winston/resilience` into the shared checkout's branch (never switch branches there).
3. `launchctl kickstart -k gui/$(id -u)/com.checkoff.chief-monitor`. Optionally set `AGENT_DB_POOL_MAX=3` (default already 3).
4. Verify (no sends): monitor log shows `starting`; `pg_stat_activity` shows `application_name = winston-agent-service` with <= 3 connections, idle ones disappearing after ~10s; `verifyBizDevReadOnly.ts --now 2026-10-16T19:20:00Z` still plans exactly Blair Follow-Up 1; err log quiet.
5. Do not run repeated full dry-run ticks back to back afterwards (they spend the same Gmail quota).
6. Watch the first real follow-up window (Oct 19 22:47Z): expect `sent step 2` lines; a `gmail: rate limit ... deferred` line is normal and self-heals next tick (<= 15 min).

**Rollback:** `git revert` the merge commit (or reset the branch pointer to the previous commit, which only this patch touches) and kickstart. No schema, data or token changes are involved.

**Residual risks:** the Mac sleeping delays ticks regardless; the Resend free tier 100/day shared cap is unchanged; a sustained Gmail outage defers follow-ups indefinitely (visible via the summary line and the existing health alert on repeated tick errors only if errors persist, since deferrals are not errors).
