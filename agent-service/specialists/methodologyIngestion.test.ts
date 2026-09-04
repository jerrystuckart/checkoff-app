import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ingestMethodology, computeContentHash, verifyMethodologyIntegrity, MethodologyAlreadyCompleteError } from './methodologyIngestion'

function withTempRepoRoot(run: (repoRoot: string) => void): void {
  const repoRoot = mkdtempSync(join(tmpdir(), 'chief-methodology-ingest-'))
  try {
    run(repoRoot)
  } finally {
    rmSync(repoRoot, { recursive: true, force: true })
  }
}

test('ingestMethodology: copies the source file verbatim to the target path and reports a matching hash', () => {
  withTempRepoRoot((repoRoot) => {
    const sourcePath = join(repoRoot, 'source.md')
    const content = '# DVA-1 Real Instructions\n\nThis is exactly what Jerry pasted.'
    writeFileSync(sourcePath, content, 'utf8')

    const report = ingestMethodology({ sourceFilePath: sourcePath, methodologyId: 'destination/dva1', version: 'v2', providedBy: 'Jerry (test)', repoRoot })

    const written = readFileSync(report.targetPath, 'utf8')
    assert.equal(written, content, 'target file must be byte-identical to the source — never reinterpreted')
    assert.equal(report.contentHash, computeContentHash(content))
    assert.ok(report.nextSteps.some((s) => s.includes('complete: true')))
  })
})

test('ingestMethodology: refuses an empty source file', () => {
  withTempRepoRoot((repoRoot) => {
    const sourcePath = join(repoRoot, 'empty.md')
    writeFileSync(sourcePath, '   \n', 'utf8')
    assert.throws(() => ingestMethodology({ sourceFilePath: sourcePath, methodologyId: 'destination/dva1', version: 'v3', providedBy: 'test', repoRoot }), /empty/)
  })
})

test('ingestMethodology: refuses to overwrite an already-complete registered methodology without force', () => {
  withTempRepoRoot((repoRoot) => {
    const sourcePath = join(repoRoot, 'source.md')
    writeFileSync(sourcePath, 'new content', 'utf8')
    // metro_launch/v1 is registered as complete: true in methodologyRegistry.ts
    assert.throws(() => ingestMethodology({ sourceFilePath: sourcePath, methodologyId: 'metro_launch', version: 'v1', providedBy: 'test', repoRoot }), MethodologyAlreadyCompleteError)
  })
})

test('ingestMethodology: force:true allows a deliberate re-ingestion of an already-complete methodology', () => {
  withTempRepoRoot((repoRoot) => {
    const sourcePath = join(repoRoot, 'source.md')
    writeFileSync(sourcePath, 'updated metro launch methodology content', 'utf8')
    const report = ingestMethodology({ sourceFilePath: sourcePath, methodologyId: 'metro_launch', version: 'v1', providedBy: 'test', repoRoot, force: true })
    assert.equal(readFileSync(report.targetPath, 'utf8'), 'updated metro launch methodology content')
  })
})

test('ingestMethodology: an unregistered (methodologyId, version) pair is allowed (first-ever ingestion, e.g. a new DVA version)', () => {
  withTempRepoRoot((repoRoot) => {
    const sourcePath = join(repoRoot, 'source.md')
    writeFileSync(sourcePath, 'brand new methodology', 'utf8')
    assert.doesNotThrow(() => ingestMethodology({ sourceFilePath: sourcePath, methodologyId: 'destination/dva1', version: 'v2', providedBy: 'test', repoRoot }))
  })
})

// ---------------------------------------------------------------------------
// verifyMethodologyIntegrity — against the REAL repo registry/files
// ---------------------------------------------------------------------------

test('verifyMethodologyIntegrity: passes against the real repo (every current entry has contentHash: null — nothing to check yet)', () => {
  const result = verifyMethodologyIntegrity()
  assert.equal(result.valid, true)
  assert.deepEqual(result.mismatches, [])
})
