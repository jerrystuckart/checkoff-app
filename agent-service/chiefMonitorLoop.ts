// Chief Phase 2J — the durable background loop (spec section 13).
// agent-service has no existing always-on host today: it's invoked via
// `tsx agent-service/cli.ts <command>`, run by hand or by whatever
// process supervisor Jerry chooses. This module is the LOOP itself —
// pure, injectable clock/sleep, safe to run under pm2/systemd/launchd/a
// persistent terminal — not a process supervisor. Which supervisor
// actually keeps it running across a machine restart is Jerry's own
// infrastructure decision; this codebase doesn't invent one.
//
// The loop's own job is narrow and honest: poll Gmail on an interval,
// apply whatever resume events that poll produces, never crash on one
// bad cycle, and report each tick's result to whoever's watching (a
// console logger by default, a test's own recorder in tests). Restart
// safety comes from the loop being stateless itself — all real state
// (the Gmail checkpoint, the relationship runs) lives in durable stores
// the poll function already uses; starting a fresh loop process just
// resumes reading them.

export interface MonitorTickResult {
  newMessagesFound: number
  resumeEventsEmitted: number
  ambiguousOrUnassociatedCount: number
  error: string | null
}

export interface ChiefMonitorLoopDeps {
  pollGmail: () => Promise<MonitorTickResult>
  /** Milliseconds between ticks. Phase 2J default (see DEFAULT_POLL_INTERVAL_MS) is 15 minutes — "slow, steady, inexpensive," per Jerry's explicit preference, not realtime. */
  intervalMs: number
  sleep?: (ms: number) => Promise<void>
  onTick?: (result: MonitorTickResult) => void | Promise<void>
  /** Checked before each tick — lets a test run a bounded number of iterations instead of forever. Defaults to "never stop." */
  shouldStop?: () => boolean
}

export const DEFAULT_POLL_INTERVAL_MS = 15 * 60 * 1000

/**
 * Runs until shouldStop() returns true (never, by default — a real
 * deployment runs this forever under a supervisor). A single failed tick
 * (e.g. pollGmail rejects, which it shouldn't given gmailInboundMonitor.ts's
 * own internal try/catch, but defense in depth) is caught and reported
 * via onTick as an error tick — never crashes the loop.
 */
export async function runChiefMonitorLoop(deps: ChiefMonitorLoopDeps): Promise<void> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  while (!deps.shouldStop?.()) {
    let result: MonitorTickResult
    try {
      result = await deps.pollGmail()
    } catch (err) {
      result = { newMessagesFound: 0, resumeEventsEmitted: 0, ambiguousOrUnassociatedCount: 0, error: err instanceof Error ? err.message : String(err) }
    }
    await deps.onTick?.(result)
    if (deps.shouldStop?.()) break
    await sleep(deps.intervalMs)
  }
}
