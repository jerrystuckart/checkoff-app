import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RealGmailAdapter, RealGoogleCalendarAdapter, RealGoogleContactsAdapter } from './googleAdapters'

test('RealGmailAdapter: isConfigured() is false without an access token — same honest gating as the AI adapters', () => {
  const adapter = new RealGmailAdapter({ accessToken: undefined })
  assert.equal(adapter.isConfigured(), false)
})

test('RealGmailAdapter: isConfigured() is true once an access token is supplied', () => {
  const adapter = new RealGmailAdapter({ accessToken: 'fake-token' })
  assert.equal(adapter.isConfigured(), true)
})

test('RealGmailAdapter: searchMessages() throws rather than silently returning [] when unconfigured', async () => {
  const adapter = new RealGmailAdapter({ accessToken: undefined })
  await assert.rejects(() => adapter.searchMessages('anything'))
})

test('RealGmailAdapter: searchMessages() lists then fetches metadata for each message, returning real header data', async () => {
  const calls: string[] = []
  const fakeFetch = (async (url: unknown) => {
    const u = String(url)
    calls.push(u)
    if (u.includes('/messages?q=')) {
      return new Response(JSON.stringify({ messages: [{ id: 'm1', threadId: 't1' }] }), { status: 200 })
    }
    return new Response(
      JSON.stringify({ id: 'm1', threadId: 't1', snippet: 'Hi there', payload: { headers: [{ name: 'From', value: 'jane@example.com' }, { name: 'To', value: 'chief@checkoff.app' }, { name: 'Subject', value: 'Re: Hood River' }, { name: 'Date', value: '2026-09-08' }] } }),
      { status: 200 }
    )
  }) as unknown as typeof fetch
  const adapter = new RealGmailAdapter({ accessToken: 'fake-token', fetchImpl: fakeFetch })
  const results = await adapter.searchMessages('Hood River')
  assert.equal(results.length, 1)
  assert.equal(results[0].from, 'jane@example.com')
  assert.equal(results[0].subject, 'Re: Hood River')
  assert.ok(calls[0].includes('/messages?q='))
})

test('RealGmailAdapter: createDraft() posts a base64url-encoded RFC2822 message, never sends', async () => {
  let capturedUrl = ''
  let capturedBody: { message?: { raw?: string } } | undefined
  const fakeFetch = (async (url: unknown, init?: { body?: string }) => {
    capturedUrl = String(url)
    capturedBody = JSON.parse(init!.body as string)
    return new Response(JSON.stringify({ id: 'draft-1' }), { status: 200 })
  }) as unknown as typeof fetch
  const adapter = new RealGmailAdapter({ accessToken: 'fake-token', fetchImpl: fakeFetch })
  const result = await adapter.createDraft({ to: 'jane@example.com', subject: 'Hello', bodyText: 'Hi Jane' })
  assert.equal(result.draftId, 'draft-1')
  assert.match(capturedUrl, /\/drafts$/)
  assert.ok(capturedBody?.message?.raw)
  const decoded = Buffer.from(capturedBody!.message!.raw!.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
  assert.match(decoded, /To: jane@example.com/)
  assert.match(decoded, /Hi Jane/)
})

test('RealGmailAdapter: sendMessage() posts to messages/send — a real capability, but the driver must gate calling it behind Jerry approval', async () => {
  let capturedUrl = ''
  const fakeFetch = (async (url: unknown) => {
    capturedUrl = String(url)
    return new Response(JSON.stringify({ id: 'msg-1' }), { status: 200 })
  }) as unknown as typeof fetch
  const adapter = new RealGmailAdapter({ accessToken: 'fake-token', fetchImpl: fakeFetch })
  const result = await adapter.sendMessage({ to: 'jane@example.com', subject: 'Hello', bodyText: 'Hi Jane' })
  assert.equal(result.messageId, 'msg-1')
  assert.match(capturedUrl, /\/messages\/send$/)
})

test('RealGoogleCalendarAdapter: isConfigured() is false without an access token', () => {
  assert.equal(new RealGoogleCalendarAdapter({ accessToken: undefined }).isConfigured(), false)
})

test('RealGoogleCalendarAdapter: freeBusy() posts and returns real busy windows', async () => {
  const fakeFetch = (async () => new Response(JSON.stringify({ calendars: { 'jerry@checkoff.app': { busy: [{ start: '2026-09-09T17:00:00Z', end: '2026-09-09T17:30:00Z' }] } } }), { status: 200 })) as unknown as typeof fetch
  const adapter = new RealGoogleCalendarAdapter({ accessToken: 'fake-token', fetchImpl: fakeFetch })
  const busy = await adapter.freeBusy('jerry@checkoff.app', '2026-09-09T00:00:00Z', '2026-09-16T00:00:00Z')
  assert.equal(busy.length, 1)
  assert.equal(busy[0].startIso, '2026-09-09T17:00:00Z')
})

test('RealGoogleCalendarAdapter: createEvent() throws rather than silently no-opping when unconfigured', async () => {
  const adapter = new RealGoogleCalendarAdapter({ accessToken: undefined })
  await assert.rejects(() => adapter.createEvent('jerry@checkoff.app', { summary: 's', description: 'd', startIso: '2026-09-09T17:00:00Z', endIso: '2026-09-09T17:30:00Z', attendeeEmails: [] }))
})

test('RealGoogleContactsAdapter: isConfigured() is false without an access token', () => {
  assert.equal(new RealGoogleContactsAdapter({ accessToken: undefined }).isConfigured(), false)
})

test('RealGoogleContactsAdapter: searchContacts() returns real contact summaries', async () => {
  const fakeFetch = (async () =>
    new Response(JSON.stringify({ results: [{ person: { resourceName: 'people/c1', names: [{ displayName: 'Jane Doe' }], emailAddresses: [{ value: 'jane@example.com' }], organizations: [{ name: 'Hood River Chamber' }] } }] }), { status: 200 })) as unknown as typeof fetch
  const adapter = new RealGoogleContactsAdapter({ accessToken: 'fake-token', fetchImpl: fakeFetch })
  const results = await adapter.searchContacts('Jane')
  assert.equal(results.length, 1)
  assert.equal(results[0].displayName, 'Jane Doe')
  assert.equal(results[0].organization, 'Hood River Chamber')
})
