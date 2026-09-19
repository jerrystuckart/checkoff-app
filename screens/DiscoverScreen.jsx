import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, TextInput,
  ActivityIndicator, Animated, Platform, Linking, ScrollView,
  KeyboardAvoidingView, Keyboard, RefreshControl, useWindowDimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect } from '@react-navigation/native'
import { useNearby } from '../lib/useNearby'
import { useTheme } from '../lib/ThemeContext'
import { useSavedItems } from '../lib/SavedItemsContext'
import { supabase } from '../lib/supabase'
import { haversineMeters } from '../lib/distance'
import { filterMaskedBonusDrops } from '../lib/bonusDrops'
import { isItemInSeason } from '../lib/seasonFilter'
import { isWithinNearbyRadius, distLabel, rankNearbyItems, hasUsableCoordinates } from '../lib/nearbyRanking'
import { mergeSearchMatchCounts } from '../lib/searchMatch'
import { applySelectTag, applyRemoveTag } from '../lib/tagSelection'
import { normalizeSearchText } from '../lib/searchNormalize'
import { findNormalizedExtraMatches } from '../lib/nearbySearchAugment'
import {
  computeVisibleNearbyItems, clearSearchState, clearCategoryState,
  isAllFilterActive, applyAllFilter,
} from '../lib/nearbyFilterState'
import { fetchCompletedItemIds } from '../lib/nearbyCompletedItems'
import { trackEvent } from '../lib/trackEvent'
import CategoryTile from '../components/nearby/CategoryTile'
import NearbyResultRow from '../components/nearby/NearbyResultRow'

const AMBER = '#F5A623'
const NAVY  = '#1A1A2E'

// Below this content width, the search module's passive "Using your
// current location..." line no longer fits beside the input without
// clipping/compressing it — it wraps to its own line below instead. A
// width check (not a hardcoded per-device name) so it naturally adapts to
// large Dynamic Type/narrow devices/split-screen, not just a fixed phone
// model list.
const SEARCH_META_INLINE_MIN_WIDTH = 380

// NOTE: ring_weight (an admin-set content classification, also shown as a
// text chip on ItemDetailScreen/PartnerPreviewScreen) is still carried
// through on each item below for forward-compatibility with whatever
// consumes it downstream (e.g. ItemDetailScreen), but this redesigned row
// (components/nearby/NearbyResultRow.jsx) no longer renders a ring dot —
// it was visual noise once the category accent bar + category-color
// meta text already carry the primary at-a-glance signal. Nearby's own
// radius filtering/ranking never reads ring_weight either way.

// Augment raw item rows (from items table) with computed distance, and
// enforce the automatic Nearby radius — tag/text search must stay within the
// same geographic universe as default Nearby, never expand nationwide just
// because an item matches strongly. Items whose distance is known and beyond
// the radius are dropped outright (hard cutoff, no banding). Items with no
// usable coordinates at all (never geocoded — e.g. Admin's "Find & confirm
// location" hasn't run yet) are EXCLUDED, not deprioritized: no fallback
// distance, no sorting-in at the bottom. A missing location isn't "far
// away," it isn't proximity-eligible at all — see hasUsableCoordinates() in
// lib/nearbyRanking.js, the single shared gate for this across Nearby/
// Discover/Home.
function augmentWithDistance(rawItems, userCoords) {
  return (rawItems ?? [])
    .map(item => {
      const locatable = hasUsableCoordinates(item.maps_lat, item.maps_lng)
      let dist = null
      if (locatable && userCoords) {
        dist = haversineMeters(userCoords.latitude, userCoords.longitude, item.maps_lat, item.maps_lng)
      }
      return {
        id:               item.id,
        listItemId:       item.id,
        body:             item.body,
        difficulty:       item.difficulty ?? 1,
        maps_lat:         item.maps_lat ?? null,
        maps_lng:         item.maps_lng ?? null,
        is_secret:        item.is_secret ?? false,
        secret_reveal_text: item.secret_reveal_text ?? null,
        partner_id:       item.partner_id ?? null,
        maps_query:       item.maps_query ?? null,
        website_url:      item.website_url ?? null,
        geo_radius_m:     item.geo_radius_m ?? null,
        categoryName:     item.categories?.name ?? 'Misc',
        categoryColor:    item.categories?.color_hex ?? '#888780',
        neighborhoodName: item.neighborhoods?.name ?? null,
        partnerName:      item.partners?.business_name ?? null,
        has_alcohol:      item.has_alcohol ?? false,
        // Pre-completion-fetch placeholder ONLY — this module has no
        // per-item completion data of its own. It is always overwritten
        // downstream, in DiscoverScreen's displayItems pipeline, with the
        // real value from the bulk completedItemIds Set (see
        // lib/nearbyCompletedItems.js) before anything renders or before
        // this item is forwarded to ItemDetailScreen as its initial seed
        // — mirrors ItemDetailScreen.jsx's own `item?.checked ?? false`
        // initial-state pattern, which is likewise immediately corrected
        // by its own loadCheckedState() call.
        checked:          false,
        isUniversal:      false,
        hasExactLocation: locatable,
        dist_m:           dist,
        dist_label:       dist ? distLabel(dist) : null,
        // Raw admin-set classification, passed through unmodified for
        // display (see RINGS above) — not used for radius/ranking here.
        ring_weight:      item.ring_weight ?? 0,
        // No coords at all -> never eligible, regardless of radius.
        withinRadius:     dist !== null && isWithinNearbyRadius(dist),
      }
    })
    .filter(item => item.withinRadius)
}

