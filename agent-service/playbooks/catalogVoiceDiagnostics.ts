// Chief Phase 3B — catalog-level voice diversity (Vienna post-mortem,
// item 6). Vienna passed ITEM-level editorial certification (each body
// individually specific/quoted/distinctive) but still launched with a
// catalog that read as five templates repeated — "Attend," "Find,"
// "Order," "See," "Walk" openers dominating. editorialDistinctiveness.ts
// already has OPENING_DISTRIBUTION_GATE (a hard certification FAIL when
// one opening word exceeds 15% of a batch) — that gate is a diagnostic
// tripwire, not a repair mechanism. This module identifies WHICH items
// are contributing to a repetition problem, so a bounded rewrite pass
// (stepCatalogVoicePass in metroLaunchDriver.ts) can target exactly
// those items rather than rewriting a catalog that is already fine.
//
// Opening distribution is a diagnostic, not a rigid quota — this module
// never blocks anything on its own; it only decides what to flag.

import { DEFAULT_MAX_OPENING_WORD_SHARE } from './editorialDistinctiveness'

export interface VoiceCatalogEntry {
  candidateName: string
  body: string
}

function firstWordOf(body: string): string {
  const m = body.trim().match(/^[A-Za-z']+/)
  return m ? m[0].toLowerCase() : ''
}

/** First 3 words, lowercased — a coarse template-sentence-structure signal beyond the single opening word. */
function openingPhraseOf(body: string): string {
  const words = body.trim().match(/^[A-Za-z']+(?:\s+[A-Za-z']+){0,2}/)
  return words ? words[0].toLowerCase() : ''
}

export interface VoiceDiagnosticsReport {
  totalItems: number
  openingWordCounts: Record<string, number>
  /** Opening words exceeding maxShare of the batch — the same threshold OPENING_DISTRIBUTION_GATE uses. */
  dominantOpeningWords: string[]
  /** 3-word opening phrases repeated 3+ times — a templated-sentence-structure signal the single-word check misses. */
  repeatedOpeningPhrases: Array<{ phrase: string; count: number }>
  /** Candidate names whose opening contributes to a dominant word or repeated phrase, capped at maxFlagged — this IS the rewrite target list. */
  flaggedCandidateNames: string[]
}

const MIN_BATCH_SIZE_FOR_DIAGNOSTICS = 10
const MIN_PHRASE_REPEAT_COUNT = 3

export function analyzeCatalogVoice(entries: readonly VoiceCatalogEntry[], opts?: { maxShare?: number; maxFlagged?: number }): VoiceDiagnosticsReport {
  const maxShare = opts?.maxShare ?? DEFAULT_MAX_OPENING_WORD_SHARE
  const maxFlagged = opts?.maxFlagged ?? entries.length

  if (entries.length < MIN_BATCH_SIZE_FOR_DIAGNOSTICS) {
    return { totalItems: entries.length, openingWordCounts: {}, dominantOpeningWords: [], repeatedOpeningPhrases: [], flaggedCandidateNames: [] }
  }

  const wordCounts = new Map<string, number>()
  const phraseCounts = new Map<string, number>()
  for (const e of entries) {
    const w = firstWordOf(e.body)
    if (w) wordCounts.set(w, (wordCounts.get(w) ?? 0) + 1)
    const p = openingPhraseOf(e.body)
    if (p) phraseCounts.set(p, (phraseCounts.get(p) ?? 0) + 1)
  }

  const dominantOpeningWords = [...wordCounts.entries()].filter(([, count]) => count / entries.length > maxShare).map(([word]) => word)
  const repeatedOpeningPhrases = [...phraseCounts.entries()]
    .filter(([, count]) => count >= MIN_PHRASE_REPEAT_COUNT)
    .map(([phrase, count]) => ({ phrase, count }))
    .sort((a, b) => b.count - a.count)

  const dominantWordSet = new Set(dominantOpeningWords)
  const repeatedPhraseSet = new Set(repeatedOpeningPhrases.map((p) => p.phrase))

  const flaggedCandidateNames = entries
    .filter((e) => dominantWordSet.has(firstWordOf(e.body)) || repeatedPhraseSet.has(openingPhraseOf(e.body)))
    .map((e) => e.candidateName)
    .slice(0, maxFlagged)

  return { totalItems: entries.length, openingWordCounts: Object.fromEntries(wordCounts), dominantOpeningWords, repeatedOpeningPhrases, flaggedCandidateNames }
}
