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

// Mirror the ring system from useNearby — not rebuilt, just referenced here
const RING_RADII = [12875, 32187, 64374, 96561]
const MAX_DEST_M = 804672

const RINGS = [
  { weight: 0, label: 'Core',        sublabel: 'Right in your neighborhood', color: '#1D9E75' },
  { weight: 1, label: 'Near',        sublabel: 'Easy drive',                  color: '#378ADD' },
  { weight: 2, label: 'Metro',       sublabel: 'Worth the trip',              color: '#BA7517' },
  { weight: 3, label: 'Destination', sublabel: 'Special occasion',            color: '#D85A30' },
]

const QUICK_PICKS = [
  { label: 'Bars & Drinks', tags: ['bar', 'drinks', 'beer', 'cocktails', 'happy hour', 'wine', 'brewery', 'pub'] },
  { label: 'Food',          tags: ['food', 'restaurant', 'brunch', 'tacos', 'pizza', 'coffee', 'eat', 'diner', 'cafe'] },
  { label: 'Active',        tags: ['hiking', 'sports', 'fitness', 'yoga', 'running', 'biking', 'active', 'outdoors', 'gym'] },
  { label: 'Night Out',     tags: ['nightlife', 'club', 'live music', 'concert', 'dancing', 'karaoke', 'DJ', 'late night'] },
  { label: 'Play',          tags: ['games', 'darts', 'bowling', 'mini golf', 'arcade', 'trivia', 'pool', 'pinball', 'billiards'] },
  { label: 'Chill',         tags: ['park', 'art', 'museum', 'bookstore', 'coffee shop', 'relax', 'patio', 'scenic', 'view'] },
]

// Distance utilities — mirrors useNearby, not duplicating logic (pure math)
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