export default function DiscoverScreen({ navigation, route }) {
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const { BG, CARD, TEXT, MUTED, BORDER, SOFT_2 } = colors
  const styles = useMemo(() => createStyles({ BG, CARD, TEXT, MUTED, BORDER, SOFT_2 }),
    [BG, CARD, TEXT, MUTED, BORDER, SOFT_2])

  const {
    items: nearbyItems, loading: nearbyLoading, locError, location,
    refresh: refreshNearby, refreshing: nearbyRefreshing,
  } = useNearby()

  const { savedItemIds, toggleSaved } = useSavedItems()
  const { width: windowWidth } = useWindowDimensions()

  // Keep a ref to the latest location so async functions get fresh coords
  const locationRef = useRef(null)
  useEffect(() => { if (location) locationRef.current = location }, [location, nearbyItems])

  // Search state
  const [searchText, setSearchText]     = useState('')
  const [suggestions, setSuggestions]   = useState([])
  const [activeTags, setActiveTags]     = useState([])   // [{id, name}] — manually tapped

  // Category filter state
  const [categories, setCategories]         = useState([])
  const [activeCategoryName, setActiveCategoryName] = useState('All')

  // Saved / Not Done filters — independent boolean dimensions, may be
  // active together (AND logic). Never reset as a side effect of
  // clearing search or category (see lib/nearbyFilterState.js).
  const [savedOnly, setSavedOnly]   = useState(false)
  const [notDoneOnly, setNotDoneOnly] = useState(false)

  // Bulk completion lookup (lib/nearbyCompletedItems.js) — ONE query for
  // every currently-fetched item id, never per-row. Re-fetched only when
  // the set of visible item ids actually changes.
  const [completedItemIds, setCompletedItemIds] = useState(() => new Set())
  const completedIdsKeyRef = useRef('')

  // Result state — either direct DB items (tag/text search) or null (use nearbyItems)
  const [tagResultItems, setTagResultItems] = useState(null)  // array|null
  const [tagMatchData, setTagMatchData]     = useState({ counts: {} })
  const [loadingSearch, setLoadingSearch]   = useState(false)
  const [discoverUserId, setDiscoverUserId] = useState(null)

  // Post-checkin mode
  const [postCheckin, setPostCheckin]     = useState(null)
  const [bannerVisible, setBannerVisible] = useState(false)
  const pulseAnim       = useRef(new Animated.Value(1)).current
  const appliedParamsRef = useRef(null)
  const debounceRef     = useRef(null)

  // ── Resolve current user — needed only to unmask a Bonus Drop the user
  // has already checked off (see lib/bonusDrops.js) ─────────────────────
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setDiscoverUserId(data?.user?.id ?? null))
  }, [])

  // ── Load categories ──────────────────────────────────────────────────────
  useEffect(() => {
    supabase.from('categories').select('id, name, color_hex').order('name')
      .then(({ data }) => setCategories(data ?? []))
  }, [])

  // ── Nearby screen viewed — once per focus, debounced 30min per user
  // (see lib/trackEvent.js's DEBOUNCED_TYPES) so repeated tab switches
  // within a session don't spam interaction_events. ──────────────────────
  useFocusEffect(useCallback(() => {
    trackEvent('nearby_view', {})
  }, []))

  // ── Bulk completion fetch — mirrors ItemDetailScreen.jsx's
  // loadCheckedState() semantics (check_ins scoped to the current season
  // window), but as ONE query for every currently-visible item id rather
  // than one per row. Re-runs only when the underlying candidate pool's
  // id set actually changes (or the user resolves), not on every render. */
  useEffect(() => {
    const basePool = tagResultItems !== null ? tagResultItems : nearbyItems
    const ids = basePool.map(i => String(i.id))
    const key = `${discoverUserId ?? ''}:${ids.slice().sort().join(',')}`
    if (key === completedIdsKeyRef.current) return
    completedIdsKeyRef.current = key
    if (!discoverUserId || ids.length === 0) {
      setCompletedItemIds(new Set())
      return
    }
    fetchCompletedItemIds(discoverUserId, ids).then(setCompletedItemIds)
  }, [tagResultItems, nearbyItems, discoverUserId])

  // ── Post-checkin params ──────────────────────────────────────────────────
  useFocusEffect(useCallback(() => {
    const params = route.params
    if (params?.mode === 'post_checkin' && params !== appliedParamsRef.current) {
      appliedParamsRef.current = params
      applyPostCheckin(params)
    }
  }, [route.params]))

  async function applyPostCheckin(params) {
    const { checkinLat, checkinLng, checkinItemId, checkinTags = [] } = params
    setPostCheckin({ lat: checkinLat, lng: checkinLng, itemId: checkinItemId })
    setBannerVisible(true)
    clearSearch()

    const tagNames = checkinTags.slice(0, 3)
    if (tagNames.length > 0) {
      try {
        const filter = tagNames.map(n => `name.ilike.%${n}%`).join(',')
        const { data } = await supabase
          .from('tags').select('id, name').or(filter).limit(10)
        const found = (data ?? []).filter(t =>
          tagNames.some(n => t.name.toLowerCase().includes(n.toLowerCase()))
        )
        if (found.length) {
          setActiveTags(found)
          fetchTagResultItems(found.map(t => t.id))
        }
      } catch { /* non-critical */ }
    }
  }

  // ── Banner pulse ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!bannerVisible) return
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 0.88, duration: 900, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1.00, duration: 900, useNativeDriver: true }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [bannerVisible])

  function dismissBanner() {
    setBannerVisible(false)
    setPostCheckin(null)
    clearSearch()
  }

  // Independent filters (explicit product requirement, fixing a real bug):
  // clearing search must reset ONLY search text/suggestions/tag chips/tag
  // results — it must NOT also reset category, Saved, or Not Done as a
  // side effect. The previous implementation here called
  // setActiveCategoryName('All') directly, silently resetting the
  // category filter any time search was cleared (including from
  // dismissBanner() and applyPostCheckin()). The state-shape itself now
  // lives in lib/nearbyFilterState.js's clearSearchState() so this
  // guarantee has direct unit coverage.
  function clearSearch() {
    const next = clearSearchState()
    setActiveTags(next.activeTags)
    setTagResultItems(next.tagResultItems)
    setTagMatchData(next.tagMatchData)
    setSearchText(next.searchText)
    setSuggestions(next.suggestions)
  }

  // Clearing category resets ONLY activeCategoryName — search text/tags/
  // Saved/Not Done are untouched (lib/nearbyFilterState.js's
  // clearCategoryState()).
  function clearCategory() {
    setActiveCategoryName(clearCategoryState().activeCategoryName)
  }

  // The filter row's "All" pill: the deterministic state where Saved,
  // Not Done, and category are all inactive. NOT a global reset — search
  // text/tags are untouched (see lib/nearbyFilterState.js's
  // isAllFilterActive/applyAllFilter docstrings for the precise
  // definition of what "All" governs).
  function selectAllFilter() {
    const next = applyAllFilter()
    setSavedOnly(next.savedOnly)
    setNotDoneOnly(next.notDoneOnly)
    setActiveCategoryName(next.activeCategoryName)
  }

  function toggleSavedFilter() {
    setSavedOnly(prev => {
      const next = !prev
      trackEvent('nearby_filter_saved', {})
      return next
    })
  }

  function toggleNotDoneFilter() {
    setNotDoneOnly(prev => {
      const next = !prev
      trackEvent('nearby_filter_not_done', {})
      return next
    })
  }

  // ── Search: debounced ────────────────────────────────────────────────────
  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (searchText.length < 2) {
      setSuggestions([])
      if (activeTags.length === 0) {
        setTagResultItems(null)
      }
      return
    }
    debounceRef.current = setTimeout(() => runSearch(searchText), 300)
    return () => clearTimeout(debounceRef.current)
  }, [searchText])

  // Primary search: tag-name matches (via item_tags, bypassing direct
  // tags-table RLS restrictions) UNION'd with a direct item-body text match.
  // Both always run together (when no tag chips are active) — an item's own
  // body text must be able to surface it even when the query also happens
  // to substring-match some unrelated tag name. Searching "house" matching
  // the tags "steakhouse"/"lighthouse" must not hide "House of Honey" just
  // because House of Honey isn't tagged with either of those — the old
  // either/or branching (tag match found -> body text never even queried)
  // silently dropped items exactly like this from search results.
  async function runSearch(text) {
    setLoadingSearch(true)
    try {
      // Find matching tags by name (direct query — works with user session JWT)
      const { data: tagRows, error: tagErr } = await supabase
        .from('tags')
        .select('id, name')
        .ilike('name', `%${text}%`)
        .limit(50)
      if (__DEV__ && tagErr) console.log('[search] tags error:', tagErr?.message)

      const matchedTags = tagRows ?? []
      const activeIds = new Set(activeTags.map(t => String(t.id)))
      setSuggestions(matchedTags.filter(t => !activeIds.has(String(t.id))).slice(0, 8))

      if (activeTags.length > 0) {
        // Tag chips already drive tagResultItems via fetchTagResultItems —
        // typed text here only refines tag suggestions, never replaces results.
        setLoadingSearch(false)
        return
      }

      let tagItemRows = []
      if (matchedTags.length > 0) {
        const tagIds = matchedTags.map(t => t.id)
        const { data, error: tiErr } = await supabase
          .from('item_tags')
          .select('item_id, tag_id')
          .in('tag_id', tagIds)
          .limit(500)
        if (__DEV__ && tiErr) console.log('[search] item_tags error:', tiErr?.message)
        tagItemRows = data ?? []
      }

      const { data: bodyItems, error: bodyErr } = await supabase
        .from('items').select('id')
        .ilike('body', `%${text}%`)
        .eq('is_active', true).eq('is_approved', true).eq('is_universal', false)
        .limit(100)
      if (__DEV__ && bodyErr) console.log('[search] body error:', bodyErr?.message)

      const counts = mergeSearchMatchCounts(tagItemRows, (bodyItems ?? []).map(i => i.id))

      // Search-quality pass (see lib/nearbySearchAugment.js's docstring
      // for the full strategy + honest limitation): PostgREST `ilike` is a
      // literal substring match against the raw stored (accented) text, so
      // a normalized query like "hueftgold" can't itself match a stored
      // "Hüftgold" via the query above — no schema change is in scope to
      // fix that server-side. Instead, re-check the already-fetched,
      // radius-bound nearbyItems pool (never the full catalog, never an
      // extra per-keystroke fetch) with normalized client-side comparison,
      // and union in anything the primary path missed purely because of
      // accent/transliteration differences.
      const matchedIdSet = new Set(Object.keys(counts))
      const normalizedExtras = findNormalizedExtraMatches({
        pool: nearbyItems,
        alreadyMatchedIds: matchedIdSet,
        rawQuery: text,
      })
      normalizedExtras.forEach(extra => {
        counts[String(extra.id)] = counts[String(extra.id)] ?? 0
      })
      setTagMatchData({ counts })

      const matchedIds = Object.keys(counts).filter(id => !normalizedExtras.some(e => String(e.id) === id))
      let augmented = []
      if (matchedIds.length > 0) {
        const uuidIds = matchedIds.slice(0, 100)  // items.id is UUID — no parseInt
        const { data: rawItems, error: itemErr } = await supabase
          .from('items')
          .select(`
            id, body, difficulty, maps_lat, maps_lng, is_active, is_approved,
            is_secret, secret_reveal_text, has_alcohol, season_tag, ring_weight,
            partner_id, maps_query, website_url, geo_radius_m,
            categories(name, color_hex),
            neighborhoods!items_neighborhood_id_fkey(name),
            partners!items_partner_id_fkey(business_name)
          `)
          .in('id', uuidIds)
          .eq('is_active', true)
          .eq('is_approved', true)
        if (__DEV__ && itemErr) console.log('[search] items error:', itemErr?.message)

        // Locked Bonus Drops must not leak into search results — they only
        // exist inside their own list until unlocked or already checked.
        const maskedItems = await filterMaskedBonusDrops(rawItems ?? [], discoverUserId)
        augmented = augmentWithDistance(maskedItems.filter(isItemInSeason), locationRef.current ?? location)
      }
      // normalizedExtras already carry the full augmented shape (they came
      // straight from nearbyItems) — no second DB round trip needed for them.
      const finalResults = [...augmented, ...normalizedExtras]
      setTagResultItems(finalResults)

      // Privacy-conscious analytics: fires only that a search happened —
      // trackEvent's interaction_events shape carries event_type/list_id/
      // item_id only (no generic properties column to add without a
      // schema change), so query length/result count aren't persisted;
      // this still avoids ever logging the raw free-form search text.
      trackEvent('nearby_search', {})
    } catch (e) {
      if (__DEV__) console.log('[search] runSearch error:', e?.message)
    }
    setLoadingSearch(false)
  }

  // ── Core: fetch items by tag IDs directly from DB ────────────────────────
  // Used by: chip selection (selectTag/removeTag), post-checkin
  async function fetchTagResultItems(tagIds) {
    if (!tagIds.length) {
      setTagResultItems(null)
      setTagMatchData({ counts: {} })
      return
    }
    try {
      const { data: tagItemRows, error: tiErr } = await supabase
        .from('item_tags').select('item_id, tag_id').in('tag_id', tagIds)
      if (__DEV__ && tiErr) console.log('item_tags error:', tiErr?.message)

      const counts = {}
      ;(tagItemRows ?? []).forEach(row => {
        const key = String(row.item_id)
        counts[key] = (counts[key] ?? 0) + 1
      })
      setTagMatchData({ counts })

      const matchedIds = Object.keys(counts)
      if (!matchedIds.length) {
        setTagResultItems([])
        return
      }

      const uuidIds = matchedIds.slice(0, 100)  // items.id is UUID — no parseInt
      const { data: rawItems, error: itemErr } = await supabase
        .from('items')
        .select(`
          id, body, difficulty, maps_lat, maps_lng, is_active, is_approved,
          is_secret, secret_reveal_text, has_alcohol, season_tag,
          partner_id, maps_query, website_url, geo_radius_m,
          categories(name, color_hex),
          neighborhoods!items_neighborhood_id_fkey(name),
          partners!items_partner_id_fkey(business_name)
        `)
        .in('id', uuidIds)
        .eq('is_active', true)
        .eq('is_approved', true)
      if (__DEV__ && itemErr) console.log('items fetch error:', itemErr?.message)

      // Locked Bonus Drops must not leak into search results — they only
      // exist inside their own list until unlocked or already checked.
      const maskedItems = await filterMaskedBonusDrops(rawItems ?? [], discoverUserId)
      const augmented = augmentWithDistance(maskedItems.filter(isItemInSeason), locationRef.current ?? location)
      setTagResultItems(augmented)
    } catch (e) {
      if (__DEV__) console.log('fetchTagResultItems error:', e?.message)
      setTagResultItems([])
    }
  }

  // ── Tag chip selection ───────────────────────────────────────────────────
  // State-shape logic lives in lib/tagSelection.js (pure, no setState calls)
  // — see that file's docstring for why: a stray reference to a since-
  // removed setter here previously crashed the app on every tag-chip tap.
  function selectTag(tag) {
    const result = applySelectTag(activeTags, tag)
    if (!result.changed) return
    setActiveTags(result.activeTags)
    if (result.clearSuggestions) setSuggestions([])
    if (result.clearSearchText) setSearchText('')
    fetchTagResultItems(result.activeTags.map(t => t.id))
  }

  function removeTag(tagId) {
    const result = applyRemoveTag(activeTags, tagId)
    setActiveTags(result.activeTags)
    if (result.shouldClearResults) {
      setTagResultItems(null)
      setTagMatchData({ counts: {} })
    } else {
      fetchTagResultItems(result.activeTags.map(t => t.id))
    }
  }

  // ── Category pill toggle ─────────────────────────────────────────────────
  function toggleCategory(name) {
    setActiveCategoryName(name)
    trackEvent('nearby_category_selected', {})
  }

  // ── Display items ────────────────────────────────────────────────────────
  const displayItems = useMemo(() => {
    let base

    if (tagResultItems !== null) {
      base = [...tagResultItems]
    } else {
      base = [...nearbyItems]
    }

    // Post-checkin: exclude the checked-in item, recompute distances from checkin origin
    if (postCheckin?.lat && postCheckin?.lng) {
      base = base.filter(i => i.id !== postCheckin.itemId)
      if (tagResultItems === null) {
        base = base.map(item => {
          if (!item.maps_lat || !item.maps_lng) return item
          const d = haversineMeters(postCheckin.lat, postCheckin.lng, item.maps_lat, item.maps_lng)
          return { ...item, dist_m: d, dist_label: distLabel(d), withinRadius: isWithinNearbyRadius(d) }
        }).filter(i => i.withinRadius !== false)
      }
    }

    // Category filter — AND with any active tag search
    if (activeCategoryName && activeCategoryName !== 'All') {
      base = base.filter(i => i.categoryName === activeCategoryName)
    }

    // Real completion source of truth (lib/nearbyCompletedItems.js, bulk-
    // fetched above, mirroring ItemDetailScreen.jsx's loadCheckedState()
    // semantics) replaces the augmentWithDistance/useNearby hardcoded
    // `checked: false` placeholder here, at the point of consumption —
    // completed items stay in the list (rendered de-emphasized by
    // NearbyResultRow, never hidden) unless Not Done is active.
    base = base.map(item => ({ ...item, checked: completedItemIds.has(item.id) }))

    // Saved / Not Done — independent boolean filters, AND'd together and
    // with everything above (lib/nearbyFilterState.js).
    base = computeVisibleNearbyItems({
      items: base, savedOnly, notDoneOnly, savedItemIds, completedItemIds,
    })

    // Geography first, relevance second: continuous distance-based score
    // with a bounded relevance discount — no named bands, no distance
    // cliffs. A far item can never be discounted enough to beat a close
    // one — see lib/nearbyRanking.js.
    return rankNearbyItems(base, tagMatchData.counts)
  }, [nearbyItems, tagResultItems, postCheckin, tagMatchData, activeCategoryName, savedOnly, notDoneOnly, savedItemIds, completedItemIds])

  // ── Navigation ───────────────────────────────────────────────────────────
  function openItem(item) {
    Keyboard.dismiss()
    trackEvent('nearby_result_tap', { itemId: item?.id })
    // Secret-reveal redirect is centralized in ItemDetailScreen itself
    // (mount-time guard) — not decided here anymore.
    navigation.navigate('ItemDetail', { item, listId: null, listTitle: 'Discover' })
  }

  const handleToggleSaved = useCallback((itemId) => {
    toggleSaved(itemId, navigation)
  }, [toggleSaved, navigation])

  async function openAppSettings() {
    try {
      if (Platform.OS === 'ios') {
        await Linking.openURL('app-settings:')
      } else {
        await Linking.openSettings()
      }
    } catch (e) {
      console.warn('openAppSettings failed:', e?.message ?? e)
    }
  }

  // ── Render helpers ───────────────────────────────────────────────────────
  // Memoized (React.memo'd component + a stable useCallback here) so a
  // Saved toggle on one row — which only changes the shared
  // SavedItemsContext Set, not the item list itself — doesn't force every
  // other row to re-render. keyExtractor is likewise stable.
  const renderItem = useCallback(({ item }) => {
    const matchCnt = tagMatchData.counts[String(item.id)] ?? 0
    return (
      <NearbyResultRow
        item={item}
        colors={colors}
        onPress={() => openItem(item)}
        onToggleSaved={() => handleToggleSaved(item.id)}
        saved={savedItemIds.has(item.id)}
        completed={!!item.checked}
        matchCount={matchCnt}
      />
    )
  }, [tagMatchData, colors, savedItemIds, handleToggleSaved])

  const keyExtractor = useCallback(item => String(item.id), [])

  const hasActiveSearch = tagResultItems !== null || (activeCategoryName !== null && activeCategoryName !== 'All')
  const hasActiveFilters = hasActiveSearch || savedOnly || notDoneOnly

  const emptyReason = savedOnly && notDoneOnly
    ? 'No saved, not-yet-done items match. Try clearing a filter.'
    : savedOnly
    ? 'Nothing saved nearby yet.'
    : notDoneOnly
    ? 'Looks like you’ve done everything nearby — nice work.'
    : hasActiveSearch
    ? 'No items match these filters. Try removing one or adjusting your search.'
    : searchText.length >= 2
    ? 'No items found. Try a different search term.'
    : 'No location-specific items found near you.'

  if (locError) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
        <View style={styles.errorIconWrap}>
          <Text style={styles.errorIcon}>⌖</Text>
        </View>
        <Text style={styles.errorTitle}>Location needed</Text>
        <Text style={styles.errorSub}>{locError}</Text>
        <TouchableOpacity style={styles.settingsBtn} onPress={openAppSettings} activeOpacity={0.88}>
          <Text style={styles.settingsBtnText}>Open Settings</Text>
        </TouchableOpacity>
      </View>
    )
  }

  if (nearbyLoading && nearbyItems.length === 0 && tagResultItems === null) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator color={AMBER} size="large" />
        <Text style={styles.loadingText}>Finding things near you…</Text>
        {!location && <Text style={styles.loadingSub}>Getting your location</Text>}
      </View>
    )
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
      >
        <FlatList
          data={displayItems}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          refreshControl={
            <RefreshControl
              refreshing={!!nearbyRefreshing}
              onRefresh={refreshNearby}
              tintColor={AMBER}
            />
          }
          ListHeaderComponent={
            <ListHeader
              styles={styles}
              searchText={searchText}
              setSearchText={setSearchText}
              suggestions={suggestions}
              activeTags={activeTags}
              selectTag={selectTag}
              removeTag={removeTag}
              categories={categories}
              activeCategoryName={activeCategoryName}
              toggleCategory={toggleCategory}
              clearCategory={clearCategory}
              displayCount={displayItems.length}
              loadingSearch={loadingSearch}
              bannerVisible={bannerVisible}
              dismissBanner={dismissBanner}
              pulseAnim={pulseAnim}
              clearSearch={clearSearch}
              savedOnly={savedOnly}
              toggleSavedFilter={toggleSavedFilter}
              notDoneOnly={notDoneOnly}
              toggleNotDoneFilter={toggleNotDoneFilter}
              selectAllFilter={selectAllFilter}
              windowWidth={windowWidth}
              nearestNeighborhoodName={nearbyItems[0]?.neighborhoodName ?? null}
            />
          }
          ListEmptyComponent={
            !nearbyLoading ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>Nothing found</Text>
                <Text style={styles.emptySub}>{emptyReason}</Text>
                {hasActiveFilters && (
                  <TouchableOpacity
                    style={styles.clearBtn}
                    onPress={() => { clearSearch(); selectAllFilter() }}
                    accessibilityRole="button"
                    accessibilityLabel="Clear filters"
                  >
                    <Text style={styles.clearBtnText}>Clear filters</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : null
          }
        />
      </KeyboardAvoidingView>
    </View>
  )
}

