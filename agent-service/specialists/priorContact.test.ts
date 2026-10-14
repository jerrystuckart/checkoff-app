import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeEmail, normalizeBusiness, PriorContactIndex, describeConflicts, type ContactedRecord } from './priorContact'

test('email normalization: case, +tags, Gmail dots and googlemail fold together; other providers keep their dots', () => {
  assert.equal(normalizeEmail('  Owner@Cafe.COM '), 'owner@cafe.com')
  assert.equal(normalizeEmail('owner+checkoff@cafe.com'), 'owner@cafe.com')
  assert.equal(normalizeEmail('Jerry.Stuckart+canaryb@gmail.com'), 'jerrystuckart@gmail.com')
  assert.equal(normalizeEmail('jerry.stuckart@googlemail.com'), 'jerrystuckart@gmail.com')
  assert.equal(normalizeEmail('first.last@brewery.com'), 'first.last@brewery.com', 'dots only fold for Gmail')
  assert.equal(normalizeEmail('mailto:Hello@x.org'), 'hello@x.org')
})

test('business normalization: case, accents, apostrophes, ampersands, leading "the", legal suffixes', () => {
  const same = (a: string, b: string) => assert.equal(normalizeBusiness(a), normalizeBusiness(b), `${a} == ${b}`)
  same("Seroogy’s Chocolate Shop", "seroogys chocolate shop")
  same('The Fox & Hound, LLC', 'Fox and Hound')
  same('Café Müller Inc.', 'Cafe Muller')
  same('920 Sauna Co', '920 sauna co.')
  assert.notEqual(normalizeBusiness('Vintage Cantina'), normalizeBusiness('Vintage Rose Bakery'))
  assert.equal(normalizeBusiness('The LLC'), 'llc', 'a name made only of suffix words is not erased')
  assert.equal(normalizeBusiness(''), '')
})

const REC: ContactedRecord[] = [
  { via: 'winston', ref: 'task-1', email: 'Info@Badger.com', businessName: 'Badger State Brewing, LLC', itemIds: ['AAAA-1'], messageIds: ['m1'] },
  { via: 'gmail', ref: 'gmail:g9', email: 'old@legacy.com', messageIds: ['g9'] },
]

test('every key matches independently, so a change in one cannot hide a prior contact', () => {
  const idx = new PriorContactIndex(REC)
  assert.deepEqual(idx.check({ email: 'info+x@badger.com' }).map((c) => c.key), ['email'], 'email via +tag')
  assert.deepEqual(idx.check({ email: 'someone@else.com', businessName: 'The Badger State Brewing' }).map((c) => c.key), ['business'], 'business via name variant')
  assert.deepEqual(idx.check({ email: 'someone@else.com', itemIds: ['aaaa-1'] }).map((c) => c.key), ['item'], 'item id, case-insensitive')
  assert.deepEqual(idx.check({ email: 'someone@else.com', messageIds: ['m1'] }).map((c) => c.key), ['message_id'], 'gmail message id')
  assert.deepEqual(idx.check({ email: 'old@legacy.com' }).map((c) => [c.key, c.via]), [['email', 'gmail']], 'gmail history counts')
  const all = idx.check({ email: 'info@badger.com', businessName: 'Badger State Brewing', itemIds: ['AAAA-1'], messageIds: ['m1'] })
  assert.deepEqual(all.map((c) => c.key).sort(), ['business', 'email', 'item', 'message_id'])
  assert.match(describeConflicts(all), /email "info@badger.com" already contacted \(winston task-1\)/)
})

test('no match, an empty business name, and ignoring the candidate\'s own record', () => {
  const idx = new PriorContactIndex(REC)
  assert.deepEqual(idx.check({ email: 'new@place.com', businessName: 'Totally New Place', itemIds: ['zzz'] }), [])
  assert.deepEqual(idx.check({ email: 'new@place.com', businessName: '' }), [], 'blank names never match each other')
  assert.deepEqual(idx.check({ email: 'info@badger.com' }, { ignoreRef: 'task-1' }), [])
})
