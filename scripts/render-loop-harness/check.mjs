// Real render check for the "Maximum update depth exceeded" loop in lib/useWhatsGood.js (location permission
// denied + a persisted metro => userLocation was rebuilt every render and re-triggered the selection effect).
// Renders the REAL hook source (imports rewritten to stubs) with react-test-renderer, which is NOT a repo
// dependency: it is installed into a temp dir on demand, so package.json / the runtime fingerprint are untouched.
//   node scripts/render-loop-harness/check.mjs [gitRef]     (default: the working tree)
// Exit 0 = settles (<= 10 renders); non-zero = loop (child killed by the watchdog) or too many renders.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync, readdirSync, existsSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '../..')
const ref = process.argv[2] ?? 'WORKTREE'
const work = mkdtempSync(join(tmpdir(), 'render-loop-'))
const deps = join(tmpdir(), 'checkoff-render-harness-deps')
if (!existsSync(join(deps, 'node_modules/react-test-renderer'))) {
  mkdirSync(deps, { recursive: true })
  writeFileSync(join(deps, 'package.json'), '{"name":"d","private":true}')
  const r = spawnSync('npm', ['i', '--silent', 'react-test-renderer@19.2.0', 'react@19.2.0'], { cwd: deps, stdio: 'inherit' })
  if (r.status !== 0) process.exit(2)
}
const get = f => ref === 'WORKTREE'
  ? readFileSync(join(repo, 'lib', f), 'utf8')
  : spawnSync('git', ['show', `${ref}:lib/${f}`], { cwd: repo, encoding: 'utf8' }).stdout
mkdirSync(join(work, 'lib'))
for (const f of ['proximity.js', 'distance.js', 'whatsGoodAtPlace.js', 'whatsGoodContextFingerprint.js', 'whatsGoodCoverageMode.js', 'locationFreshness.js', 'useWhatsGood.js', 'currentLocation.js']) {
  writeFileSync(join(work, 'lib', f), get(f))
}
for (const f of readdirSync(join(here, 'stubs'))) copyFileSync(join(here, 'stubs', f), join(work, 'lib', f))
const sub = (file, pairs) => {
  const p = join(work, 'lib', file); let s = readFileSync(p, 'utf8')
  for (const [a, b] of pairs) s = s.split(a).join(b)
  writeFileSync(p, s)
}
sub('useWhatsGood.js', [["'./whatsGoodOrchestrator.js'", "'./stubOrchestrator.js'"], ["'./whatsGoodDataAdapter.js'", "'./stubAdapter.js'"], ["'./atPlacePresenceTracker'", "'./stubTracker.js'"], ["'./currentLocation'", "'./currentLocation.js'"]])
sub('currentLocation.js', [["from 'react-native'", "from './stubRN.js'"], ["import * as Location from 'expo-location'", "import * as Location from './stubLocation.js'"], ["'./locationFreshness'", "'./locationFreshness.js'"]])
symlinkSync(join(deps, 'node_modules'), join(work, 'node_modules'))
writeFileSync(join(work, 'package.json'), '{"type":"module"}')
copyFileSync(join(here, 'run.mjs'), join(work, 'run.mjs'))
const res = spawnSync('node', ['run.mjs'], { cwd: work, encoding: 'utf8', timeout: 20000, killSignal: 'SIGKILL' })
if (res.error || res.status === null) { console.log(`LOOP: render never settled (ref=${ref})`); process.exit(1) }
console.log(res.stdout.trim().split('\n').pop())
const out = JSON.parse(res.stdout.trim().split('\n').pop())
if (out.renders > 10) { console.log('too many renders'); process.exit(1) }
console.log(`OK: settled in ${out.renders} renders (ref=${ref})`)
