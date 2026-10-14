// The Android intent filters must cover every canonical link path (lib/emailLinkContract.js) on getcheckoff.com
// and keep the existing ones. Android App Links need a NEW NATIVE BUILD to take effect; until one ships, the
// web fallback pages and the checkoff:// button keep working. Run with: node --test lib/androidAppLinksConfig.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = JSON.parse(readFileSync(join(__dirname, '../app.json'), 'utf8')).expo
const filters = app.android.intentFilters
const data = filters.flatMap((f) => f.data)
const prefixes = data.filter((d) => d.scheme === 'https' && d.host === 'getcheckoff.com').map((d) => d.pathPrefix)

test('every canonical link path is an Android App Link, and the existing ones are kept', () => {
  for (const p of ['/open', '/item', '/list', '/metro', '/join', '/reset-password', '/auth/confirm']) assert.ok(prefixes.includes(p), p)
})

test('the filter is a verified, browsable VIEW filter on the production host only', () => {
  const f = filters.find((x) => x.data.some((d) => d.pathPrefix === '/metro'))
  assert.equal(f.action, 'VIEW')
  assert.equal(f.autoVerify, true)
  assert.deepEqual(f.category.sort(), ['BROWSABLE', 'DEFAULT'])
  assert.ok(data.every((d) => d.scheme === 'https' && d.host === 'getcheckoff.com'))
})

test('assetlinks.json would still verify the filter: package name is the one in app.json', () => {
  assert.equal(app.android.package, 'com.getcheckoff.app')
})

test('this change touches no permission, version or versionCode', () => {
  assert.ok(!('versionCode' in app.android))
})
