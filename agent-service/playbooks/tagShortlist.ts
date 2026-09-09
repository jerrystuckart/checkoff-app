// Chief Phase 2AA — deterministic tag-shortlist derivation for the
// dedicated TAG_ASSIGNMENT stage. Pure, no AI/DB calls: takes the full
// canonical vocabulary (hundreds of names) and narrows it to a compact,
// relevant subset for ONE item, using only information already on hand
// (canonical category, the certified body, the research evidence, the
// neighborhood) — never the whole vocabulary, never a semantic/embedding
// call. The AI tag-selection step then picks 6-8 names FROM this
// shortlist only; a name outside it is never accepted (see
// metroTagCertification.ts's exact-match discipline, which this module
// does not relax).

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'has', 'have', 'are', 'was', 'were', 'you', 'your',
  'its', 'it', 'a', 'an', 'in', 'on', 'at', 'of', 'to', 'is', 'be', 'by', 'or', 'as', 'not', 'but', 'their',
])

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  )
}

export interface TagShortlistContext {
  /** Canonical DB category (e.g. from classifyCategory) — every tag DIRECTLY matching the category name/words is always included, regardless of score. */
  category: string | null
  /** The certified item body — the primary signal (a book club review site's own "what is this item actually about" text). */
  body: string
  /** Research evidence / supporting fact — additional real signal about the whole venue, not just the narrow CheckOff sentence. */
  claimSupported: string
  neighborhood?: string | null
}

export const DEFAULT_MIN_SHORTLIST = 20
export const DEFAULT_MAX_SHORTLIST = 60

/**
 * Scores every canonical tag by word-overlap with the item's own text
 * (category + body + research evidence + neighborhood), returns the
 * top-scoring `maxShortlist` names. Never empty and never absurdly
 * small: if fewer than `minShortlist` tags score above zero (a very
 * terse item), pads with the next-highest-scoring names (score 0,
 * deterministic alphabetical order) so the model still has a genuinely
 * workable set of real options to choose 6-8 from — padding NEVER
 * invents a name, it only widens which real vocabulary entries are
 * offered.
 */
export function deriveTagShortlist(vocabulary: readonly string[], context: TagShortlistContext, maxShortlist: number = DEFAULT_MAX_SHORTLIST, minShortlist: number = DEFAULT_MIN_SHORTLIST): string[] {
  const text = [context.category ?? '', context.body, context.claimSupported, context.neighborhood ?? ''].join(' ')
  const words = tokenize(text)
  const lowerText = text.toLowerCase()

  const scored = vocabulary.map((tag) => {
    const tagWords = tag
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
    let score = 0
    for (const tw of tagWords) {
      if (words.has(tw)) score += 1
      else if (tw.length > 3 && lowerText.includes(tw)) score += 0.5 // substring credit, e.g. "coffee" inside "coffeehouse"
    }
    // A tag that IS (or contains) the category name itself is always maximally relevant.
    if (context.category && tag.toLowerCase() === context.category.toLowerCase()) score += 10
    return { tag, score }
  })

  scored.sort((a, b) => b.score - a.score || a.tag.localeCompare(b.tag))
  const positive = scored.filter((s) => s.score > 0)
  const shortlist = positive.slice(0, maxShortlist).map((s) => s.tag)

  if (shortlist.length < minShortlist) {
    const padding = scored
      .filter((s) => s.score === 0)
      .slice(0, minShortlist - shortlist.length)
      .map((s) => s.tag)
    shortlist.push(...padding)
  }
  return shortlist
}