export default function DiscoverScreen({ navigation, route }) {
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const { BG, CARD, TEXT, MUTED, BORDER, SOFT_2 } = colors
  const styles = useMemo(() => createStyles({ BG, CARD, TEXT, MUTED, BORDER, SOFT_2 }),
    [BG, CARD, TEXT, MUTED, BORDER, SOFT_2])

  const { items: nearbyItems, loading: nearbyLoading, locError, location } = useNearby()

  // Search
  const [searchText, setSearchText]   = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [activeTags, setActiveTags]   = useState([])   // [{id, name}]
  const [tagMatchData, setTagMatchData] = useState({ ids: new Set(), counts: {} })
  const [bodyMatchIds, setBodyMatchIds] = useState(null)   // Set<id> or null — body text fallback
  const [liveTagIds, setLiveTagIds]     = useState(null)   // Set<id> or null — live filter while typing
  const [loadingSearch, setLoadingSearch] = useState(false)

  // Ring filter
  const [ringFilter, setRingFilter] = useState('all')

  // Checked-in items (grayed out)
  const [checkedIds, setCheckedIds] = useState(new Set())

  // Post-checkin mode
  const [postCheckin, setPostCheckin] = useState(null)  // { lat, lng, itemId }
  const [bannerVisible, setBannerVisible] = useState(false)
  const pulseAnim   = useRef(new Animated.Value(1)).current
  const appliedParamsRef = useRef(null)
  const debounceRef = useRef(null)

  // ── Load checked IDs on mount ────────────────────────────────────────────
  useEffect(() => { loadCheckedIds() }, [])

  async function loadCheckedIds() {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('check_ins')
        .select('list_items(item_id)')
        .eq('user_id', user.id)
      const ids = new Set(
        (data ?? []).map(ci => ci.list_items?.item_id).filter(Boolean)
      )
      setCheckedIds(ids)
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
    setRingFilter('all')

    // Look up tag IDs for the provided tag names (up to 3)
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
          fetchTagItems(found.map(t => t.id))
        }
      } catch { /* non-critical */ }
    }
  }

  // ── Banner pulse animation ───────────────────────────────────────────────
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
    setActiveTags([])
    setTagMatchData({ ids: new Set(), counts: {} })
    setBodyMatchIds(null)
    setRingFilter('all')
  }

  // ── Search: debounced tag autocomplete + body fallback ───────────────────
  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (searchText.length < 2) {
      setSuggestions([])
      setBodyMatchIds(null)
      setLiveTagIds(null)
      return
    }
    debounceRef.current = setTimeout(() => runSearch(searchText), 300)
    return () => clearTimeout(debounceRef.current)
  }, [searchText])

  async function runSearch(text) {
    setLoadingSearch(true)
    try {
      // Tag autocomplete
      const { data: tagRows } = await supabase
        .from('tags')
        .select('id, name')
        .ilike('name', `%${text}%`)
        .order('name')
        .limit(8)

      const found = tagRows ?? []
      // Exclude already-active tags
      const activeIds = new Set(activeTags.map(t => t.id))
      const filtered = found.filter(t => !activeIds.has(t.id))

      setSuggestions(filtered)

      if (found.length > 0) {
        // Tags found — filter the list immediately via item_tags (live filter, no tap required)
        const allTagIds = found.map(t => t.id)
        const { data: tagItemRows } = await supabase
          .from('item_tags')
          .select('item_id')
          .in('tag_id', allTagIds)
        setLiveTagIds(new Set((tagItemRows ?? []).map(r => r.item_id)))
        setBodyMatchIds(null)
      } else if (activeTags.length === 0) {
        // No tags found at all — fall back to body text search
        setLiveTagIds(null)
        const { data: bodyItems } = await supabase
          .from('items')
          .select('id')
          .ilike('body', `%${text}%`)
          .eq('is_active', true)
          .eq('is_approved', true)
          .eq('is_universal', false)
          .limit(100)
        setBodyMatchIds(new Set((bodyItems ?? []).map(i => i.id)))
      } else {
        setLiveTagIds(null)
        setBodyMatchIds(null)
      }
    } catch { /* silently fail */ }
    setLoadingSearch(false)
  }

  // ── Tag selection ────────────────────────────────────────────────────────
  function selectTag(tag) {
    if (activeTags.some(t => t.id === tag.id)) return
    const next = [...activeTags, tag]
    setActiveTags(next)
    setSuggestions([])
    setSearchText('')
    setBodyMatchIds(null)
    setLiveTagIds(null)
    fetchTagItems(next.map(t => t.id))
  }

  function removeTag(tagId) {
    const next = activeTags.filter(t => t.id !== tagId)
    setActiveTags(next)
    if (next.length === 0) {
      setTagMatchData({ ids: new Set(), counts: {} })
    } else {
      fetchTagItems(next.map(t => t.id))
    }
  }

  async function fetchTagItems(tagIds) {
    if (!tagIds.length) return
    try {
      const { data } = await supabase
        .from('item_tags')
        .select('item_id, tag_id')
        .in('tag_id', tagIds)
      const counts = {}
      ;(data ?? []).forEach(row => {
        counts[row.item_id] = (counts[row.item_id] ?? 0) + 1
      })
      setTagMatchData({ ids: new Set(Object.keys(counts)), counts })
    } catch { /* non-critical */ }
  }

  // ── Quick-pick groups ────────────────────────────────────────────────────
  async function applyQuickPick(qp) {
    setSuggestions([])
    setSearchText('')
    try {
      const filter = qp.tags.map(t => `name.ilike.%${t}%`).join(',')
      const { data } = await supabase.from('tags').select('id, name').or(filter).limit(30)
      const found    = data ?? []
      const activeIds = new Set(activeTags.map(t => t.id))
      const newTags  = found.filter(t => !activeIds.has(t.id))
      if (!newTags.length) return
      const next = [...activeTags, ...newTags]
      setActiveTags(next)
      fetchTagItems(next.map(t => t.id))
    } catch { /* non-critical */ }
  }

  // ── Display items computation ────────────────────────────────────────────
  const displayItems = useMemo(() => {
    // Start from nearby items (already location-filtered by useNearby)
    let base = [...nearbyItems]

    // Post-checkin: exclude the checked-in item, recompute distances from checkin origin
    if (postCheckin?.lat && postCheckin?.lng) {
      base = base.filter(i => i.id !== postCheckin.itemId)
      base = base.map(item => {
        if (!item.maps_lat || !item.maps_lng) return item
        const d    = distMeters(postCheckin.lat, postCheckin.lng, item.maps_lat, item.maps_lng)
        const ring = ringForDist(d)
        return { ...item, dist_m: d, dist_label: distLabel(d), ring_weight: ring }
      }).filter(i => i.ring_weight !== -1)
    }

    // Tag filter — active tags (tapped) take priority, then live (typed), then body fallback
    if (activeTags.length > 0) {
      base = base.filter(i => tagMatchData.ids.has(i.id))
    } else if (liveTagIds !== null) {
      base = base.filter(i => liveTagIds.has(i.id))
    } else if (bodyMatchIds !== null) {
      base = base.filter(i => bodyMatchIds.has(i.id))
    }

    // Ring filter
    if (ringFilter !== 'all') {
      base = base.filter(i => i.ring_weight === ringFilter)
    }

    // Sort: tag match count desc, distance asc
    return base.sort((a, b) => {
      const ac = tagMatchData.counts[a.id] ?? 0
      const bc = tagMatchData.counts[b.id] ?? 0
      if (bc !== ac) return bc - ac
      return (a.dist_m ?? 9999999) - (b.dist_m ?? 9999999)
    })
  }, [nearbyItems, postCheckin, activeTags, tagMatchData, liveTagIds, bodyMatchIds, ringFilter])

  // Ring counts (before ring filter, after tag/body filter)
  const ringCounts = useMemo(() => {
    const counts = { 0: 0, 1: 0, 2: 0, 3: 0 }
    let base = [...nearbyItems]
    if (postCheckin?.lat && postCheckin?.lng) {
      base = base.filter(i => i.id !== postCheckin.itemId)
      base = base.map(item => {
        if (!item.maps_lat || !item.maps_lng) return item
        const d    = distMeters(postCheckin.lat, postCheckin.lng, item.maps_lat, item.maps_lng)
        const ring = ringForDist(d)
        return { ...item, ring_weight: ring }
      }).filter(i => i.ring_weight !== -1)
    }
    if (activeTags.length > 0) {
      base = base.filter(i => tagMatchData.ids.has(i.id))
    } else if (liveTagIds !== null) {
      base = base.filter(i => liveTagIds.has(i.id))
    } else if (bodyMatchIds !== null) {
      base = base.filter(i => bodyMatchIds.has(i.id))
    }
    base.forEach(i => { if (i.ring_weight in counts) counts[i.ring_weight]++ })
    return counts
  }, [nearbyItems, postCheckin, activeTags, tagMatchData, liveTagIds, bodyMatchIds])

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
    const ring     = RINGS.find(r => r.weight === item.ring_weight) ?? RINGS[0]
    const isChecked = checkedIds.has(item.id)
    const matchCnt  = tagMatchData.counts[item.id] ?? 0

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
            {/* Ring dot */}
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

  const hasActiveSearch = activeTags.length > 0 || liveTagIds !== null || bodyMatchIds !== null

  const emptyReason = hasActiveSearch
    ? 'No nearby items match these tags. Try removing one or adjusting your search.'
    : searchText.length >= 2
    ? 'No items found. Try a different search term.'
    : 'No location-specific items found near you.'

  // ── Error state ──────────────────────────────────────────────────────────
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

  if (nearbyLoading && nearbyItems.length === 0) {
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
            ringFilter={ringFilter}
            setRingFilter={setRingFilter}
            ringCounts={ringCounts}
            displayCount={displayItems.length}
            hasActiveSearch={hasActiveSearch}
            loadingSearch={loadingSearch}
            applyQuickPick={applyQuickPick}
            location={location}
            bannerVisible={bannerVisible}
            dismissBanner={dismissBanner}
            pulseAnim={pulseAnim}
            postCheckin={postCheckin}
          />
        }
        ListEmptyComponent={
          !nearbyLoading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Nothing found</Text>
              <Text style={styles.emptySub}>{emptyReason}</Text>
              {hasActiveSearch && (
                <TouchableOpacity
                  style={styles.clearBtn}
                  onPress={() => {
                    setActiveTags([])
                    setTagMatchData({ ids: new Set(), counts: {} })
                    setBodyMatchIds(null)
                    setLiveTagIds(null)
                    setSearchText('')
                    setSuggestions([])
                    setRingFilter('all')
                  }}
                >
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

// ── List header component ───────────────────────────────────────────────────
function ListHeader({
  styles, searchText, setSearchText, suggestions, activeTags,
  selectTag, removeTag, ringFilter, setRingFilter, ringCounts,
  displayCount, hasActiveSearch, loadingSearch, applyQuickPick,
  location, bannerVisible, dismissBanner, pulseAnim, postCheckin,
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

      {/* Header title */}
      <View style={styles.headerCard}>
        <Text style={styles.headerTitle}>Discover</Text>
        <Text style={styles.headerSub}>
          {location
            ? `${displayCount} thing${displayCount === 1 ? '' : 's'}${hasActiveSearch ? ' matching your search' : ' near you'}`
            : 'Things to do around you'}
        </Text>
      </View>

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
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.suggestRow}
          contentContainerStyle={styles.suggestContent}
          keyboardShouldPersistTaps="handled"
        >
          {suggestions.map(tag => (
            <TouchableOpacity
              key={tag.id}
              style={styles.suggestChip}
              onPress={() => selectTag(tag)}
              activeOpacity={0.8}
            >
              <Text style={styles.suggestChipText}>+ {tag.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Active tag chips */}
      {activeTags.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.activeTagRow}
          contentContainerStyle={styles.activeTagContent}
          keyboardShouldPersistTaps="handled"
        >
          {activeTags.map(tag => (
            <TouchableOpacity
              key={tag.id}
              style={styles.activeChip}
              onPress={() => removeTag(tag.id)}
              activeOpacity={0.75}
            >
              <Text style={styles.activeChipText}>{tag.name}</Text>
              <Text style={styles.activeChipX}> ✕</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Quick-pick group pills (only when nothing typed or no active tags) */}
      {searchText.length === 0 && activeTags.length === 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.quickPickRow}
          contentContainerStyle={styles.quickPickContent}
        >
          {QUICK_PICKS.map(qp => (
            <TouchableOpacity
              key={qp.label}
              style={styles.quickPill}
              onPress={() => applyQuickPick(qp)}
              activeOpacity={0.8}
            >
              <Text style={styles.quickPillText}>{qp.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Ring filter pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.ringFilterRow}
        contentContainerStyle={styles.ringFilterContent}
      >
        {[
          { key: 'all', label: 'All', count: Object.values(ringCounts).reduce((s, n) => s + n, 0), color: MUTED },
          ...RINGS.map(r => ({ key: r.weight, label: r.label, count: ringCounts[r.weight] ?? 0, color: r.color })),
        ].map(({ key, label, count, color }) => {
          const on = ringFilter === key
          return (
            <TouchableOpacity
              key={String(key)}
              style={[styles.ringPill, on && { borderColor: color, backgroundColor: `${color}18` }]}
              onPress={() => setRingFilter(key)}
              activeOpacity={0.8}
            >
              {key !== 'all' && (
                <View style={[styles.ringPillDot, { backgroundColor: color }]} />
              )}
              <Text style={[styles.ringPillText, on && { color }]}>{label}</Text>
              <Text style={[styles.ringPillCount, on && { color }]}>{count}</Text>
            </TouchableOpacity>
          )
        })}
      </ScrollView>
    </>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────
function createStyles({ BG, CARD, TEXT, MUTED, BORDER, SOFT_2 }) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: BG },
    center:    { alignItems: 'center', justifyContent: 'center', flex: 1, padding: 32, backgroundColor: BG },

    // Post-checkin banner
    banner:         { flexDirection: 'row', alignItems: 'center', backgroundColor: NAVY, marginHorizontal: 16, marginTop: 8, borderRadius: 14, padding: 12, borderWidth: 1.5, borderColor: AMBER, gap: 10 },
    bannerText:     { flex: 1, fontSize: 13, color: AMBER, fontWeight: '700', lineHeight: 18 },
    bannerClose:    { padding: 4 },
    bannerCloseText:{ fontSize: 14, color: AMBER, fontWeight: '700' },

    // Header
    headerCard:  { marginHorizontal: 16, marginTop: 8, marginBottom: 8, backgroundColor: CARD, borderRadius: 24, padding: 18, borderWidth: 1.2, borderColor: BORDER },
    headerTitle: { fontSize: 28, fontWeight: '800', color: TEXT },
    headerSub:   { fontSize: 13, color: MUTED, marginTop: 4, lineHeight: 18, fontWeight: '600' },

    // Search
    searchWrap:  { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 8, backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 12, height: 44 },
    searchIcon:  { fontSize: 18, color: MUTED, marginRight: 8 },
    searchInput: { flex: 1, fontSize: 14, fontWeight: '600', height: 44 },

    // Tag suggestions (autocomplete dropdown)
    suggestRow:     { flexGrow: 0, marginBottom: 4 },
    suggestContent: { paddingHorizontal: 16, gap: 8, paddingVertical: 4 },
    suggestChip:    { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: `${AMBER}18`, borderWidth: 1, borderColor: `${AMBER}50` },
    suggestChipText:{ fontSize: 13, color: '#9A6A00', fontWeight: '700' },

    // Active tag chips
    activeTagRow:     { flexGrow: 0, marginBottom: 6 },
    activeTagContent: { paddingHorizontal: 16, gap: 8, paddingVertical: 4 },
    activeChip:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: AMBER, borderWidth: 1, borderColor: AMBER },
    activeChipText:   { fontSize: 13, color: NAVY, fontWeight: '800' },
    activeChipX:      { fontSize: 11, color: NAVY, fontWeight: '700' },

    // Quick-pick group pills
    quickPickRow:     { flexGrow: 0, marginBottom: 6 },
    quickPickContent: { paddingHorizontal: 16, gap: 8, paddingVertical: 4 },
    quickPill:        { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD },
    quickPillText:    { fontSize: 13, color: TEXT, fontWeight: '700' },

    // Ring filter pills
    ringFilterRow:     { flexGrow: 0, marginBottom: 8 },
    ringFilterContent: { paddingHorizontal: 16, gap: 8, paddingVertical: 4 },
    ringPill:          { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD },
    ringPillDot:       { width: 7, height: 7, borderRadius: 3.5 },
    ringPillText:      { fontSize: 12, color: MUTED, fontWeight: '700' },
    ringPillCount:     { fontSize: 12, color: MUTED, fontWeight: '800' },

    // Result row
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

    // Error / loading
    errorIconWrap:   { width: 72, height: 72, borderRadius: 36, backgroundColor: SOFT_2, borderWidth: 1, borderColor: '#DED3C5', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
    errorIcon:       { fontSize: 34, color: '#A79A89' },
    errorTitle:      { fontSize: 22, fontWeight: '800', color: TEXT, marginBottom: 8, textAlign: 'center' },
    errorSub:        { fontSize: 14, color: MUTED, textAlign: 'center', lineHeight: 20, marginBottom: 24, fontWeight: '600' },
    settingsBtn:     { backgroundColor: AMBER, borderRadius: 999, paddingHorizontal: 24, paddingVertical: 12 },
    settingsBtnText: { fontSize: 14, fontWeight: '800', color: NAVY },
    loadingText:     { fontSize: 15, color: TEXT, fontWeight: '700', marginTop: 16 },
    loadingSub:      { fontSize: 12, color: MUTED, marginTop: 6, fontWeight: '600' },

    // Empty state
    empty:        { alignItems: 'center', justifyContent: 'center', padding: 32, marginTop: 10 },
    emptyTitle:   { fontSize: 18, fontWeight: '800', color: TEXT, marginBottom: 8, textAlign: 'center' },
    emptySub:     { fontSize: 13, color: MUTED, textAlign: 'center', lineHeight: 19, fontWeight: '600', maxWidth: 300, marginBottom: 20 },
    clearBtn:     { backgroundColor: AMBER, borderRadius: 999, paddingHorizontal: 24, paddingVertical: 12 },
    clearBtnText: { fontSize: 14, fontWeight: '800', color: NAVY },
  })
}
