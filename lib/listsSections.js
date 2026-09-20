// Lists Landing Redesign (2026-09-19) — pure, React-free derivation logic
// for the Lists tab landing screen (screens/ListsScreen.jsx). Mirrors this
// repo's established hook-owns-policy / lib-stays-pure split (see
// lib/savedItemsState.js, lib/whatsGoodOrchestrator.js): the screen owns
// React state, Supabase calls, and navigation; this module owns the actual
// section-building / cover-resolution / accent-derivation decisions so they
// can be unit tested with plain node:test, no RN render harness needed.
//
// Nothing in this file imports React, React Native, or Supabase.

const LIST_ACCENT_COLORS = ['#F5A623', '#7A4DB3', '#2E7D8C', '#2E6B3E', '#C0674A', '#378ADD']

/**
 * Deterministic accent color for a list with no featured-creator override —
 * same derivation ListsScreen.jsx already used pre-redesign
 * (list.id.charCodeAt(0) % 6 into a fixed 6-color palette), extracted here
 * so it's independently testable and reused identically by both the
 * personal-lists section and the joined-official section.
 * @param {{ id: string }} list
 * @returns {string}
 */
export function accentForList(list) {
  if (!list?.id) return LIST_ACCENT_COLORS[0]
  return LIST_ACCENT_COLORS[list.id.charCodeAt(0) % LIST_ACCENT_COLORS.length]
}

/**
 * Whether a list should render the featured-creator amber treatment —
 * unchanged condition from the pre-redesign screen: a real creator handle
 * AND is_featured_eligible, both genuine columns/joins already fetched.
 * @param {{ creatorHandle?: string|null, is_featured_eligible?: boolean }} list
 * @returns {boolean}
 */
export function isFeaturedCreatorList(list) {
  return !!list?.creatorHandle && !!list?.is_featured_eligible
}

/**
 * Resolves which cover treatment a list card should use, in priority order:
 *   1. a real hero_image_url column value (genuine per-list image, already
 *      used by ListScreen.jsx's own header) if present and not already
 *      known-failed for this render pass
 *   2. a code-native generic/accent treatment otherwise
 * Never invents a new field and never falls through to a broken/blank state
 * — priority 2 always resolves to something renderable.
 * @param {{ hero_image_url?: string|null }} list
 * @param {boolean} [failed] whether this list's cover image already failed
 *   to load once in this render pass (no-retry policy)
 * @returns {{ hasCover: boolean, url: string|null }}
 */
export function resolveListCover(list, failed = false) {
  const url = list?.hero_image_url ?? null
  if (!url || failed) return { hasCover: false, url: null }
  return { hasCover: true, url }
}

/**
 * Builds the single flat, typed row array the Lists landing screen's
 * FlatList renders — one virtualized list, no nested same-direction
 * virtualization, no ScrollView. Saved is always first. Sections are
 * omitted entirely (not rendered as an empty header) when they have no
 * rows to show, except personalLists which renders its own dedicated
 * empty-state row so there's always a way to create a first list.
 *
 * @param {object} args
 * @param {Array<object>} args.personalLists
 * @param {Array<object>} args.joinedOfficial
 * @returns {Array<{ type: string, key: string, [k: string]: any }>}
 */
export function buildListsRows({ personalLists = [], joinedOfficial = [] } = {}) {
  const rows = [{ type: 'saved', key: 'saved' }]

  rows.push({ type: 'header', key: 'header-your-lists', title: 'Your Lists' })

  if (personalLists.length === 0) {
    rows.push({ type: 'empty-personal', key: 'empty-personal' })
  } else {
    for (const list of personalLists) {
      rows.push({ type: 'list', key: `personal-${list.id}`, list, official: false })
    }
  }

  if (joinedOfficial.length > 0) {
    rows.push({ type: 'header', key: 'header-joined', title: 'Joined lists' })
    for (const list of joinedOfficial) {
      rows.push({ type: 'list', key: `official-${list.id}`, list, official: true })
    }
  }

  return rows
}

/**
 * Screen-reader-friendly meta phrase for a list card — "Ends today" /
 * "1 day left" / "N days left" / "Open-ended", built from the SAME
 * time-left string the visible card already shows (no separate/duplicated
 * a11y copy that could drift from the visible text).
 * @param {string|null} timeLeftText
 * @returns {string}
 */
export function listA11yMeta(timeLeftText) {
  return timeLeftText || 'Open-ended'
}
