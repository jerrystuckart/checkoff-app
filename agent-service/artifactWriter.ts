// Phase 1E — the bounded filesystem-write capability. This is the
// filesystem analogue of mutations.ts: the ONLY place in agent-service
// that ever calls fs.writeFileSync/fs.openSync, deliberately narrower than
// a generic "write under docs/" helper.
//
// CONTAINMENT, not just string prefix-matching: path.resolve() +
// startsWith() alone is unsound (a sibling directory like
// "docs/whats-good-widget-evil" shares the string prefix
// "docs/whats-good-widget" without being inside it — see this module's
// test file for a proof). Real containment here has THREE layers:
//   1. Lexical: the filename must match a strict bare "name.md" allowlist
//      (no separators, no ".."), and the resolved target is re-derived
//      with path.relative(allowedRoot, target) — the correct way to ask
//      "is target inside allowedRoot" — rather than trusted as-typed.
//   2. Symlink refusal, BEFORE any write: if the target already exists and
//      is a symlink, this throws immediately without ever opening or
//      writing through it. The final write itself also uses O_NOFOLLOW so
//      even a symlink planted in the gap between the check and the write
//      cannot be followed.
//   3. Root integrity: before ever writing, the allowed root's leaf path
//      component is lstat'd directly — if it has itself been replaced by
//      a symlink to somewhere else, this refuses rather than silently
//      writing into wherever that symlink points. (Deliberately lstat on
//      the leaf, not a full lexical-vs-realpath string comparison — see
//      buildArtifactWriter's own doc for why the latter would misfire on
//      an ordinary OS-level symlink earlier in the path, like macOS's
//      /var -> /private/var.)
//
// TEST ISOLATION (added after a real incident: a handler test using the
// production writer against the real docs/whats-good-widget/ path had its
// cleanup delete the live, Jerry-approved artifact). The writer logic is
// now a private factory (buildArtifactWriter) parameterized by
// allowedRoot. Production code imports ONLY the pre-bound singleton
// functions below (writeArtifact/readArtifact/artifactExists), which are
// permanently bound to the real docs/whats-good-widget root — there is no
// parameter anywhere on those functions for a caller to supply a
// different root, so production code (actionHandlers.ts) structurally
// cannot point them elsewhere. A SEPARATE function,
// createArtifactWriterForTesting(root), builds an independent writer
// bound to a caller-supplied root — but it refuses (throws) unless that
// root resolves inside the OS temp directory, so even a testing mistake
// (accidentally passing the real docs/ path) is rejected rather than
// silently operating on production content. Tests must never import the
// production writeArtifact/readArtifact/artifactExists functions for
// anything that mutates state — see artifactWriter.test.ts and
// actionHandlers.test.ts, which use createArtifactWriterForTesting
// exclusively for anything that writes.

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

/** Bare filename only: letters/digits/underscore/hyphen, ending in .md. No path separators, no leading dot. */
const FILENAME_PATTERN = /^[a-zA-Z0-9_-]+\.md$/

export class ArtifactPathViolationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArtifactPathViolationError'
  }
}

export interface ArtifactWriter {
  writeArtifact(filename: string, content: string): boolean
  readArtifact(filename: string): string | null
  artifactExists(filename: string): boolean
  getAllowedRootForTesting(): string
}

function assertContained(root: string, target: string): void {
  const rel = path.relative(root, target)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new ArtifactPathViolationError(`Resolved path "${target}" is not contained within the allowed root "${root}"`)
  }
}

/** Writes without ever following a symlink at the target's final path component, via O_NOFOLLOW. */
function writeRegularFileNoFollow(target: string, content: string, mustAlreadyExist: boolean): void {
  const flags = mustAlreadyExist
    ? fs.constants.O_WRONLY | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW
    : fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW
  const fd = fs.openSync(target, flags, 0o644)
  try {
    fs.writeSync(fd, content, null, 'utf8')
  } finally {
    fs.closeSync(fd)
  }
}

/**
 * The actual writer logic, parameterized by allowedRoot. Private — never
 * exported directly, only via the bound singleton below or the guarded
 * testing factory.
 *
 * Root-integrity note: this checks whether the LEAF `allowedRoot` path
 * itself is a symlink (fs.lstatSync, never fs.statSync/realpathSync for
 * this particular check) — not whether resolving the full path changes at
 * all. A full lexical-vs-realpath string comparison would falsely trip on
 * perfectly normal OS-level symlinks earlier in the path (e.g. macOS's
 * /var -> /private/var, which every OS temp directory lives under) — that
 * isn't tampering, it's just how the platform lays out its temp dir.
 * lstat on the leaf component itself is unaffected by ancestor symlinks
 * and correctly catches the actual attack this guards against: allowedRoot
 * itself having been replaced by a symlink to somewhere else. Run on
 * every write, so a root swapped mid-session is caught on the next call,
 * not just the first.
 */
