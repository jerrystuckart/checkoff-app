#!/usr/bin/env -S npx tsx
// scripts/generate-tag-snapshot.ts
//
// Chief Phase 2Y — the single canonical parser for VerifiedTagSnapshot
// v1's source data. Parses Appendix A ("Verified production tag names
// (snapshot 2026-09-06)") of
// docs/checkoff-item-intake-chatgpt-instructions-UPDATED-2026-09-06.md
// — Jerry's own real 2026-09-06 production export of public.tags.name —
// into a checked-in generated JSON file
// (agent-service/specialists/tagSnapshotData.generated.json), so there
// is exactly ONE place this list is ever retyped from, never a manual
// 857-name transcription with its own chance of a typo diverging from
// the source.
//
// Extraction rule: every backtick-quoted token appearing AFTER the
// "## Appendix A" heading, in document order. Never normalized —
// singular/plural, punctuation, spacing, and capitalization are
// preserved EXACTLY as the source markdown has them (per the source
// doc's own "Treat spelling, punctuation, spaces, singular/plural, and
// capitalization as exact" instruction).
//
// Re-run this script (`npx tsx scripts/generate-tag-snapshot.ts`)
// whenever the source Appendix A is updated with a newer export — it
// always regenerates the full file from the source markdown, never
// hand-edited in place.

import { readFileSync, writeFileSync } from 'node:fs'

const SOURCE_MD = 'docs/checkoff-item-intake-chatgpt-instructions-UPDATED-2026-09-06.md'
const OUTPUT_JSON = 'agent-service/specialists/tagSnapshotData.generated.json'
const APPENDIX_HEADING = '## Appendix A — Verified production tag names (snapshot 2026-09-06)'
// The descriptive paragraph immediately under the heading itself contains
// a backtick-quoted schema reference ("`public.tags.name`") that is NOT
// a tag name — the real list begins only after this sentence.
const LIST_STARTS_AFTER = 'capitalization as exact.'

export interface GeneratedTagSnapshotFile {
  version: number
  capturedAt: string
  source: string
  justification: string
  generatedAt: string
  count: number
  tagNames: string[]
}

export function parseAppendixA(markdown: string): string[] {
  const headingIndex = markdown.indexOf(APPENDIX_HEADING)
  if (headingIndex === -1) {
    throw new Error(`Could not find "${APPENDIX_HEADING}" in the source markdown — has the appendix been renamed or removed?`)
  }
  const afterHeading = markdown.slice(headingIndex + APPENDIX_HEADING.length)
  const listStartIndex = afterHeading.indexOf(LIST_STARTS_AFTER)
  if (listStartIndex === -1) {
    throw new Error(`Could not find the "${LIST_STARTS_AFTER}" marker that precedes the actual tag list — the descriptive paragraph above the list may have changed wording.`)
  }
  const appendixText = afterHeading.slice(listStartIndex + LIST_STARTS_AFTER.length)
  const matches = [...appendixText.matchAll(/`([^`]+)`/g)].map((m) => m[1])
  if (matches.length === 0) {
    throw new Error('Found the Appendix A heading but extracted zero backtick-quoted tag names — the parser or the source format may have changed.')
  }
  // De-duplicate while preserving first-seen order — the source appendix
  // should already be duplicate-free, but this makes that an explicit,
  // checked invariant rather than an assumption.
  const seen = new Set<string>()
  const unique: string[] = []
  for (const name of matches) {
    if (!seen.has(name)) {
      seen.add(name)
      unique.push(name)
    }
  }
  return unique
}

function main() {
  const markdown = readFileSync(SOURCE_MD, 'utf8')
  const tagNames = parseAppendixA(markdown)

  const out: GeneratedTagSnapshotFile = {
    version: 1,
    capturedAt: '2026-09-06',
    source: `${SOURCE_MD} — Appendix A, Jerry's real public.tags.name production export`,
    justification: "Jerry's verified 2026-09-06 production export of public.tags.name, used only as a fallback when a live SELECT against public.tags is unavailable — never the primary source once live access exists.",
    generatedAt: new Date().toISOString(),
    count: tagNames.length,
    tagNames,
  }

  writeFileSync(OUTPUT_JSON, JSON.stringify(out, null, 2) + '\n')
  console.error(`Wrote ${OUTPUT_JSON}: ${tagNames.length} unique tag name(s).`)
}

if (require.main === module) {
  main()
}
