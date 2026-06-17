import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, TextInput,
  ActivityIndicator, Animated, Platform, Linking, ScrollView,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect } from '@react-navigation/native'
import { useNearby } from '../lib/useNearby'
import { useTheme } from '../lib/ThemeContext'
import { supabase } from '../lib/supabase'

const AMBER = '#F5A623'
const NAVY  = '#1A1A2E'

const RING_RADII = [12875, 32187, 64374, 96561]
const MAX_DEST_M = 804672

const RINGS = [
  { weight: 0, label: 'Core',        color: '#1D9E75' },
  { weight: 1, label: 'Near',        color: '#378ADD' },
  { weight: 2, label: 'Metro',       color: '#BA7517' },
  { weight: 3, label: 'Destination', color: '#D85A30' },
]

const QUICK_PICKS = [
  { label: 'Bars & Drinks', tags: ['bar', 'drinks', 'beer', 'cocktails', 'happy hour', 'wine', 'brewery', 'pub'] },
  { label: 'Food',          tags: ['food', 'restaurant', 'brunch', 'tacos', 'pizza', 'coffee', 'eat', 'diner', 'cafe'] },
  { label: 'Active',        tags: ['hiking', 'sports', 'fitness', 'yoga', 'running', 'biking', 'active', 'outdoors', 'gym'] },
  { label: 'Night Out',     tags: ['nightlife', 'club', 'live music', 'concert', 'dancing', 'karaoke', 'DJ', 'late night'] },
  { label: 'Play',          tags: ['games', 'darts', 'bowling', 'mini golf', 'arcade', 'trivia', 'pool', 'pinball', 'billiards'] },
  { label: 'Chill',         tags: ['park', 'art', 'museum', 'bookstore', 'coffee shop', 'relax', 'patio', 'scenic', 'view'] },
]

