// Search Metro: search the FULL active catalog of one selected metro, from anywhere.
//
// Kept deliberately distinct from the other two concepts:
//   Nearby       = geographically close to the user (screens/DiscoverScreen.jsx, radius-bound, unchanged)
//   Browse Metro = explore the selected metro's curated lists/rails
//   Search Metro = THIS module: every active, approved, non-secret item whose neighborhood belongs to the metro,
//                  regardless of the user's location, distance, curated-list membership, Home rails or saves.
//
// The largest metro has a few hundred items, so the metro's catalog is fetched once (paged) and searched in
// memory: instant results, accent-insensitive, no per-keystroke network calls, and nothing location-based.
// Items with no neighborhood belong to no metro and are never returned. Secret items are never returned.
import { normalizeSearchText } from './searchNormalize.js'

export const METRO_SEARCH_PAGE_SIZE = 1000
export const MIN_QUERY_LENGTH = 2
const ITEM_COLUMNS = 'id, body, neighborhood_id, partners!items_partner_id_fkey(business_name), categories(name), item_tags(tags(name))'

// Venue names live in the body, quoted: "...at 'Titletown Brewing Co'." Straight and curly quotes both occur.
const QUOTED_RE = /['‘’“”"]([^'‘’“”"]{2,80})['‘’“”"]/g
export function venueNamesFromBody(body) {
  const out = []
  for (const m of String(body ?? '').matchAll(QUOTED_RE)) out.push(m[1].trim())
  return out
}

/** One searchable entry per item, with every field normalized once. */
export function buildSearchEntry(row, neighborhoodName) {
  const partner = row.partners?.business_name ?? ''
  const venues = [partner, ...venueNamesFromBody(row.body)].filter(Boolean)
  const tags = (row.item_tags ?? []).map((t) => t?.tags?.name).filter(Boolean)
  return {
    id: row.id,
    body: row.body ?? '',
    venue: venues[0] ?? '',
    neighborhood: neighborhoodName ?? '',
    category: row.categories?.name ?? '',
    n: {
      venue: normalizeSearchText(venues.join(' | ')),
      body: normalizeSearchText(row.body ?? ''),
      neighborhood: normalizeSearchText(neighborhoodName ?? ''),
      category: normalizeSearchText(row.categories?.name ?? ''),
      tags: normalizeSearchText(tags.join(' | ')),
    },
  }
}

/**
 * Fetches the metro's searchable catalog. Only active + approved + non-secret items in the metro's neighborhoods.
 * `sb` is the Supabase client (injected so this is testable with a fake).
 */
export async function fetchMetroSearchIndex(sb, metroId) {
  if (!metroId) throw new Error('metroId is required')
  const { data: hoods, error: hoodError } = await sb.from('neighborhoods').select('id, name').eq('metro_id', metroId)
  if (hoodError) throw hoodError
  const hoodName = new Map((hoods ?? []).map((h) => [h.id, h.name]))
  if (hoodName.size === 0) return []
  const ids = [...hoodName.keys()]
  const entries = []
  for (let from = 0; ; from += METRO_SEARCH_PAGE_SIZE) {
    const { data, error } = await sb
      .from('items')
      .select(ITEM_COLUMNS)
      .in('neighborhood_id', ids)
      .eq('is_active', true)
      .eq('is_approved', true)
      .eq('is_secret', false)
      .order('id')
      .range(from, from + METRO_SEARCH_PAGE_SIZE - 1)
    if (error) throw error
    for (const row of data ?? []) entries.push(buildSearchEntry(row, hoodName.get(row.neighborhood_id)))
    if (!data || data.length < METRO_SEARCH_PAGE_SIZE) break
  }
  return entries
}

const WEIGHTS = { venue: 100, body: 40, neighborhood: 20, category: 10, tags: 10 }

/**
 * Every query word must appear somewhere in the entry (so "920 sauna" and "wood fired sauna" both work), and
 * results rank by where the words matched: venue name first, then the experience text, then neighborhood,
 * category and tags. Pure and synchronous.
 */
export function searchMetroIndex(index, rawQuery, { limit = 50 } = {}) {
  const q = normalizeSearchText(rawQuery).replace(/\s+/g, ' ').trim()
  if (q.length < MIN_QUERY_LENGTH) return []
  const words = q.split(' ')
  const scored = []
  for (const e of index) {
    let score = 0
    let all = true
    const matchedOn = new Set()
    for (const w of words) {
      let best = 0
      for (const [field, weight] of Object.entries(WEIGHTS)) {
        if (e.n[field].includes(w)) {
          best = Math.max(best, weight)
          matchedOn.add(field)
        }
      }
      if (!best) { all = false; break }
      score += best
    }
    if (!all) continue
    if (e.n.venue.includes(q)) score += 50 // the whole phrase appears in a venue name
    scored.push({ entry: e, score, matchedOn: [...matchedOn] })
  }
  scored.sort((a, b) => b.score - a.score || a.entry.body.localeCompare(b.entry.body))
  return scored.slice(0, limit).map(({ entry, score, matchedOn }) => ({ id: entry.id, title: entry.body, venue: entry.venue, neighborhood: entry.neighborhood, category: entry.category, score, matchedOn }))
}
