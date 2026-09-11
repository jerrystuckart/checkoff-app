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

// ---------------------------------------------------------------------------
// Chief Phase 2AK (2026-09-10, methodology hardening postmortem) — a final,
// deterministic, hard-failing audit distinct from both OPENING_DISTRIBUTION_GATE
// (single-word, 15% threshold) and analyzeCatalogVoice (diagnostic-only,
// picks rewrite TARGETS for the bounded M8.75 voice pass). This catches a
// different failure mode: no SINGLE opener exceeds 15%, but a cluster of
// interchangeable generic openers (Try/Sample/Sip/Ask for.../Sit at.../
// Take a.../Attend/Find/Walk/Visit/Explore/Order) COLLECTIVELY dominates
// the catalog — exactly the shape a real editorial cleanup pass produces
// when it "fixes" one overused word by scattering the fix across several
// near-synonyms instead of finding a genuinely different hook per venue.
// Explicitly NOT a thesaurus-swap detector to route around by rotating
// words further — the gate's own failure message says so, and repair
// requires a real, different hook, not another opener choice.
// ---------------------------------------------------------------------------

/** Common generic CheckOff-item openers — verbs that describe an action but carry no venue-specific information on their own. Watchlist, not exhaustive; a future metro may need to extend it if a new generic opener pattern emerges. */
export const DEFAULT_WEAK_OPENER_WATCHLIST: readonly string[] = ['try', 'attend', 'take', 'sit', 'find', 'walk', 'visit', 'explore', 'order', 'sample', 'sip', 'ask']

/** Above this COMBINED share of the batch opening with any watchlist word, the catalog is judged to have a real generic-opener concentration problem — distinct from, and in addition to, the single-word 15% OPENING_DISTRIBUTION_GATE threshold. */
export const DEFAULT_MAX_COMBINED_WEAK_OPENER_SHARE = 0.45

export interface OpeningVerbConcentrationResult {
  key: 'OPENING_VERB_CONCENTRATION_AUDIT'
  verdict: 'PASS' | 'FAIL'
  reason: string
  combinedSharePercent: number
  breakdown: Array<{ word: string; count: number }>
}

export function evaluateOpeningVerbConcentrationAudit(
  bodies: readonly string[],
  opts?: { watchlist?: readonly string[]; maxCombinedShare?: number }
): OpeningVerbConcentrationResult {
  const watchlist = new Set((opts?.watchlist ?? DEFAULT_WEAK_OPENER_WATCHLIST).map((w) => w.toLowerCase()))
  const maxCombinedShare = opts?.maxCombinedShare ?? DEFAULT_MAX_COMBINED_WEAK_OPENER_SHARE

  if (bodies.length < MIN_BATCH_SIZE_FOR_DIAGNOSTICS) {
    return { key: 'OPENING_VERB_CONCENTRATION_AUDIT', verdict: 'PASS', reason: `Batch of ${bodies.length} is below the ${MIN_BATCH_SIZE_FOR_DIAGNOSTICS}-item minimum for a meaningful concentration check.`, combinedSharePercent: 0, breakdown: [] }
  }

  const counts = new Map<string, number>()
  let combinedCount = 0
  for (const body of bodies) {
    const w = firstWordOf(body)
    if (!watchlist.has(w)) continue
    counts.set(w, (counts.get(w) ?? 0) + 1)
    combinedCount += 1
  }
  const combinedSharePercent = (combinedCount / bodies.length) * 100
  const breakdown = [...counts.entries()].map(([word, count]) => ({ word, count })).sort((a, b) => b.count - a.count)

  const verdict: 'PASS' | 'FAIL' = combinedCount / bodies.length > maxCombinedShare ? 'FAIL' : 'PASS'
  return {
    key: 'OPENING_VERB_CONCENTRATION_AUDIT',
    verdict,
    combinedSharePercent,
    breakdown,
    reason:
      verdict === 'PASS'
        ? `Generic watchlist openers (${[...watchlist].join('/')}) combine for ${combinedSharePercent.toFixed(0)}% of ${bodies.length} items — under the ${(maxCombinedShare * 100).toFixed(0)}% combined-concentration threshold.`
        : `Generic watchlist openers combine for ${combinedSharePercent.toFixed(0)}% of ${bodies.length} items (over the ${(maxCombinedShare * 100).toFixed(0)}% threshold): ${breakdown.map((b) => `"${b.word}"×${b.count}`).join(', ')}. This is a real repetition problem even though no single word may exceed OPENING_DISTRIBUTION_GATE's own 15% threshold — fix by finding a genuinely different, venue-specific hook per flagged item, never by rotating to another word on this same watchlist.`,
  }
}
