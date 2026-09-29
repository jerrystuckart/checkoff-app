import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeEmptyInbox } from './inboxEmptyState.js'

test('not opted in -> tells the user to turn recovery on in Profile', () => {
  const s = describeEmptyInbox({ optedIn: false, hasBackgroundPermission: false })
  assert.match(s.body, /Turn on visit recovery in Profile/)
  assert.equal(s.action, 'open_profile')
})

test('opted in with permission -> never tells the user to turn it on (the misleading-copy bug)', () => {
  const s = describeEmptyInbox({ optedIn: true, hasBackgroundPermission: true })
  assert.doesNotMatch(`${s.title} ${s.body}`, /turn on/i)
  assert.match(s.title, /is on/i)
  assert.equal(s.action, null)
})

test('opted in but without Always location -> points at Settings, not Profile', () => {
  const s = describeEmptyInbox({ optedIn: true, hasBackgroundPermission: false })
  assert.match(s.body, /Always/)
  assert.equal(s.action, 'open_settings')
  assert.doesNotMatch(s.body, /Turn on visit recovery/i)
})
