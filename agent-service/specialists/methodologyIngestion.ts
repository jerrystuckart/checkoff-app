// Chief Phase 2E — the DVA-1/DVA-2/DAP production ingestion path (spec
// section 9). Jerry will provide the full Claude Project instructions for
// each ONE TIME; this module is the mechanism for taking that input and
// turning it into a canonical, hash-verified methodology file WITHOUT
// this codebase ever reinterpreting/paraphrasing it. It never invents
// content — it only copies verbatim and records provenance.
//
// Deliberately NOT automatic beyond the copy+hash step: registering a
// methodology as `complete: true` in methodologyRegistry.ts remains a
// separate, explicit, reviewed code change (same discipline as adding a
// new entry to standingAuthority.ts) — this function's report tells the
// operator exactly what to change and why, it does not edit the registry
// itself.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { getMethodology, methodologyExists, METHODOLOGY_REGISTRY } from './methodologyRegistry'

export function computeContentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

export function computeFileHash(path: string): string {
  return computeContentHash(readFileSync(path, 'utf8'))
}

export interface IngestMethodologyInput {
  /** Absolute or cwd-relative path to the file Jerry provided (the exported Claude Project instructions). */
  sourceFilePath: string
  methodologyId: string
  version: string
  providedBy: string
  /** Repo root — defaults to two levels up from this file (agent-service/specialists/ -> repo root). Overridable for tests. */
  repoRoot?: string
  /** Required to overwrite a file whose registry entry already says complete:true — refuses otherwise, so a real ingested methodology can never be silently clobbered by a second, different paste. */
  force?: boolean
}

export interface IngestMethodologyReport {
  methodologyId: string
  version: string
  targetPath: string
  contentHash: string
  byteLength: number
  ingestedAt: string
  providedBy: string
  /** Exactly what the operator must do next — this function never does it automatically. */
  nextSteps: string[]
}

export class MethodologyAlreadyCompleteError extends Error {
  constructor(methodologyId: string, version: string) {
    super(`Refusing to overwrite ${methodologyId}/${version} — METHODOLOGY_REGISTRY already marks it complete:true. Pass force:true only if this is a deliberate re-ingestion (e.g. Jerry's Project instructions were updated), never to silently paper over a mistake.`)
    this.name = this.constructor.name
  }
}

/**
 * Copies `sourceFilePath`'s content VERBATIM to
 * specialists/methodologies/<methodologyId>/<version>.md, computes its
 * hash, and returns a report. Does not touch METHODOLOGY_REGISTRY.
 */
export function ingestMethodology(input: IngestMethodologyInput): IngestMethodologyReport {
  const repoRoot = input.repoRoot ?? `${__dirname}/../..`
  if (methodologyExists(input.methodologyId, input.version)) {
    const existing = getMethodology(input.methodologyId, input.version)
    if (existing.complete && !input.force) {
      throw new MethodologyAlreadyCompleteError(input.methodologyId, input.version)
    }
  }

  const content = readFileSync(input.sourceFilePath, 'utf8')
  if (content.trim().length === 0) {
    throw new Error(`Refusing to ingest an empty source file: ${input.sourceFilePath}`)
  }

  const targetPath = `${repoRoot}/agent-service/specialists/methodologies/${input.methodologyId}/${input.version}.md`
  mkdirSync(dirname(targetPath), { recursive: true })
  writeFileSync(targetPath, content, 'utf8')

  const contentHash = computeContentHash(content)
  return {
    methodologyId: input.methodologyId,
    version: input.version,
    targetPath,
    contentHash,
    byteLength: Buffer.byteLength(content, 'utf8'),
    ingestedAt: new Date().toISOString(),
    providedBy: input.providedBy,
    nextSteps: [
      `Review the ingested file at ${targetPath} — confirm it is the complete, verbatim methodology, not a partial paste.`,
      `Update methodologyRegistry.ts's entry for ${input.methodologyId}/${input.version}: set complete: true and contentHash: '${contentHash}'.`,
      'Run agent:typecheck and agent:test to confirm nothing else assumed this methodology stays incomplete (see remoteAiExecutor.ts / dvaReq tests).',
      'Do not paraphrase or summarize the ingested content anywhere in code — every specialist execution reads the file directly.',
    ],
  }
}

/**
 * Verifies every registry entry that DOES carry a contentHash still
 * matches the file on disk — catches an ingested methodology file being
 * hand-edited after the fact without updating its recorded hash (which
 * would silently violate "preserve verbatim").
 */
export function verifyMethodologyIntegrity(repoRoot: string = `${__dirname}/../..`): { valid: boolean; mismatches: Array<{ methodologyId: string; version: string; expected: string; actual: string }> } {
  const mismatches: Array<{ methodologyId: string; version: string; expected: string; actual: string }> = []
  for (const m of METHODOLOGY_REGISTRY) {
    if (!m.contentHash) continue
    const path = `${repoRoot}/${m.docPath}`
    const actual = computeFileHash(path)
    if (actual !== m.contentHash) {
      mismatches.push({ methodologyId: m.methodologyId, version: m.version, expected: m.contentHash, actual })
    }
  }
  return { valid: mismatches.length === 0, mismatches }
}
