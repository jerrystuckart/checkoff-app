import test from 'node:test'
import assert from 'node:assert/strict'
import { copyDatesForAdoption, overlayHubSource, activeCopyFilter, progressFraction, hubListEmoji } from './hubListPresentation.js'

test('a permanent Hub list (no end date) gives its copy no dates, so no countdown can be shown', () => {
  assert.deepEqual(copyDatesForAdoption({ ends_at: null }, '2026-10-14', 2026), { starts_at: null, ends_at: null })
})
test('a seasonal Hub list keeps the legacy copy dates', () => {
  assert.deepEqual(copyDatesForAdoption({ ends_at: '2026-12-31' }, '2026-10-14', 2026), { starts_at: '2026-10-14', ends_at: '2026-12-31' })
})
test('an existing copy of a permanent Hub list shows no end date and takes the source artwork and title', () => {
  const copy = { id: 'c', title: 'Willcox Essentials', starts_at: '2026-10-13', ends_at: '2026-12-31', hero_image_url: null, source_destination_list_id: 'd' }
  const src = { title: 'Willcox Essentials', starts_at: null, ends_at: null, hero_image_url: 'https://x/hero.png', cover_emoji: '⭐' }
  const out = overlayHubSource(copy, src)
  assert.deepEqual([out.ends_at, out.starts_at, out.hero_image_url, out.isPermanentHubList], [null, null, 'https://x/hero.png', true])
})
test('a copy of a seasonal Hub list keeps its own dates (countdown unchanged)', () => {
  const copy = { title: 'Positano Essentials', starts_at: '2026-09-27', ends_at: '2026-12-31', hero_image_url: null }
  const out = overlayHubSource(copy, { title: 'Positano Essentials', ends_at: '2026-12-31', hero_image_url: 'https://x/p.png' })
  assert.deepEqual([out.starts_at, out.ends_at, out.hero_image_url, out.isPermanentHubList], ['2026-09-27', '2026-12-31', 'https://x/p.png', false])
})
test('no source means nothing changes', () => {
  const copy = { ends_at: '2026-12-31' }
  assert.equal(overlayHubSource(copy, null), copy)
})
test('revisit filter accepts a copy with no end date', () => {
  assert.equal(activeCopyFilter('2026-10-14'), 'ends_at.is.null,ends_at.gt.2026-10-14')
})
test('progress fraction is clamped', () => {
  assert.equal(progressFraction({ checked: 3, total: 12 }), 0.25)
  assert.equal(progressFraction({ checked: 5, total: 0 }), 0)
  assert.equal(progressFraction(null), 0)
  assert.equal(progressFraction({ checked: 9, total: 3 }), 1)
})
test('the Next-10 emoji is never shown on Hub lists; real emoji are', () => {
  assert.equal(hubListEmoji('🔟'), null)
  assert.equal(hubListEmoji(null), null)
  assert.equal(hubListEmoji('⭐'), '⭐')
})
