import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { canEditTripMode, buildTripModeUpdate, tripModeChoiceCopy, tripModeOffWarning, TRIP_MODE_CHOICE_COPY } from './listTripModeSetting.js'

const owner = 'u1'
const list = { creator_id: owner, is_official: false, source_destination_list_id: null }

test('only the creator of a non-official, non-destination list can edit Trip Mode', () => {
  assert.equal(canEditTripMode({ listMeta: list, userId: owner }), true)
  assert.equal(canEditTripMode({ listMeta: list, userId: 'someone-else' }), false)
  assert.equal(canEditTripMode({ listMeta: list, userId: null }), false)
  assert.equal(canEditTripMode({ listMeta: null, userId: owner }), false)
  assert.equal(canEditTripMode({ listMeta: { ...list, is_official: true }, userId: owner }), false)
  assert.equal(canEditTripMode({ listMeta: { ...list, source_destination_list_id: 'd1' }, userId: owner }), false)
})

test('update payload is a strict boolean (undefined/garbage never enables Trip Mode)', () => {
  assert.deepEqual(buildTripModeUpdate(true), { trip_mode_enabled: true })
  for (const v of [false, undefined, null, 'true', 1]) assert.deepEqual(buildTripModeUpdate(v), { trip_mode_enabled: false })
})

test('plain-language copy matches the product wording and switches with the choice', () => {
  assert.match(tripModeChoiceCopy(true), /manually add experiences they did during the trip/)
  assert.match(tripModeChoiceCopy(false), /normal rule applies/)
  assert.equal(tripModeChoiceCopy(true), TRIP_MODE_CHOICE_COPY.trip)
  assert.match(tripModeOffWarning(), /already added stays checked off/)
})

test('create screen and list editor both use the shared payload + copy (no drifting copies)', () => {
  const create = fs.readFileSync(new URL('../screens/CreateListScreen.jsx', import.meta.url), 'utf8')
  const editor = fs.readFileSync(new URL('../components/ListTripModeSetting.jsx', import.meta.url), 'utf8')
  const listScreen = fs.readFileSync(new URL('../screens/ListScreen.jsx', import.meta.url), 'utf8')
  assert.equal(create.match(/\.\.\.buildTripModeUpdate\(tripModeEnabled\)/g).length, 3, 'all three create/adopt insert+update paths')
  assert.ok(!/trip_mode_enabled:\s*tripModeEnabled/.test(create))
  assert.ok(editor.includes('buildTripModeUpdate(next)') && editor.includes(".eq('creator_id', userId)"))
  assert.ok(listScreen.includes('canEditTripMode({ listMeta, userId: currentUserId })') && listScreen.includes('creator_id'))
})
