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
//
// Munich postmortem (2026-09-16) — the real gap this file's second half
// closes: Munich's real catalog had Catch×12, Choose×8, Find×12, Order×18,
// Take×9 of 184 items (32% combined) — no SINGLE word crossed the 15%
// OPENING_DISTRIBUTION_GATE threshold, "catch"/"choose" were not on
// DEFAULT_WEAK_OPENER_WATCHLIST, and even the words that WERE on the
// watchlist (find/order/take = 39/184 = 21%) stayed under the old 45%
// combined threshold. The result: nothing ever flagged these items for
// the automatic M8.75 repair pass, so the catalog reached certification
// with real, dense repetition that had to be corrected by hand
// afterward. Fixed by making "notable opener" detection frequency-driven
// (never dependent on a hand-maintained word list alone) and by feeding
// that same signal into analyzeCatalogVoice's own flaggedCandidateNames,
// so stepCatalogVoicePass's existing, already-safe bounded rewrite loop
// repairs a Munich-shaped catalog automatically, before it ever reaches
// a hard gate failure.

import { DEFAULT_MAX_OPENING_WORD_SHARE } from './editorialDistinctiveness'

export interface VoiceCatalogEntry {
  candidateName: string
  body: string
}

/**
 * Strips leading quote/punctuation characters (straight and curly) before
 * extracting the opening word, so a body that atypically begins with a
 * quoted venue name is never misread as a generic opener — the same
 * hardening applied to editorialDistinctiveness.ts's own firstWordOf, kept
 * as an independent copy here rather than a new cross-file dependency
 * (this file already imports one constant from that module; a second,
 * behavior-bearing shared function is a larger coupling change than this
 * one focused fix calls for).
 */
