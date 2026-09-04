// HomeScreen 2026 Redesign — pure layout split for the What's Good
// discovery centerpiece: 1 large primary pick + up to 2 secondary picks,
// all visible without horizontal scrolling. Does not touch ranking,
// rotation, or momentum — it only splits whatever selectWhatsGood() /
// useWhatsGood() already returned (already exactly 3 picks, or fewer on a
// genuine shortage) into a display shape.
//
// DEFAULT HOME "WOW" PASS (2026-09-03): within the already-selected 3,
// PRESENTATION order now prefers an image-capable item as the primary
// hero — "if we have a real image among the 3, users should see imagery
// above the fold." This is display-order only: the SET of 3 items is
// completely untouched (same ids, same exposure recording — see
// lib/whatsGoodExposureWriter.js, which records exposure by item id set,
// never by position, so this has zero effect on tracking). Checked and
// confirmed safe: no other module in this codebase treats "items[0]" as
// meaning "the top-ranked pick" for anything other than display — ranking
// itself lives entirely in lib/whatsGoodSelection.js / selectWhatsGood(),
// upstream of this function, and is never re-run or re-ordered here.

import { resolvedItemImage } from './whatsGoodImageSource.js'

/**
 * @param {Array} items  whatsGood.items — already-ranked, already exactly
 *   3 (or fewer, on genuine shortage; see lib/whatsGoodOrchestrator.js).
 *   Ranking/selection is NOT touched here. When the top-ranked pick
 *   (items[0]) has no resolvable image but a later one of the 3 does,
 *   that image-capable item becomes the display primary instead — the
 *   other two keep their relative order as secondary. When none has an
 *   image, or the top pick already does, behavior is unchanged (primary =
 *   items[0]).
 * @returns {{primary: object|null, secondary: object[]}}
 */
export function splitWhatsGoodDisplayLayout(items) {
  const list = items ?? []
  if (list.length === 0) return { primary: null, secondary: [] }

  const imageLedIndex = resolvedItemImage(list[0])
    ? 0
    : list.findIndex((item) => Boolean(resolvedItemImage(item)))

  const primaryIndex = imageLedIndex === -1 ? 0 : imageLedIndex
  const primary = list[primaryIndex]
  const secondary = list.filter((_, i) => i !== primaryIndex).slice(0, 2)

  return { primary, secondary }
}

/**
 * Whether an item should get the premium purple "special/secret" reveal
 * treatment in the What's Good / What's the Thing hero surfaces. Pure
 * passthrough of the existing is_secret flag — introduces no new special
 * classification.
 */
export function isSpecialItemPresentation(item) {
  return Boolean(item?.is_secret ?? item?.isSecret)
}
