import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runChiefMonitorLoop, DEFAULT_POLL_INTERVAL_MS, type MonitorTickResult } from './chiefMonitorLoop'

function okTick(): MonitorTickResult {
  return { newMessagesFound: 0, resumeEventsEmitted: 0, ambiguousOrUnassociatedCount: 0, error: null }
}

test('DEFAULT_POLL_INTERVAL_MS: matches the requested ~15 minute low-speed default', () => {
  assert.equal(DEFAULT_POLL_INTERVAL_MS, 15 * 60 * 1000)
})

test('runChiefMonitorLoop: ticks the configured number of times, sleeping between each, then stops cleanly', async () => {
  let tickCount = 0
  const sleepCalls: number[] = []
  await runChiefMonitorLoop({
    pollGmail: async () => {
      tickCount++
      return okTick()
    },
    intervalMs: 1000,
    sleep: async (ms) => {
      sleepCalls.push(ms)
    },
    shouldStop: () => tickCount >= 3,
  })
  assert.equal(tickCount, 3)
  assert.equal(sleepCalls.length, 2, 'sleeps between ticks, not after the final one')
  assert.ok(sleepCalls.every((ms) => ms === 1000))
})

test('runChiefMonitorLoop: a poll that throws never crashes the loop — reported as an error tick and the loop continues', async () => {
  let tickCount = 0
  const results: MonitorTickResult[] = []
  await runChiefMonitorLoop({
    pollGmail: async () => {
      tickCount++
      if (tickCount === 1) throw new Error('Gmail API returned 503')
      return okTick()
    },
    intervalMs: 10,
    sleep: async () => {},
    onTick: (result) => {
      results.push(result)
    },
    shouldStop: () => tickCount >= 2,
  })
  assert.equal(results.length, 2)
  assert.match(results[0].error ?? '', /503/)
  assert.equal(results[1].error, null, 'the SECOND tick succeeds — one bad poll does not kill the loop')
})

test('runChiefMonitorLoop: simulated restart — a fresh loop invocation against the SAME underlying poll state resumes cleanly, no double-processing', async () => {
  // pollGmail here simulates a durable checkpoint: state persists across
  // separate runChiefMonitorLoop() calls exactly like a real restart
  // reading the same checkpoint file/DB row.
  const processedMessageIds = new Set<string>()
  const inbox = ['msg-1', 'msg-2']
  const resumed: string[] = []

  const pollGmail = async (): Promise<MonitorTickResult> => {
    let emitted = 0
    for (const id of inbox) {
      if (processedMessageIds.has(id)) continue
      processedMessageIds.add(id)
      resumed.push(id)
      emitted++
    }
    return { newMessagesFound: emitted, resumeEventsEmitted: emitted, ambiguousOrUnassociatedCount: 0, error: null }
  }

  // "Run 1" — processes both messages, then the process "crashes"/stops.
  let ranOnce = false
  await runChiefMonitorLoop({ pollGmail, intervalMs: 1, sleep: async () => {}, onTick: () => { ranOnce = true }, shouldStop: () => ranOnce })
  assert.deepEqual(resumed, ['msg-1', 'msg-2'])

  // "Run 2" — a brand-new loop invocation (as if the process restarted), same underlying checkpoint state.
  ranOnce = false
  await runChiefMonitorLoop({ pollGmail, intervalMs: 1, sleep: async () => {}, onTick: () => { ranOnce = true }, shouldStop: () => ranOnce })
  assert.deepEqual(resumed, ['msg-1', 'msg-2'], 'no message is resumed twice across the simulated restart')
})

test('runChiefMonitorLoop: shouldStop() checked before the FIRST tick means zero polls run', async () => {
  let tickCount = 0
  await runChiefMonitorLoop({
    pollGmail: async () => {
      tickCount++
      return okTick()
    },
    intervalMs: 10,
    sleep: async () => {},
    shouldStop: () => true,
  })
  assert.equal(tickCount, 0)
})