function buildArtifactWriter(allowedRoot: string): ArtifactWriter {
  function ensureRootIntegrity(): void {
    fs.mkdirSync(allowedRoot, { recursive: true })
    const st = fs.lstatSync(allowedRoot)
    if (st.isSymbolicLink()) {
      throw new ArtifactPathViolationError(`Allowed root "${allowedRoot}" is a symlink — refusing (it must be a real directory, never a symlink to somewhere else)`)
    }
    if (!st.isDirectory()) {
      throw new ArtifactPathViolationError(`Allowed root "${allowedRoot}" exists but is not a directory`)
    }
  }

  function resolveTarget(filename: string): string {
    if (!FILENAME_PATTERN.test(filename)) {
      throw new ArtifactPathViolationError(`Filename "${filename}" is not a bare "name.md" filename — no path separators or traversal are permitted`)
    }
    const target = path.resolve(allowedRoot, filename)
    assertContained(allowedRoot, target)
    return target
  }

  return {
    writeArtifact(filename, content) {
      const target = resolveTarget(filename)
      ensureRootIntegrity()

      let alreadyExists = false
      try {
        const st = fs.lstatSync(target)
        if (st.isSymbolicLink()) {
          throw new ArtifactPathViolationError(`Refusing to write through an existing symlink at "${target}"`)
        }
        if (!st.isFile()) {
          throw new ArtifactPathViolationError(`Refusing to write — "${target}" exists and is not a regular file`)
        }
        alreadyExists = true
      } catch (err) {
        if (err instanceof ArtifactPathViolationError) throw err
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }

      if (alreadyExists) {
        const existing = fs.readFileSync(target, 'utf8')
        if (existing === content) return false
      }

      writeRegularFileNoFollow(target, content, alreadyExists)

      // Defense in depth: re-confirm the file we just wrote really landed
      // inside the allowed root's real path. Both sides are resolved via
      // realpathSync here, so any ancestor-symlink prefix (e.g. macOS's
      // /var -> /private/var) appears identically on both and cancels out
      // in the path.relative() comparison inside assertContained — unlike
      // ensureRootIntegrity() above, this check's whole point IS full
      // resolution, since it's confirming where the file really landed.
      const realRoot = fs.realpathSync(allowedRoot)
      const realTarget = fs.realpathSync(target)
      try {
        assertContained(realRoot, realTarget)
      } catch (err) {
        fs.unlinkSync(target)
        throw err
      }

      return true
    },

    readArtifact(filename) {
      const target = resolveTarget(filename)
      if (!fs.existsSync(target)) return null
      return fs.readFileSync(target, 'utf8')
    },

    artifactExists(filename) {
      return fs.existsSync(resolveTarget(filename))
    },

    getAllowedRootForTesting() {
      return allowedRoot
    },
  }
}

const PRODUCTION_ALLOWED_ROOT = path.resolve(process.cwd(), 'docs', 'whats-good-widget')
const productionWriter = buildArtifactWriter(PRODUCTION_ALLOWED_ROOT)

// The ONLY filesystem-write entry points production code (actionHandlers.ts)
// may import. Permanently bound to PRODUCTION_ALLOWED_ROOT — there is no
// parameter here for a caller to redirect them elsewhere.
export const writeArtifact = productionWriter.writeArtifact
export const readArtifact = productionWriter.readArtifact
export const artifactExists = productionWriter.artifactExists
export const getAllowedRootForTesting = productionWriter.getAllowedRootForTesting

// Deliberately the LEXICAL os.tmpdir() path, not its realpath: on macOS
// os.tmpdir() itself lives under a symlink (/var -> /private/var), and
// fs.mkdtempSync(path.join(os.tmpdir(), ...)) always returns paths rooted
// at that same lexical path — resolving symlinks here would make every
// legitimately-created temp directory look like it was "outside" the temp
// dir. The property this guard actually needs is "did test code ask for a
// path under the standard OS temp location" (never attacker-controlled
// input), which a lexical comparison answers correctly; the SEPARATE
// symlink-vs-real-path defenses inside buildArtifactWriter itself (see
// ensureRootIntegrity) still apply in full to whatever root is chosen.
const OS_TMPDIR = path.resolve(os.tmpdir())

/**
 * TEST-ONLY. Builds an independent ArtifactWriter bound to `allowedRoot`,
 * with the exact same containment/symlink/traversal protections as
 * production — but refuses to build one at all unless `allowedRoot`
 * resolves inside the OS temp directory. This is what makes "point a test
 * writer at the real docs/whats-good-widget path" impossible even by
 * mistake: ordinary tests must create their own temporary directory
 * (e.g. via fs.mkdtempSync(path.join(os.tmpdir(), ...))) and pass that in.
 */
export function createArtifactWriterForTesting(allowedRoot: string): ArtifactWriter {
  const resolvedRoot = path.resolve(allowedRoot)
  const rel = path.relative(OS_TMPDIR, resolvedRoot)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new ArtifactPathViolationError(
      `createArtifactWriterForTesting root "${resolvedRoot}" must be inside the OS temp directory ("${OS_TMPDIR}") — refusing to build a writer that could point at production content`
    )
  }
  return buildArtifactWriter(resolvedRoot)
}