// Matches a real word, allowing INTERNAL apostrophes for contractions
// ("don't" stays one word) but never a bare TRAILING apostrophe — the
// exact shape a closing quote mark takes when a body opens with a quoted
// venue name and no space before the close ('Vereinsheim' hosts...`).
// Without the trailing-apostrophe exclusion, "Vereinsheim'" and
// "Vereinsheim" (no quote) would silently become two different word
// buckets instead of the same real word.
const WORD_PATTERN = /^[A-Za-z]+(?:'[A-Za-z]+)*/

function firstWordOf(body: string): string {
  const stripped = body.trim().replace(/^["'“”‘’]+/, '')
  const m = stripped.match(WORD_PATTERN)
  return m ? m[0].toLowerCase() : ''
}

/** First 3 words, lowercased — a coarse template-sentence-structure signal beyond the single opening word. Same leading-quote stripping and trailing-apostrophe exclusion as firstWordOf. */
function openingPhraseOf(body: string): string {
  const stripped = body.trim().replace(/^["'“”‘’]+/, '')
  const wordSrc = WORD_PATTERN.source.slice(1) // drop the leading ^ so it composes inside the repeated group below
  const words = stripped.match(new RegExp(`^${WORD_PATTERN.source}(?:\\s+(?:${wordSrc})){0,2}`))
  return words ? words[0].toLowerCase() : ''
}

export interface VoiceDiagnosticsReport {
  totalItems: number
  openingWordCounts: Record<string, number>
  /** Opening words exceeding maxShare of the batch — the same threshold OPENING_DISTRIBUTION_GATE uses. */
  dominantOpeningWords: string[]
  /** 3-word opening phrases repeated 3+ times — a templated-sentence-structure signal the single-word check misses. */
  repeatedOpeningPhrases: Array<{ phrase: string; count: number }>
  /** Candidate names whose opening contributes to a dominant word, a repeated phrase, OR a whole-catalog notable-opener concentration problem (see evaluateOpeningVerbConcentrationAudit) — this IS the rewrite target list, capped at maxFlagged. */
  flaggedCandidateNames: string[]
  /** True when no single word crossed the per-word dominance threshold, but the combined share of several notable, frequently-repeated openers still constitutes real repetition (the exact Munich shape) — reported so a caller can distinguish "obviously dominant word" from "diffuse but real concentration" in its own reporting. */
  hasDiffuseConcentration: boolean
  /** The specific notable words contributing to hasDiffuseConcentration (empty when hasDiffuseConcentration is false) — a caller (stepCatalogVoicePass) uses this to name the actual overused opener for an item flagged ONLY via diffuse concentration (no single dominantOpeningWords entry to fall back on, since by definition none crossed that higher bar). */
  notableConcentrationWords: string[]
}

const MIN_BATCH_SIZE_FOR_DIAGNOSTICS = 10
const MIN_PHRASE_REPEAT_COUNT = 3

export function analyzeCatalogVoice(entries: readonly VoiceCatalogEntry[], opts?: { maxShare?: number; maxFlagged?: number }): VoiceDiagnosticsReport {
  const maxShare = opts?.maxShare ?? DEFAULT_MAX_OPENING_WORD_SHARE
  const maxFlagged = opts?.maxFlagged ?? entries.length

  if (entries.length < MIN_BATCH_SIZE_FOR_DIAGNOSTICS) {
    return { totalItems: entries.length, openingWordCounts: {}, dominantOpeningWords: [], repeatedOpeningPhrases: [], flaggedCandidateNames: [], hasDiffuseConcentration: false, notableConcentrationWords: [] }
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

  // Munich fix — the diffuse-concentration signal: notable opening words
  // (see computeNotableOpeners's own doc) whose COMBINED share exceeds
  // the whole-catalog threshold, even when none individually crosses
  // maxShare. Their contributing items are flagged for repair too, not
  // just items behind a single dominant word or a repeated 3-word phrase.
  const notable = computeNotableOpeners(wordCounts, entries.length)
  const combinedNotableShare = notable.reduce((sum, n) => sum + n.count, 0) / entries.length
  const hasDiffuseConcentration = combinedNotableShare > DEFAULT_MAX_COMBINED_NOTABLE_OPENER_SHARE
  const diffuseConcentrationWordSet = hasDiffuseConcentration ? new Set(notable.map((n) => n.word)) : new Set<string>()

  const dominantWordSet = new Set(dominantOpeningWords)
  const repeatedPhraseSet = new Set(repeatedOpeningPhrases.map((p) => p.phrase))

  const flaggedCandidateNames = entries
    .filter((e) => dominantWordSet.has(firstWordOf(e.body)) || repeatedPhraseSet.has(openingPhraseOf(e.body)) || diffuseConcentrationWordSet.has(firstWordOf(e.body)))
    .map((e) => e.candidateName)
    .slice(0, maxFlagged)

  return {
    totalItems: entries.length,
    openingWordCounts: Object.fromEntries(wordCounts),
    dominantOpeningWords,
    repeatedOpeningPhrases,
    flaggedCandidateNames,
    hasDiffuseConcentration,
    notableConcentrationWords: hasDiffuseConcentration ? notable.map((n) => n.word) : [],
  }
}

// ---------------------------------------------------------------------------
// Chief Phase 2AK (2026-09-10, methodology hardening postmortem) — a final,
// deterministic, hard-failing audit distinct from both OPENING_DISTRIBUTION_GATE
// (single-word, 15% threshold) and analyzeCatalogVoice (diagnostic-only,
// picks rewrite TARGETS for the bounded M8.75 voice pass). This catches a
// different failure mode: no SINGLE opener exceeds 15%, but a cluster of
// interchangeable generic openers COLLECTIVELY dominates the catalog —
// exactly the shape a real editorial cleanup pass produces when it "fixes"
// one overused word by scattering the fix across several near-synonyms
// instead of finding a genuinely different hook per venue.
//
// Munich postmortem (2026-09-16) — the original version of this audit
// only ever counted words on a fixed, hand-maintained watchlist
// (DEFAULT_WEAK_OPENER_WATCHLIST). Munich's real dense openers included
// "catch" and "choose," neither on that list, so a genuine 32%-of-catalog
// repetition problem was invisible to it. Fixed by making "notable"
// detection PURELY frequency-driven: a word counts toward the combined
// share only when it is independently repeated often enough — at least
// MIN_NOTABLE_OPENER_COUNT times AND at least MIN_NOTABLE_OPENER_SHARE of
// the batch — to be a real pattern rather than incidental overlap.
// DEFAULT_WEAK_OPENER_WATCHLIST is kept (Jerry's own explicitly-named
// generic verbs remain documented and available to a caller that wants
// to restrict the check to a fixed list via opts.watchlist), but no
// longer bypasses the frequency floor by itself — a watchlist word used
// only once or twice is exactly the "does not ban a useful verb
// absolutely" case this whole mechanism must never flag. A word earns
// "notable" status only by how often it actually recurs in THIS
// catalog, never by name alone.
// ---------------------------------------------------------------------------

/** Common generic CheckOff-item openers — verbs that describe an action but carry no venue-specific information on their own. Historical/documentation value and available via opts.watchlist to restrict the check to a fixed list; the DEFAULT check (no opts.watchlist supplied) is purely frequency-driven and does not treat these words specially. */
export const DEFAULT_WEAK_OPENER_WATCHLIST: readonly string[] = ['try', 'attend', 'take', 'sit', 'find', 'walk', 'visit', 'explore', 'order', 'sample', 'sip', 'ask']

/** A word must recur at least this many times in the batch to ever count as a "notable" (real-pattern, not incidental) opener via the frequency signal — independent of watchlist membership. Chosen so a handful of naturally-overlapping openers in a large, healthy catalog (each appearing once or twice) never counts, while Munich's real smallest dense opener (Choose×8) clears it with wide margin. */
export const MIN_NOTABLE_OPENER_COUNT = 3

/** A word must ALSO reach at least this share of the batch to count as notable via the frequency signal — a floor that stays meaningful at any catalog size, not just an absolute count. */
export const MIN_NOTABLE_OPENER_SHARE = 0.03

/**
 * Above this COMBINED share of the batch opening with any notable word
 * (watchlist OR frequency-qualified), the catalog is judged to have a
 * real generic-opener concentration problem. Chosen against the real,
 * confirmed Munich pattern: Catch/Choose/Find/Order/Take combined for
 * 32.07% of 184 items (59/184) — clearly over this threshold with real
 * margin — while a catalog whose openers are each used once or twice
 * (maximal natural variety) never approaches even a quarter of the
 * batch from a small handful of words. Deliberately lower than the
 * previous 0.45 default, which demonstrably did not catch Munich's real
 * shape even when restricted to its own watchlist-only words (39/184 =
 * 21% — comfortably under 0.45).
 */
export const DEFAULT_MAX_COMBINED_NOTABLE_OPENER_SHARE = 0.25

/** @deprecated kept only so a caller pinned to the old export name still resolves; use DEFAULT_MAX_COMBINED_NOTABLE_OPENER_SHARE. Same value. */
export const DEFAULT_MAX_COMBINED_WEAK_OPENER_SHARE = DEFAULT_MAX_COMBINED_NOTABLE_OPENER_SHARE

/**
 * Purely frequency-driven by default: a word is "notable" only when it
 * clears BOTH the absolute-count and share floors — genuine, repeated
 * usage, never a name-based rule. `restrictToWatchlist`, when supplied,
 * additionally requires the word to appear on that list (for a caller
 * that deliberately wants the old fixed-list-only behavior) — but even
 * then the frequency floor still applies; watchlist membership alone is
 * never sufficient.
 */
function computeNotableOpeners(wordCounts: ReadonlyMap<string, number>, totalCount: number, restrictToWatchlist?: ReadonlySet<string>): Array<{ word: string; count: number }> {
  const notable: Array<{ word: string; count: number }> = []
  for (const [word, count] of wordCounts) {
    if (restrictToWatchlist && !restrictToWatchlist.has(word)) continue
    const clearsFrequencyFloor = count >= MIN_NOTABLE_OPENER_COUNT && count / totalCount >= MIN_NOTABLE_OPENER_SHARE
    if (clearsFrequencyFloor) notable.push({ word, count })
  }
  return notable.sort((a, b) => b.count - a.count)
}

export interface OpeningVerbConcentrationResult {
  key: 'OPENING_VERB_CONCENTRATION_AUDIT'
  verdict: 'PASS' | 'FAIL'
  reason: string
  combinedSharePercent: number
  /** Every notable word's own count AND share — "reports counts and percentages," not just a combined total. */
  breakdown: Array<{ word: string; count: number; sharePercent: number }>
}

export function evaluateOpeningVerbConcentrationAudit(
  bodies: readonly string[],
  /** `watchlist`, when explicitly supplied, restricts the check to that fixed list (still subject to the frequency floor). Omit (the default, and what the real driver does) for the purely frequency-driven check that catches ANY dense repetition, regardless of whether the word was anticipated in advance — the fix for the Munich gap, where "catch"/"choose" were never on the old fixed list. */
  opts?: { watchlist?: readonly string[]; maxCombinedShare?: number }
): OpeningVerbConcentrationResult {
  const restrictToWatchlist = opts?.watchlist ? new Set(opts.watchlist.map((w) => w.toLowerCase())) : undefined
  const maxCombinedShare = opts?.maxCombinedShare ?? DEFAULT_MAX_COMBINED_NOTABLE_OPENER_SHARE

  if (bodies.length < MIN_BATCH_SIZE_FOR_DIAGNOSTICS) {
    return { key: 'OPENING_VERB_CONCENTRATION_AUDIT', verdict: 'PASS', reason: `Batch of ${bodies.length} is below the ${MIN_BATCH_SIZE_FOR_DIAGNOSTICS}-item minimum for a meaningful concentration check.`, combinedSharePercent: 0, breakdown: [] }
  }

  const wordCounts = new Map<string, number>()
  for (const body of bodies) {
    const w = firstWordOf(body)
    if (w) wordCounts.set(w, (wordCounts.get(w) ?? 0) + 1)
  }
  const notable = computeNotableOpeners(wordCounts, bodies.length, restrictToWatchlist)
  const combinedCount = notable.reduce((sum, n) => sum + n.count, 0)
  const combinedSharePercent = (combinedCount / bodies.length) * 100
  const breakdown = notable.map(({ word, count }) => ({ word, count, sharePercent: (count / bodies.length) * 100 }))

  const verdict: 'PASS' | 'FAIL' = combinedCount / bodies.length > maxCombinedShare ? 'FAIL' : 'PASS'
  return {
    key: 'OPENING_VERB_CONCENTRATION_AUDIT',
    verdict,
    combinedSharePercent,
    breakdown,
    reason:
      verdict === 'PASS'
        ? `Notable openers (watchlist or independently repeated ${MIN_NOTABLE_OPENER_COUNT}+ times) combine for ${combinedSharePercent.toFixed(1)}% of ${bodies.length} items — under the ${(maxCombinedShare * 100).toFixed(0)}% combined-concentration threshold.`
        : `Notable openers combine for ${combinedSharePercent.toFixed(1)}% of ${bodies.length} items (over the ${(maxCombinedShare * 100).toFixed(0)}% threshold): ${breakdown.map((b) => `"${b.word}"×${b.count} (${b.sharePercent.toFixed(1)}%)`).join(', ')}. This is a real repetition problem — fix by finding a genuinely different, venue-specific hook per flagged item, never by rotating to another generic opener.`,
  }
}

// ---------------------------------------------------------------------------
// Structured before/after reporting (requirement: "produce a structured
// report showing before and after opening-word counts").
// ---------------------------------------------------------------------------

export interface OpeningWordReportRow {
  word: string
  count: number
  sharePercent: number
}

export interface OpeningWordDiversitySnapshot {
  totalItems: number
  /** Every distinct opening word observed, sorted by count descending — the full "counts and percentages" picture, not just the flagged/notable subset. */
  rows: OpeningWordReportRow[]
  combinedNotableSharePercent: number
  concentrationVerdict: 'PASS' | 'FAIL'
}

export function snapshotOpeningWordDistribution(entries: readonly VoiceCatalogEntry[]): OpeningWordDiversitySnapshot {
  const audit = evaluateOpeningVerbConcentrationAudit(entries.map((e) => e.body))
  const wordCounts = new Map<string, number>()
  for (const e of entries) {
    const w = firstWordOf(e.body)
    if (w) wordCounts.set(w, (wordCounts.get(w) ?? 0) + 1)
  }
  const rows = [...wordCounts.entries()]
    .map(([word, count]) => ({ word, count, sharePercent: entries.length > 0 ? (count / entries.length) * 100 : 0 }))
    .sort((a, b) => b.count - a.count)
  return { totalItems: entries.length, rows, combinedNotableSharePercent: audit.combinedSharePercent, concentrationVerdict: audit.verdict }
}

export interface OpeningWordDiversityReport {
  before: OpeningWordDiversitySnapshot
  after: OpeningWordDiversitySnapshot
  itemsRewritten: number
}

export function buildOpeningWordDiversityReport(before: readonly VoiceCatalogEntry[], after: readonly VoiceCatalogEntry[], itemsRewritten: number): OpeningWordDiversityReport {
  return { before: snapshotOpeningWordDistribution(before), after: snapshotOpeningWordDistribution(after), itemsRewritten }
}
