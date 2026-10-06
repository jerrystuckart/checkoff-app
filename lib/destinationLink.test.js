// checkoff://destination/<id> opens the Destination Hub (target of getcheckoff.com/willcox).
// Run with: node --test lib/destinationLink.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { LINKING_CONFIG } from './linkingConfig.js'
import { normalizeLinkPath } from './emailLinkContract.js'

const require = createRequire(import.meta.url)
const { getStateFromPath } = require('@react-navigation/core')
const WILLCOX = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'

function leaf(path) {
  let s = getStateFromPath(normalizeLinkPath(path), LINKING_CONFIG)
  while (s?.routes?.[s.routes.length - 1]?.state) s = s.routes[s.routes.length - 1].state
  return s?.routes?.[s.routes.length - 1]
}

test('destination link opens Hub with the destination id, UTM params do not break it', () => {
  for (const p of [`destination/${WILLCOX}`, `/destination/${WILLCOX}?utm_source=business&utm_medium=qr&utm_campaign=willcox_launch_2026`]) {
    const r = leaf(p)
    assert.equal(r.name, 'Hub')
    assert.equal(r.params.destinationId, WILLCOX)
  }
})