// ── List header ─────────────────────────────────────────────────────────────
function ListHeader({
  styles, searchText, setSearchText, suggestions, activeTags,
  selectTag, removeTag, categories, activeCategoryName, toggleCategory,
  displayCount, loadingSearch,
  bannerVisible, dismissBanner, pulseAnim, clearSearch, clearCategory,
  savedOnly, toggleSavedFilter, notDoneOnly, toggleNotDoneFilter, selectAllFilter,
  windowWidth, nearestNeighborhoodName,
}) {
  const { colors } = useTheme()
  const { TEXT, MUTED, AMBER: THEME_AMBER } = colors
  const [searchFocused, setSearchFocused] = useState(false)
  const metaInline = windowWidth >= SEARCH_META_INLINE_MIN_WIDTH
  const allActive = isAllFilterActive({ savedOnly, notDoneOnly, activeCategoryName })

  return (
    <>
      {/* Minimal, honest header — see final report for what the approved
          mockup's streak pill / city name / "Near you · Exploring
          locally" status block deliberately omit here: DiscoverScreen has
          never fetched streak or metro/city data, and fabricating a new
          parallel fetch just to imitate that block was explicitly ruled
          out. The location line below uses only data this screen already
          has in memory (the nearest already-fetched item's own
          neighborhood name) — zero new queries. */}
      <View style={styles.header}>
        <Text style={styles.wordmark} allowFontScaling={false}>
          <Text style={{ color: TEXT }}>Check</Text>
          <Text style={{ color: THEME_AMBER }}>Off</Text>
        </Text>
        <View style={styles.headerLocRow}>
          <Text
            style={styles.headerPin}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >⌖</Text>
          <Text style={styles.headerLocText}>{nearestNeighborhoodName ?? 'Exploring locally'}</Text>
        </View>
      </View>

      {/* Post-checkin banner */}
      {bannerVisible && (
        <Animated.View style={[styles.banner, { opacity: pulseAnim }]}>
          <Text style={styles.bannerText}>
            While you're out — Nearby items tagged like what you just checked off
          </Text>
          <TouchableOpacity onPress={dismissBanner} style={styles.bannerClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={styles.bannerCloseText}>✕</Text>
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* Search module */}
      <View style={[styles.searchModule, !metaInline && styles.searchModuleWrap]}>
        <View style={styles.searchRow}>
          <Text
            style={styles.searchIcon}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >⌕</Text>
          <TextInput
            style={[styles.searchInput, { color: TEXT }]}
            placeholder="Search nearby experiences"
            placeholderTextColor={MUTED}
            value={searchText}
            onChangeText={setSearchText}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            onSubmitEditing={() => Keyboard.dismiss()}
            accessibilityLabel="Search nearby experiences"
            accessibilityHint="Searches item descriptions and tags near your location"
          />
          {loadingSearch && <ActivityIndicator size="small" color={MUTED} style={{ marginRight: 4 }} />}
          {searchText.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearchText('')}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.searchClearBtn}
              accessibilityRole="button"
              accessibilityLabel="Clear search text"
            >
              <Text style={styles.searchClearText}>×</Text>
            </TouchableOpacity>
          )}
        </View>
        {/* Passive, non-interactive informational text only — never a
            dropdown/press target, no radius control. Moves below the
            search row instead of compressing it once the module is
            narrower than SEARCH_META_INLINE_MIN_WIDTH (large Dynamic
            Type, a narrow device, split-screen) rather than clipping. */}
        <View style={[styles.searchMetaRow, !metaInline && styles.searchMetaRowWrapped]}>
          {metaInline && <View style={styles.searchMetaDivider} />}
          <Text style={styles.searchMetaText}>Using your current location • Up to 100 mi</Text>
        </View>
      </View>

      {/* Tag autocomplete suggestions */}
      {suggestions.length > 0 && (
        <ScrollView
          horizontal showsHorizontalScrollIndicator={false}
          style={styles.suggestRow} contentContainerStyle={styles.suggestContent}
          keyboardShouldPersistTaps="handled"
        >
          {suggestions.map(tag => (
            <TouchableOpacity key={tag.id} style={styles.suggestChip} onPress={() => selectTag(tag)} activeOpacity={0.8}>
              <Text style={styles.suggestChipText}>+ {tag.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Active tag chips */}
      {activeTags.length > 0 && (
        <ScrollView
          horizontal showsHorizontalScrollIndicator={false}
          style={styles.activeTagRow} contentContainerStyle={styles.activeTagContent}
          keyboardShouldPersistTaps="handled"
        >
          {activeTags.map(tag => (
            <TouchableOpacity key={tag.id} style={styles.activeChip} onPress={() => removeTag(tag.id)} activeOpacity={0.75}>
              <Text style={styles.activeChipText}>{tag.name}</Text>
              <Text style={styles.activeChipX}> ✕</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Category tiles — horizontally scrollable, real live category set
          (never hardcoded). A plain ScrollView (not FlatList): the
          category count is small and fixed (~12), so virtualization adds
          nothing but risk of interfering with the outer FlatList's own
          vertical scroll gesture. contentContainerStyle's trailing
          padding keeps the last tile from clipping flush against the
          screen edge. */}
      {categories.length > 0 && (
        <ScrollView
          horizontal showsHorizontalScrollIndicator={false}
          style={styles.categoryRow} contentContainerStyle={styles.categoryContent}
        >
          {categories.map(cat => (
            <CategoryTile
              key={cat.id}
              name={cat.name}
              color={cat.color_hex}
              textColor={TEXT}
              selected={activeCategoryName === cat.name}
              onPress={() => toggleCategory(activeCategoryName === cat.name ? 'All' : cat.name)}
              style={{ marginRight: 10 }}
            />
          ))}
        </ScrollView>
      )}

      {/* Filter row — "All" governs Saved/Not-Done/category only (see
          lib/nearbyFilterState.js's isAllFilterActive docstring); it is
          not a global reset. "Filters" (sliders icon, tag-based) was
          evaluated and deliberately OMITTED — category tiles + Saved +
          Not Done already cover every real filtering capability this
          screen has; a "Filters" pill would only duplicate that with no
          new function. */}
      <View style={styles.filterRow}>
        <TouchableOpacity
          style={[styles.filterPill, allActive && styles.filterPillActive]}
          onPress={selectAllFilter}
          accessibilityRole="button"
          accessibilityLabel="All"
          accessibilityState={{ selected: allActive }}
        >
          <Text style={[styles.filterPillText, allActive && styles.filterPillTextActive]}>All</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterPillOutline, savedOnly && styles.filterPillOutlineActive]}
          onPress={toggleSavedFilter}
          accessibilityRole="button"
          accessibilityLabel="Saved filter"
          accessibilityState={{ selected: savedOnly }}
          accessibilityHint="Shows only items you've saved"
        >
          <Text style={[styles.filterPillOutlineText, savedOnly && styles.filterPillOutlineTextActive]}>Saved</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterPillOutline, notDoneOnly && styles.filterPillOutlineActive]}
          onPress={toggleNotDoneFilter}
          accessibilityRole="button"
          accessibilityLabel="Not Done filter"
          accessibilityState={{ selected: notDoneOnly }}
          accessibilityHint="Hides items you've already completed"
        >
          <Text style={[styles.filterPillOutlineText, notDoneOnly && styles.filterPillOutlineTextActive]}>Not Done</Text>
        </TouchableOpacity>
      </View>

      {/* Section label */}
      <View style={styles.sectionLabelRow}>
        <Text style={styles.sectionLabel}>NEAR YOU</Text>
        <Text style={styles.sectionSub}>{displayCount} {displayCount === 1 ? 'experience' : 'experiences'}</Text>
      </View>
    </>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────
function createStyles({ BG, CARD, TEXT, MUTED, BORDER, SOFT_2 }) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: BG },
    center:    { alignItems: 'center', justifyContent: 'center', flex: 1, padding: 32, backgroundColor: BG },

    banner:         { flexDirection: 'row', alignItems: 'center', backgroundColor: NAVY, marginHorizontal: 16, marginTop: 8, borderRadius: 14, padding: 12, borderWidth: 1.5, borderColor: AMBER, gap: 10 },
    bannerText:     { flex: 1, fontSize: 13, color: AMBER, fontWeight: '700', lineHeight: 18 },
    bannerClose:    { padding: 4 },
    bannerCloseText:{ fontSize: 14, color: AMBER, fontWeight: '700' },

    header:        { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 4, gap: 4 },
    wordmark:      { fontSize: 20, fontWeight: '900', letterSpacing: -0.3 },
    headerLocRow:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
    headerPin:     { fontSize: 12, color: MUTED },
    headerLocText: { fontSize: 12, color: MUTED, fontWeight: '700' },

    searchModule:      { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 10, marginBottom: 10, backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: `${AMBER}40`, paddingHorizontal: 12, minHeight: 48 },
    searchModuleWrap:  { flexDirection: 'column', alignItems: 'stretch', paddingVertical: 8 },
    searchRow:         { flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 44 },
    searchIcon:        { fontSize: 17, color: MUTED, marginRight: 8 },
    searchInput:       { flex: 1, fontSize: 14, fontWeight: '600', minHeight: 44, paddingVertical: 8 },
    searchClearBtn:    { paddingLeft: 6 },
    searchClearText:   { fontSize: 18, color: MUTED, fontWeight: '700' },
    searchMetaRow:      { flexDirection: 'row', alignItems: 'center' },
    searchMetaRowWrapped: { marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: BORDER },
    searchMetaDivider: { width: 1, height: 14, backgroundColor: BORDER, marginRight: 10 },
    searchMetaText:    { fontSize: 11, color: MUTED, fontWeight: '600' },

    suggestRow:     { flexGrow: 0, marginBottom: 4 },
    suggestContent: { paddingHorizontal: 16, gap: 8, paddingVertical: 4 },
    suggestChip:    { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: `${AMBER}18`, borderWidth: 1, borderColor: `${AMBER}50` },
    suggestChipText:{ fontSize: 13, color: '#9A6A00', fontWeight: '700' },

    activeTagRow:     { flexGrow: 0, marginBottom: 6 },
    activeTagContent: { paddingHorizontal: 16, gap: 8, paddingVertical: 4 },
    activeChip:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: AMBER, borderWidth: 1, borderColor: AMBER },
    activeChipText:   { fontSize: 13, color: NAVY, fontWeight: '800' },
    activeChipX:      { fontSize: 11, color: NAVY, fontWeight: '700' },

    categoryRow:     { flexGrow: 0, marginBottom: 10 },
    categoryContent: { paddingHorizontal: 16, paddingVertical: 2, paddingRight: 24 },

    filterRow:              { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, marginBottom: 14 },
    filterPill:             { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD, minHeight: 44, justifyContent: 'center' },
    filterPillActive:       { backgroundColor: AMBER, borderColor: AMBER },
    filterPillText:         { fontSize: 13, color: TEXT, fontWeight: '800' },
    filterPillTextActive:   { color: NAVY },
    filterPillOutline:      { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: BORDER, backgroundColor: 'transparent', minHeight: 44, justifyContent: 'center' },
    filterPillOutlineActive:{ borderColor: AMBER, backgroundColor: `${AMBER}18` },
    filterPillOutlineText:      { fontSize: 13, color: MUTED, fontWeight: '700' },
    filterPillOutlineTextActive:{ color: '#9A6A00' },

    sectionLabelRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 10 },
    sectionLabel:    { fontSize: 12, fontWeight: '800', color: MUTED, letterSpacing: 1.2 },
    sectionSub:      { fontSize: 12, fontWeight: '600', color: MUTED },

    sep: { height: 10 },

    errorIconWrap:   { width: 72, height: 72, borderRadius: 36, backgroundColor: SOFT_2, borderWidth: 1, borderColor: '#DED3C5', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
    errorIcon:       { fontSize: 34, color: '#A79A89' },
    errorTitle:      { fontSize: 22, fontWeight: '800', color: TEXT, marginBottom: 8, textAlign: 'center' },
    errorSub:        { fontSize: 14, color: MUTED, textAlign: 'center', lineHeight: 20, marginBottom: 24, fontWeight: '600' },
    settingsBtn:     { backgroundColor: AMBER, borderRadius: 999, paddingHorizontal: 24, paddingVertical: 12 },
    settingsBtnText: { fontSize: 14, fontWeight: '800', color: NAVY },
    loadingText:     { fontSize: 15, color: TEXT, fontWeight: '700', marginTop: 16 },
    loadingSub:      { fontSize: 12, color: MUTED, marginTop: 6, fontWeight: '600' },

    empty:        { alignItems: 'center', justifyContent: 'center', padding: 32, marginTop: 10 },
    emptyTitle:   { fontSize: 18, fontWeight: '800', color: TEXT, marginBottom: 8, textAlign: 'center' },
    emptySub:     { fontSize: 13, color: MUTED, textAlign: 'center', lineHeight: 19, fontWeight: '600', maxWidth: 300, marginBottom: 20 },
    clearBtn:     { backgroundColor: AMBER, borderRadius: 999, paddingHorizontal: 24, paddingVertical: 12 },
    clearBtnText: { fontSize: 14, fontWeight: '800', color: NAVY },
  })
}
