import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyGmailError, isTransientGmailError, isTransientQuotaError, retryAfterMs, withGmailRetry, GmailPacer } from './gmailResilience'
import { RealGmailAdapter } from './googleAdapters'
import { isTransientConnectError, retryOnConnectError } from '../db'

const QUOTA = `Gmail messages.list returned 403: {"error":{"code":403,"message":"Quota exceeded for quota metric 'Total Query Cost' and limit 'Total Query Cost per minute per user'"}}`

test('classification: per-minute quota is transient; daily sending limit, auth and bad requests are not', () => {
  assert.equal(classifyGmailError(QUOTA), 'QUOTA')
  assert.equal(classifyGmailError('Gmail messages.get(x) returned 429: rateLimitExceeded'), 'QUOTA')
  assert.equal(classifyGmailError('Gmail messages.list returned 403: User-rate limit exceeded. Retry after 2026-10-19T22:50:00.000Z'), 'QUOTA')
  assert.equal(classifyGmailError('Gmail messages.list returned 503: backend error'), 'TRANSIENT')
  assert.equal(classifyGmailError('getaddrinfo ENOTFOUND gmail.googleapis.com'), 'TRANSIENT')
  assert.equal(classifyGmailError('Gmail messages.send returned 403: Daily user sending quota exceeded'), 'AUTH')
  assert.equal(isTransientQuotaError('Daily user sending limit exceeded'), false)
  assert.equal(classifyGmailError('invalid_grant: Token has been expired or revoked'), 'AUTH')
  assert.equal(classifyGmailError('Gmail messages.list returned 403: Insufficient Permission'), 'AUTH')
  assert.equal(classifyGmailError('Gmail messages.get(x) returned 404: not found'), 'OTHER')
  assert.equal(isTransientGmailError(QUOTA), true)
  assert.equal(isTransientGmailError('Gmail messages.list returned 401'), false)
})

test('retryAfterMs reads Gmail\'s "Retry after <ISO>" hint and caps it', () => {
  const now = Date.parse('2026-10-19T22:00:00Z')
  assert.equal(retryAfterMs('Retry after 2026-10-19T22:00:20.000Z', now), 20_000)
  assert.equal(retryAfterMs('Retry after 2026-10-19T23:30:00.000Z', now), 60_000)
  assert.equal(retryAfterMs('Retry after 2026-10-19T21:00:00.000Z', now), null, 'already past')
  assert.equal(retryAfterMs('nothing here', now), null)
})

test('withGmailRetry: retries transient errors with growing waits, then succeeds', async () => {
  const waits: number[] = []
  let calls = 0
  const out = await withGmailRetry(async () => { if (++calls < 3) throw new Error(QUOTA); return 'ok' }, { sleep: async (ms) => { waits.push(ms) } })
  assert.equal(out, 'ok')
  assert.equal(calls, 3)
  assert.equal(waits.length, 2)
  assert.ok(waits[0] >= 2000 && waits[0] < 2300 && waits[1] >= 6000 && waits[1] < 6300, JSON.stringify(waits))
})

test('withGmailRetry: gives up after the attempt budget and throws the original error; non-transient errors are not retried', async () => {
  let calls = 0
  await assert.rejects(withGmailRetry(async () => { calls++; throw new Error(QUOTA) }, { attempts: 3, sleep: async () => {} }), /Total Query Cost/)
  assert.equal(calls, 3)
  calls = 0
  await assert.rejects(withGmailRetry(async () => { calls++; throw new Error('Gmail messages.get(x) returned 404') }, { sleep: async () => { assert.fail('must not sleep') } }), /404/)
  assert.equal(calls, 1)
})

test('GmailPacer spaces consecutive calls', async () => {
  let clock = 1000
  const waits: number[] = []
  const pacer = new GmailPacer(200, async (ms) => { waits.push(ms); clock += ms }, () => clock)
  await pacer.wait(); await pacer.wait(); await pacer.wait()
  assert.deepEqual(waits, [200, 200], 'first call is immediate; the next two are spaced')
  await new GmailPacer(0).wait() // disabled pacer never waits
})

function adapter(responses: Array<{ status: number; body: unknown }>, seen: string[] = []) {
  let i = 0
  const fetchImpl = (async (url: string) => {
    seen.push(String(url))
    const r = responses[Math.min(i++, responses.length - 1)]
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body, text: async () => JSON.stringify(r.body) } as unknown as Response
  }) as unknown as typeof fetch
  return new RealGmailAdapter({ accessToken: 't', fetchImpl, minIntervalMs: 0, retry: { sleep: async () => {}, baseDelayMs: 1 } })
}

test('RealGmailAdapter reads survive a transient quota 403 and a 503 (retried), and return the data', async () => {
  const seen: string[] = []
  const g = adapter([{ status: 403, body: { error: { message: "Quota exceeded for quota metric 'Total Query Cost'" } } }, { status: 503, body: {} }, { status: 200, body: { messages: [{ id: 'a', threadId: 't' }] } }], seen)
  assert.deepEqual(await g.searchMessageIds('x'), [{ id: 'a', threadId: 't' }])
  assert.equal(seen.length, 3)
})

test('RealGmailAdapter does not retry real permission/auth errors', async () => {
  const seen: string[] = []
  const g = adapter([{ status: 403, body: { error: { message: 'Insufficient Permission' } } }], seen)
  await assert.rejects(g.searchMessageIds('x'), /returned 403/)
  assert.equal(seen.length, 1)
})

test('RealGmailAdapter never retries a SEND', async () => {
  const seen: string[] = []
  const g = adapter([{ status: 429, body: { error: { message: 'rateLimitExceeded' } } }], seen)
  await assert.rejects(g.sendMessage({ to: 'a@b.co', from: 'jerry@getcheckoff.com', subject: 's', bodyText: 'b' }), /messages\.send returned 429/)
  assert.equal(seen.length, 1, 'one attempt only')
})

test('db: connection-slot exhaustion and DNS/refused errors are connect-phase transient; SQL errors are not', async () => {
  assert.equal(isTransientConnectError(Object.assign(new Error('remaining connection slots are reserved for roles with the SUPERUSER attribute'), { code: '53300' })), true)
  assert.equal(isTransientConnectError(new Error('getaddrinfo ENOTFOUND aws-1-us-west-2.pooler.supabase.com')), true)
  assert.equal(isTransientConnectError(Object.assign(new Error('x'), { code: '57P03' })), true)
  assert.equal(isTransientConnectError(Object.assign(new Error('permission denied for table cities'), { code: '42501' })), false)
  assert.equal(isTransientConnectError(Object.assign(new Error('syntax error'), { code: '42601' })), false)
  const waits: number[] = []
  let n = 0
  const v = await retryOnConnectError(async () => { if (++n < 3) throw Object.assign(new Error('slots'), { code: '53300' }); return 7 }, { sleep: async (ms) => { waits.push(ms) }, baseMs: 10 })
  assert.equal(v, 7)
  assert.equal(waits.length, 2)
  let m = 0
  await assert.rejects(retryOnConnectError(async () => { m++; throw Object.assign(new Error('permission denied'), { code: '42501' }) }, { sleep: async () => {} }), /permission denied/)
  assert.equal(m, 1, 'a SQL error is never retried')
  await assert.rejects(retryOnConnectError(async () => { throw Object.assign(new Error('slots'), { code: '53300' }) }, { attempts: 2, sleep: async () => {} }), /slots/)
})
