import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = f => readFileSync(join(root, f), 'utf8')

test('Hub hero is untouched (240pt, cover)', () => {
  const s = read('screens/HubScreen.jsx')
  assert.match(s, /heroWrap: \{ width: '100%', height: 240, backgroundColor: CARD \}/)
  assert.match(s, /resizeMode="cover"/)
})
test('description: two-line clamp, More/Less only on overflow, inline, resets per Hub, no nested scroll', () => {
  const c = read('components/hub/ExpandableDescription.jsx')
  assert.match(c, /COLLAPSED_LINES = 2/)
  assert.match(c, /lines\.length > COLLAPSED_LINES/)
  assert.match(c, /\{overflows && \(/)
  assert.match(c, /expanded \? 'Less' : 'More'/)
  assert.doesNotMatch(c, /ScrollView/)
  assert.match(read('screens/HubScreen.jsx'), /<ExpandableDescription key=\{destination\.id\} text=\{destination\.description\}/)
})
test('Closest rows: two-line titles, distance beneath, whole row pressable, large-text stacking, 44pt+ targets', () => {
  const c = read('components/hub/HubLocationSection.jsx')
  assert.match(c, /styles\.body, \{ color: TEXT \}\]\} numberOfLines=\{2\}/)
  assert.match(c, /onPress=\{\(\) => open\(item\)\}/)
  assert.match(c, /fontScale >= 1\.35/)
  assert.match(c, /minHeight: 56/)
})
