// Single-flight coordination of coverage refreshes. Several triggers can fire at once (a burst of geofence callbacks,
// a foreground event, a manual refresh): exactly one refresh runs at a time; requests that arrive meanwhile are
// coalesced into ONE follow-up run (not one per request), so the registered set is never replaced concurrently and
// never re-registered redundantly.
export function createRefreshCoordinator(run) {
  let inflight = null
  let queuedCause = null
  async function loop(cause) {
    let result = await run(cause)
    while (queuedCause) {
      const next = queuedCause
      queuedCause = null
      result = await run(next)
    }
    return result
  }
  return {
    request(cause) {
      if (inflight) {
        queuedCause = queuedCause ?? cause // first queued cause wins; the rest are coalesced
        return inflight
      }
      inflight = loop(cause).finally(() => { inflight = null })
      return inflight
    },
    isRunning() { return inflight != null },
  }
}
