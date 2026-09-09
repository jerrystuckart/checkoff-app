/**
 * mergeSearchMatchCounts(tagItemRows, bodyMatchIds)
 *
 * Combines tag-name matches with a direct item-body text match into one
 * tag-match-count map, keyed by item id (string).
 *
 * An item's own body text must be able to surface it in typed search even
 * when the query also happens to substring-match some unrelated tag name —
 * e.g. searching "house" matches the tags "steakhouse"/"lighthouse", but an
 * item like "House of Honey" that isn't tagged with either of those must
 * still appear via its body text. Treating tag-match and body-match as an
 * either/or (only ever falling back to body text when zero tags matched)
 * silently drops items like this from every search whose text happens to
 * collide with an unrelated tag name.
 *
 * Body-only matches get a count of 0 (present, but no relevance boost over
 * items that also matched a tag) rather than being omitted.
 *
 * @param {{item_id: string}[]} tagItemRows  item_tags rows for the matched tag ids
 * @param {string[]} bodyMatchIds            item ids whose body ilike-matched the query text
 * @returns {Record<string, number>} item id -> tag-match count
 */
export function mergeSearchMatchCounts(tagItemRows, bodyMatchIds) {
  const counts = {}
  ;(tagItemRows ?? []).forEach(row => {
    const key = String(row.item_id)
    counts[key] = (counts[key] ?? 0) + 1
  })
  ;(bodyMatchIds ?? []).forEach(id => {
    const key = String(id)
    counts[key] = counts[key] ?? 0
  })
  return counts
}
