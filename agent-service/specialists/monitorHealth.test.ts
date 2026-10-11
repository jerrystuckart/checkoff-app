import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyOutcome, recordTick, classifyError, alertText, ALERT_THRESHOLD, type HealthState, type HealthStore, type HealthChannel, type ChannelState } from './monitorHealth'

class MemHealth implements HealthStore {
  saves = 0
  state: HealthState = { channels: {} }
  alerts: Array<{ id: string; channel: HealthChannel; text: string; open: boolean }> = []
  async load() { return JSON.parse(JSON.stringify(this.state)) as HealthState }
  async save(s: HealthState) { this.saves++; this.state = JSON.parse(JSON.stringify(s)) }
  async openAlert(channel: HealthChannel, c: ChannelState) {
    const id = `alert${this.alerts.length + 1}`
    this.alerts.push({ id, channel, text: alertText(channel, c).jerryRequest, open: true })
    return id
  }
  async resolveAlert(id: string) { const a = this.alerts.find((x) => x.id === id)!; a.open = false }
}

const AUTH = 'Google refresh token was rejected — authorization has likely been revoked or expired. invalid_grant'
const t = (n: number) => new Date(Date.UTC(2026, 9, 12, 15, 15 * n))

test('classification: authorization failures are distinguished from other poll failures', () => {
  assert.equal(classifyError(AUTH), 'gmail_auth')
  assert.equal(classifyError('fetch failed: ECONNRESET'), 'gmail_poll')
})

test('counters: failures accumulate, one success resets, and the alert fires exactly once at the threshold', () => {
  let s: HealthState = { channels: {} }
  const actions: string[] = []
  for (let i = 1; i <= ALERT_THRESHOLD + 2; i++) {
    const r = applyOutcome(s, 'gmail_auth', false, t(i), AUTH)
    s = r.state
    if (r.action === 'OPEN_ALERT') { actions.push(`open@${i}`); s.channels.gmail_auth!.alertTaskId = 'a1' }
  }
  assert.deepEqual(actions, [`open@${ALERT_THRESHOLD}`])
  assert.equal(s.channels.gmail_auth!.consecutive, ALERT_THRESHOLD + 2)
  assert.equal(applyOutcome(s, 'gmail_auth', true, t(9)).action, 'RESOLVE_ALERT')
  const noAlert = applyOutcome({ channels: { gmail_poll: { consecutive: 2 } } }, 'gmail_poll', true, t(1))
  assert.equal(noAlert.action, 'NONE')
  assert.equal(noAlert.state.channels.gmail_poll!.consecutive, 0)
})

test('repeated Gmail auth failures open ONE NEEDS_JERRY alert with the exact repair steps; recovery resolves it', async () => {
  const store = new MemHealth()
  for (let i = 1; i <= 6; i++) await recordTick(store, { pollError: AUTH, bizdevErrors: [] }, t(i))
  assert.equal(store.alerts.length, 1)
  assert.equal(store.alerts[0].channel, 'gmail_auth')
  assert.match(store.alerts[0].text, /googleAuthorize\.ts/)
  assert.match(store.alerts[0].text, /REPLACE \(do not append\)/)
  assert.match(store.alerts[0].text, /In production/)
  const actions = await recordTick(store, { pollError: null, bizdevErrors: [] }, t(7))
  assert.deepEqual(actions, ['resolved health alert for gmail_auth'])
  assert.equal(store.alerts[0].open, false)
  // survives a "restart": state comes back from the store, not memory
  const again = await recordTick(store, { pollError: null, bizdevErrors: [] }, t(8))
  assert.deepEqual(again, [])
})

test('sending failures and campaign auto-pauses open a send alert; ordinary bizdev errors open a bizdev alert; they are independent', async () => {
  const store = new MemHealth()
  for (let i = 1; i <= 3; i++) await recordTick(store, { pollError: null, bizdevErrors: ['campaign:gb: PAUSED — Sender-configuration bounce: 535'] }, t(i))
  assert.deepEqual(store.alerts.map((a) => a.channel), ['send'])
  assert.match(store.alerts[0].text, /Send mail as|SMTP/)
  for (let i = 4; i <= 6; i++) await recordTick(store, { pollError: null, bizdevErrors: ['campaign:gb: scan failed: boom'] }, t(i))
  assert.deepEqual(store.alerts.map((a) => a.channel).sort(), ['bizdev', 'send'])
})

test('transient single failures do not alert', async () => {
  const store = new MemHealth()
  await recordTick(store, { pollError: 'timeout', bizdevErrors: [] }, t(1))
  await recordTick(store, { pollError: 'timeout', bizdevErrors: [] }, t(2))
  await recordTick(store, { pollError: null, bizdevErrors: [] }, t(3))
  await recordTick(store, { pollError: 'timeout', bizdevErrors: [] }, t(4))
  assert.equal(store.alerts.length, 0)
})

test('a healthy steady state writes nothing (no row rewrite every 15 minutes)', async () => {
  const store = new MemHealth()
  await recordTick(store, { pollError: null, bizdevErrors: [] }, t(1))
  const afterFirst = store.saves
  for (let i = 2; i <= 6; i++) await recordTick(store, { pollError: null, bizdevErrors: [] }, t(i))
  assert.equal(store.saves, afterFirst, 'no further writes while nothing changes')
})
