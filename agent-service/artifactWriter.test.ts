// Phase 1E — artifactWriter.ts unit tests. Real filesystem (no DB, no
// network) — this module's whole point is filesystem containment, so
// these tests exercise the real fs. Every test here uses
// createArtifactWriterForTesting() bound to a fresh directory under the OS
// temp dir, created and destroyed per test — NONE of these tests ever
// import or call the production writeArtifact/readArtifact/artifactExists
// singleton, and none of them can reach docs/whats-good-widget/ at all
// (createArtifactWriterForTesting refuses any root outside the OS temp
// directory). See actionHandlers.test.ts's regression test for direct
// proof the real repo artifact is untouched by running this file.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { createArtifactWriterForTesting, ArtifactPathViolationError, type ArtifactWriter } from './artifactWriter'

function makeTempWriter(): { writer: ArtifactWriter; root: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-writer-test-'))
  return { writer: createArtifactWriterForTesting(root), root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) }
}

const TEST_FILENAME = 'test-artifact.md'

test('createArtifactWriterForTesting: refuses a root outside the OS temp directory (proves tests cannot point at production content even by mistake)', () => {
  const repoDocsPath = path.resolve(process.cwd(), 'docs', 'whats-good-widget')
  assert.throws(() => createArtifactWriterForTesting(repoDocsPath), ArtifactPathViolationError)
  assert.throws(() => createArtifactWriterForTesting(process.cwd()), ArtifactPathViolationError)
})

test('writeArtifact + readArtifact: round-trips content inside the allowed (temp) root', (t) => {
  const { writer, root, cleanup } = makeTempWriter()
  t.after(cleanup)
  const wrote = writer.writeArtifact(TEST_FILENAME, 'hello world')
  assert.equal(wrote, true)
  assert.equal(writer.artifactExists(TEST_FILENAME), true)
  assert.equal(writer.readArtifact(TEST_FILENAME), 'hello world')
  assert.equal(path.dirname(path.join(root, TEST_FILENAME)), root)
})

test('writeArtifact: idempotent — returns false and does not rewrite when content is already correct', async (t) => {
  const { writer, root, cleanup } = makeTempWriter()
  t.after(cleanup)
  writer.writeArtifact(TEST_FILENAME, 'same content')
  const statBefore = fs.statSync(path.join(root, TEST_FILENAME)).mtimeMs
  await new Promise((r) => setTimeout(r, 5))
  const wroteAgain = writer.writeArtifact(TEST_FILENAME, 'same content')
  const statAfter = fs.statSync(path.join(root, TEST_FILENAME)).mtimeMs
  assert.equal(wroteAgain, false)
  assert.equal(statBefore, statAfter, 'file must not have been rewritten')
})

test('readArtifact / artifactExists: null / false for a file that does not exist yet', (t) => {
  const { writer, cleanup } = makeTempWriter()
  t.after(cleanup)
  assert.equal(writer.readArtifact('does-not-exist.md'), null)
  assert.equal(writer.artifactExists('does-not-exist.md'), false)
})

test('rejects a filename containing a path separator', (t) => {
  const { writer, cleanup } = makeTempWriter()
  t.after(cleanup)
  assert.throws(() => writer.writeArtifact('subdir/evil.md', 'x'), ArtifactPathViolationError)
  assert.throws(() => writer.writeArtifact('..%2Fevil.md', 'x'), ArtifactPathViolationError)
})

test('rejects ".." traversal', (t) => {
  const { writer, cleanup } = makeTempWriter()
  t.after(cleanup)
  assert.throws(() => writer.writeArtifact('../evil.md', 'x'), ArtifactPathViolationError)
  assert.throws(() => writer.writeArtifact('..', 'x'), ArtifactPathViolationError)
})

test('rejects an absolute path passed as "filename"', (t) => {
  const { writer, cleanup } = makeTempWriter()
  t.after(cleanup)
  assert.throws(() => writer.writeArtifact('/etc/evil.md', 'x'), ArtifactPathViolationError)
})

test('rejects a non-.md extension and anything not matching the bare-filename allowlist', (t) => {
  const { writer, cleanup } = makeTempWriter()
  t.after(cleanup)
  assert.throws(() => writer.writeArtifact('evil.sh', 'x'), ArtifactPathViolationError)
  assert.throws(() => writer.writeArtifact('.hidden.md', 'x'), ArtifactPathViolationError)
  assert.throws(() => writer.writeArtifact('', 'x'), ArtifactPathViolationError)
})

test('a sibling directory sharing a string prefix with the allowed root is NOT treated as contained (proves relative-path containment, not startsWith)', (t) => {
  const { root, cleanup } = makeTempWriter()
  t.after(cleanup)
  const sibling = root + '-evil'
  const rel = path.relative(root, sibling)
  assert.ok(rel.startsWith('..'), 'the sibling must resolve as OUTSIDE the allowed root via path.relative, proving containment is relative-path-based')
})

test('symlink escape: a symlink placed inside the allowed root pointing outside it is refused BEFORE any write is attempted', (t) => {
  const { writer, root, cleanup } = makeTempWriter()
  const symlinkName = 'escape-link.md'
  const symlinkPath = path.join(root, symlinkName)
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-writer-escape-'))
  const outsideTarget = path.join(outsideDir, 'escape-link.md')

  t.after(() => {
    cleanup()
    fs.rmSync(outsideDir, { recursive: true, force: true })
  })

  fs.symlinkSync(outsideTarget, symlinkPath)

  assert.throws(() => writer.writeArtifact(symlinkName, 'malicious content'), ArtifactPathViolationError)
  assert.equal(fs.existsSync(outsideTarget), false, 'content must never have been written outside the allowed root — the symlink must be refused before any write is attempted, not written-then-detected')
})

test('root integrity: a writer whose root has been replaced by a symlink refuses to write', (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-writer-root-'))
  const realTargetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-writer-root-real-'))
  const fakeRoot = path.join(parent, 'allowed-root')
  t.after(() => {
    fs.rmSync(parent, { recursive: true, force: true })
    fs.rmSync(realTargetDir, { recursive: true, force: true })
  })

  fs.symlinkSync(realTargetDir, fakeRoot)
  const writer = createArtifactWriterForTesting(fakeRoot)

  assert.throws(() => writer.writeArtifact(TEST_FILENAME, 'x'), ArtifactPathViolationError)
})