function distMeters(lat1, lng1, lat2, lng2) {
  const R    = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lng2 - lng1) * Math.PI / 180
  const a    = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function distLabel(m) {
  if (m < 160)  return 'Right here'
  if (m < 1609) return `${Math.round(m / 100) * 100}m away`
  const mi = m / 1609.34
  return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`
}

function ringForDist(m) {
  if (m < RING_RADII[0]) return 0
  if (m < RING_RADII[1]) return 1
  if (m < RING_RADII[2]) return 2
  if (m < MAX_DEST_M)    return 3
  return -1
}

// Augment raw item rows (from items table) with computed distance/ring
function augmentWithDistance(rawItems, userCoords) {
  return (rawItems ?? []).map(item => {
    let dist = null
    let ring = 0
    if (item.maps_lat && item.maps_lng && userCoords) {
      dist = distMeters(userCoords.latitude, userCoords.longitude, item.maps_lat, item.maps_lng)
      ring = ringForDist(dist)
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
      checked:          false,
      isUniversal:      false,
      hasExactLocation: !!(item.maps_lat && item.maps_lng),
      dist_m:           dist ?? 99999999,
      dist_label:       dist ? distLabel(dist) : null,
      ring_weight:      ring,
    }
  }).filter(i => !userCoords || i.ring_weight !== -1)
}

export default function DiscoverScreen({ navigation, route }) {
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const { BG, CARD, TEXT, MUTED, BORDER, SOFT_2 } = colors
  const styles = useMemo(() => createStyles({ BG, CARD, TEXT, MUTED, BORDER, SOFT_2 }),
    [BG, CARD, TEXT, MUTED, BORDER, SOFT_2])

  const { items: nearbyItems, loading: nearbyLoading, locError, location } = useNearby()

  // Search state
  const [searchText, setSearchText]     = useState('')
  const [suggestions, setSuggestions]   = useState([])
  const [activeTags, setActiveTags]     = useState([])   // [{id, name}] — manually tapped
  const [activeQuickPick, setActiveQuickPick] = useState(null)  // label of selected group

  // Result state — either direct DB items (tag search) or null (use nearbyItems)
  const [tagResultItems, setTagResultItems] = useState(null)  // array|null
  const [tagMatchData, setTagMatchData]     = useState({ counts: {} })
  const [bodyMatchIds, setBodyMatchIds]     = useState(null)  // Set<string>|null — body fallback
  const [loadingSearch, setLoadingSearch]   = useState(false)

  // Checked-in items (grayed out in Discover)
  const [checkedIds, setCheckedIds] = useState(new Set())

  // Post-checkin mode
  const [postCheckin, setPostCheckin]   = useState(null)
  const [bannerVisible, setBannerVisible] = useState(false)
  const pulseAnim    = useRef(new Animated.Value(1)).current
  const appliedParamsRef = useRef(null)
  const debounceRef  = useRef(null)

  // ── Load checked IDs ─────────────────────────────────────────────────────
  useEffect(() => { loadCheckedIds() }, [])

  async function loadCheckedIds() {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('check_ins')
        .select('list_items(item_id)')
        .eq('user_id', user.id)
      setCheckedIds(new Set(
        (data ?? []).map(ci => ci.list_items?.item_id).filter(Boolean).map(String)
      ))
    } catch { /* non-critical */ }
  }

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

  function clearSearch() {
    setActiveTags([])
    setTagResultItems(null)
    setTagMatchData({ counts: {} })
    setBodyMatchIds(null)
    setSearchText('')
    setSuggestions([])
    setActiveQuickPick(null)
  }

  // ── Search: debounced ────────────────────────────────────────────────────
  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (searchText.length < 2) {
      setSuggestions([])
      // Only clear tag results from live search, not from active tag chips
      if (activeTags.length === 0) {
        setTagResultItems(null)
        setBodyMatchIds(null)
      }
      return
    }
    debounceRef.current = setTimeout(() => runSearch(searchText), 300)
    return () => clearTimeout(debounceRef.current)
  }, [searchText])

  async function runSearch(text) {
    setLoadingSearch(true)
    try {
      const { data: tagRows, error: tagErr } = await supabase
        .from('tags').select('id, name').ilike('name', `%${text}%`).order('name').limit(8)

      if (__DEV__ && tagErr) console.log('tags query error:', tagErr?.message)

      const found = tagRows ?? []
      const activeIds = new Set(activeTags.map(t => t.id))
      setSuggestions(found.filter(t => !activeIds.has(t.id)))

      if (found.length > 0) {
        // Tags found — query items directly so we get results even if they lack neighborhood_id
        const allTagIds = found.map(t => t.id)
        await fetchTagResultItems(allTagIds)
        setBodyMatchIds(null)
      } else if (activeTags.length === 0) {
        // No matching tags — fall back to body text search on nearbyItems
        setTagResultItems(null)
        const { data: bodyItems } = await supabase
          .from('items').select('id')
          .ilike('body', `%${text}%`)
          .eq('is_active', true).eq('is_approved', true).eq('is_universal', false)
          .limit(100)
        setBodyMatchIds(new Set((bodyItems ?? []).map(i => String(i.id))))
      } else {
        setTagResultItems(null)
        setBodyMatchIds(null)
      }
    } catch (e) {
      if (__DEV__) console.log('runSearch error:', e?.message)
    }
    setLoadingSearch(false)
  }

  // ── Core: fetch items by tag IDs directly from DB ────────────────────────
  // Used by: typed search, chip selection, quick-pick taps, post-checkin
  async function fetchTagResultItems(tagIds) {
    if (!tagIds.length) {
      setTagResultItems(null)
      setTagMatchData({ counts: {} })
      return
    }
    try {
      // Step 1: which items have these tags, and how many?
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

      // Step 2: fetch full item data
      const { data: rawItems, error: itemErr } = await supabase
        .from('items')
        .select(`
          id, body, difficulty, maps_lat, maps_lng, is_active, is_approved,
          is_secret, secret_reveal_text, has_alcohol,
          partner_id, maps_query, website_url, geo_radius_m,
          categories(name, color_hex),
          neighborhoods!items_neighborhood_id_fkey(name),
          partners(business_name)
        `)
        .in('id', matchedIds.slice(0, 100))
        .eq('is_active', true)
        .eq('is_approved', true)
      if (__DEV__ && itemErr) console.log('items fetch error:', itemErr?.message)

      // Step 3: augment with distance from user's location
      const augmented = augmentWithDistance(rawItems, location)
      setTagResultItems(augmented)
    } catch (e) {
      if (__DEV__) console.log('fetchTagResultItems error:', e?.message)
      setTagResultItems([])
    }
  }

  // ── Tag chip selection ───────────────────────────────────────────────────
  function selectTag(tag) {
    if (activeTags.some(t => t.id === tag.id)) return
    const next = [...activeTags, tag]
    setActiveTags(next)
    setSuggestions([])
    setSearchText('')
    setBodyMatchIds(null)
    fetchTagResultItems(next.map(t => t.id))
  }

  function removeTag(tagId) {
    const next = activeTags.filter(t => t.id !== tagId)
    setActiveTags(next)
    if (next.length === 0) {
      setTagResultItems(null)
      setTagMatchData({ counts: {} })
      setActiveQuickPick(null)
    } else {
      fetchTagResultItems(next.map(t => t.id))
    }
  }

  // ── Quick-pick group taps ────────────────────────────────────────────────
  async function applyQuickPick(qp) {
    if (activeQuickPick === qp.label) {
      // Toggle off
      setActiveQuickPick(null)
      setActiveTags([])
      setTagResultItems(null)
      setTagMatchData({ counts: {} })
      return
    }
    setSuggestions([])
    setSearchText('')
    setActiveQuickPick(qp.label)
    try {
      const filter = qp.tags.map(t => `name.ilike.%${t}%`).join(',')
      const { data } = await supabase.from('tags').select('id, name').or(filter).limit(30)
      const found = data ?? []
      if (!found.length) return
      setActiveTags(found)
      fetchTagResultItems(found.map(t => t.id))
    } catch { /* non-critical */ }
  }

  // ── Display items ────────────────────────────────────────────────────────
  const displayItems = useMemo(() => {
    let base

    if (tagResultItems !== null) {
      // Tag/search results from direct DB query
      base = [...tagResultItems]
    } else {
      // Default: nearby items (already ring-sorted by useNearby)
      base = [...nearbyItems]
    }

    // Post-checkin: exclude the checked-in item, recompute distances from checkin origin
    if (postCheckin?.lat && postCheckin?.lng) {
      base = base.filter(i => i.id !== postCheckin.itemId)
      // For nearbyItems (not already-computed tag results), recompute distances
      if (tagResultItems === null) {
        base = base.map(item => {
          if (!item.maps_lat || !item.maps_lng) return item
          const d    = distMeters(postCheckin.lat, postCheckin.lng, item.maps_lat, item.maps_lng)
          const ring = ringForDist(d)
          return { ...item, dist_m: d, dist_label: distLabel(d), ring_weight: ring }
        }).filter(i => i.ring_weight !== -1)
      }
    }

    // Body text fallback filter on nearbyItems (only when no tag results)
    if (tagResultItems === null && bodyMatchIds !== null) {
      base = base.filter(i => bodyMatchIds.has(String(i.id)))
    }

    // Sort: tag match count desc → ring asc → distance asc
    return base.sort((a, b) => {
      const ac = tagMatchData.counts[String(a.id)] ?? 0
      const bc = tagMatchData.counts[String(b.id)] ?? 0
      if (bc !== ac) return bc - ac
      const ar = a.ring_weight ?? 99
      const br = b.ring_weight ?? 99
      if (ar !== br) return ar - br
      return (a.dist_m ?? 9999999) - (b.dist_m ?? 9999999)
    })
  }, [nearbyItems, tagResultItems, postCheckin, tagMatchData, bodyMatchIds])

  // ── Navigation ───────────────────────────────────────────────────────────
  function openItem(item) {
    if (item.is_secret) {
      navigation.navigate('SecretReveal', { item, listItemId: null })
      return
    }
    navigation.navigate('ItemDetail', { item, listId: null, listTitle: 'Discover' })
  }

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
  function renderItem({ item }) {
    const ring      = RINGS.find(r => r.weight === item.ring_weight) ?? RINGS[0]
    const isChecked = checkedIds.has(String(item.id))
    const matchCnt  = tagMatchData.counts[String(item.id)] ?? 0

    return (
      <TouchableOpacity
        style={[styles.rowCard, isChecked && styles.rowCardChecked]}
        onPress={() => openItem(item)}
        activeOpacity={0.85}
      >
        <View style={styles.rowLeft}>
          <View style={[styles.catDotWrap, {
            backgroundColor: `${item.categoryColor ?? '#888'}18`,
            borderColor:     `${item.categoryColor ?? '#888'}30`,
          }]}>
            <View style={[styles.catDot, { backgroundColor: item.categoryColor ?? '#888' }]} />
          </View>
        </View>

        <View style={styles.rowBody}>
          <Text
            style={[styles.rowText, isChecked && styles.rowTextChecked]}
            numberOfLines={2}
          >
            {item.is_secret
              ? (item.partnerName ? `🔒 Secret at ${item.partnerName}` : '🔒 Secret item')
              : item.body}
          </Text>
          <View style={styles.rowMeta}>
            <View style={[styles.ringDotSmall, { backgroundColor: ring.color }]} />
            {item.dist_label && (
              <Text style={[styles.distLabel, !item.hasExactLocation && { color: MUTED, fontWeight: '600' }]}>
                {item.hasExactLocation ? item.dist_label : `~${item.dist_label}`}
              </Text>
            )}
            {item.neighborhoodName && (
              <Text style={styles.hoodLabel}>{item.neighborhoodName}</Text>
            )}
            <View style={styles.ptsBadge}>
              <Text style={styles.ptsText}>+{item.difficulty ?? 1} pts</Text>
            </View>
            {matchCnt > 1 && (
              <View style={styles.matchBadge}>
                <Text style={styles.matchText}>{matchCnt} tags</Text>
              </View>
            )}
            {isChecked && <Text style={styles.checkedLabel}>✓ done</Text>}
          </View>
        </View>

        <View style={styles.rowRight}>
          <Text style={styles.chevron}>›</Text>
        </View>
      </TouchableOpacity>
    )
  }

  const hasActiveSearch = tagResultItems !== null || bodyMatchIds !== null

  const emptyReason = hasActiveSearch
    ? 'No nearby items match these tags. Try removing one or adjusting your search.'
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
      <FlatList
        data={displayItems}
        keyExtractor={item => String(item.id)}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        keyboardShouldPersistTaps="handled"
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        ListHeaderComponent={
          <ListHeader
            styles={styles}
            searchText={searchText}
            setSearchText={setSearchText}
            suggestions={suggestions}
            activeTags={activeTags}
            selectTag={selectTag}
            removeTag={removeTag}
            activeQuickPick={activeQuickPick}
            applyQuickPick={applyQuickPick}
            displayCount={displayItems.length}
            hasActiveSearch={hasActiveSearch}
            loadingSearch={loadingSearch}
            location={location}
            bannerVisible={bannerVisible}
            dismissBanner={dismissBanner}
            pulseAnim={pulseAnim}
            clearSearch={clearSearch}
          />
        }
        ListEmptyComponent={
          !nearbyLoading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Nothing found</Text>
              <Text style={styles.emptySub}>{emptyReason}</Text>
              {hasActiveSearch && (
                <TouchableOpacity style={styles.clearBtn} onPress={clearSearch}>
                  <Text style={styles.clearBtnText}>Clear filters</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : null
        }
      />
    </View>
  )
}

// ── List header ─────────────────────────────────────────────────────────────
function ListHeader({
  styles, searchText, setSearchText, suggestions, activeTags,
  selectTag, removeTag, activeQuickPick, applyQuickPick,
  displayCount, hasActiveSearch, loadingSearch, location,
  bannerVisible, dismissBanner, pulseAnim, clearSearch,
}) {
  const { colors } = useTheme()
  const { TEXT, MUTED } = colors

  return (
    <>
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

      {/* Search bar */}
      <View style={styles.searchWrap}>
        <Text style={styles.searchIcon}>⌕</Text>
        <TextInput
          style={[styles.searchInput, { color: TEXT }]}
          placeholder="Search by vibe — darts, brunch, hiking…"
          placeholderTextColor={MUTED}
          value={searchText}
          onChangeText={setSearchText}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {loadingSearch && <ActivityIndicator size="small" color={MUTED} style={{ marginRight: 8 }} />}
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

      {/* Quick-pick group pills (visible whenever no search text) */}
      {searchText.length === 0 && (
        <ScrollView
          horizontal showsHorizontalScrollIndicator={false}
          style={styles.quickPickRow} contentContainerStyle={styles.quickPickContent}
        >
          {QUICK_PICKS.map(qp => {
            const on = activeQuickPick === qp.label
            return (
              <TouchableOpacity
                key={qp.label}
                style={[styles.quickPill, on && styles.quickPillActive]}
                onPress={() => applyQuickPick(qp)}
                activeOpacity={0.8}
              >
                <Text style={[styles.quickPillText, on && styles.quickPillTextActive]}>{qp.label}</Text>
              </TouchableOpacity>
            )
          })}
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

    searchWrap:  { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 8, marginBottom: 8, backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 12, height: 44 },
    searchIcon:  { fontSize: 18, color: MUTED, marginRight: 8 },
    searchInput: { flex: 1, fontSize: 14, fontWeight: '600', height: 44 },

    suggestRow:     { flexGrow: 0, marginBottom: 4 },
    suggestContent: { paddingHorizontal: 16, gap: 8, paddingVertical: 4 },
    suggestChip:    { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: `${AMBER}18`, borderWidth: 1, borderColor: `${AMBER}50` },
    suggestChipText:{ fontSize: 13, color: '#9A6A00', fontWeight: '700' },

    quickPickRow:        { flexGrow: 0, marginBottom: 6 },
    quickPickContent:    { paddingHorizontal: 16, gap: 8, paddingVertical: 4 },
    quickPill:           { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD },
    quickPillActive:     { borderColor: AMBER, backgroundColor: `${AMBER}18` },
    quickPillText:       { fontSize: 13, color: TEXT, fontWeight: '700' },
    quickPillTextActive: { color: '#9A6A00' },

    activeTagRow:     { flexGrow: 0, marginBottom: 6 },
    activeTagContent: { paddingHorizontal: 16, gap: 8, paddingVertical: 4 },
    activeChip:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: AMBER, borderWidth: 1, borderColor: AMBER },
    activeChipText:   { fontSize: 13, color: NAVY, fontWeight: '800' },
    activeChipX:      { fontSize: 11, color: NAVY, fontWeight: '700' },

    rowCard:        { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, paddingVertical: 14, paddingHorizontal: 14, gap: 12, backgroundColor: CARD, borderRadius: 18, borderWidth: 1, borderColor: BORDER },
    rowCardChecked: { opacity: 0.45 },
    rowLeft:        { width: 28, alignItems: 'center' },
    catDotWrap:     { width: 22, height: 22, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
    catDot:         { width: 8, height: 8, borderRadius: 4 },
    rowBody:        { flex: 1 },
    rowText:        { fontSize: 15, color: TEXT, lineHeight: 21, fontWeight: '700' },
    rowTextChecked: { textDecorationLine: 'line-through' },
    rowMeta:        { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' },
    ringDotSmall:   { width: 6, height: 6, borderRadius: 3, flexShrink: 0 },
    distLabel:      { fontSize: 11, color: '#9A6A00', fontWeight: '800' },
    hoodLabel:      { fontSize: 11, color: MUTED, fontWeight: '600' },
    ptsBadge:       { backgroundColor: '#FFF7E8', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: '#F5C660' },
    ptsText:        { fontSize: 11, color: '#9A6A00', fontWeight: '800' },
    matchBadge:     { backgroundColor: `${AMBER}18`, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: `${AMBER}50` },
    matchText:      { fontSize: 10, color: '#9A6A00', fontWeight: '700' },
    checkedLabel:   { fontSize: 11, color: MUTED, fontWeight: '700' },
    rowRight:       { width: 20, alignItems: 'center' },
    chevron:        { fontSize: 20, color: '#B0A69A', fontWeight: '600' },
    sep:            { height: 10 },

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
