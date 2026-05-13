import React, { useState } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Linking,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNearby } from '../lib/useNearby'

const AMBER = '#F5A623'
const NAVY  = '#1A1A2E'

const BG     = '#FFF9F2'
const CARD   = '#FFFFFF'
const TEXT   = '#243045'
const MUTED  = '#6F7785'
const BORDER = '#E6D8C7'
const SOFT_2 = '#F8F3EC'

// Only location-based rings — universals excluded from Nearby entirely
const RINGS = [
  { weight: 0, label: 'Core',        sublabel: 'Right in your neighborhood', color: '#1D9E75' },
  { weight: 1, label: 'Near',        sublabel: 'Easy drive',                  color: '#378ADD' },
  { weight: 2, label: 'Metro',       sublabel: 'Worth the trip',              color: '#BA7517' },
  { weight: 3, label: 'Destination', sublabel: 'Special occasion',            color: '#D85A30' },
]

export default function NearbyScreen({ navigation }) {
  const insets = useSafeAreaInsets()
  const { items, loading, locError, location, refreshing, refresh } = useNearby()
  const [filter, setFilter] = useState('all')

  // Key decision: Nearby only shows items with a real location
  // Universal items ("Start the wave at a game") have no address — they belong on Browse/lists
  const locationItems = items.filter(item => !item.isUniversal)

  const filtered = locationItems.filter(item => {
    if (filter !== 'all' && item.categoryName !== filter) return false
    return true
  })

  function groupByRing(itemList) {
    const groups = {}
    itemList.forEach(item => {
      const key = item.ring_weight ?? 0
      if (!groups[key]) groups[key] = []
      groups[key].push(item)
    })
    return groups
  }

  const groups   = groupByRing(filtered)
  const ringKeys = Object.keys(groups).map(Number).sort((a, b) => a - b)

  const listData = []
  ringKeys.forEach(ringWeight => {
    const ring = RINGS.find(r => r.weight === ringWeight) ?? RINGS[0]
    listData.push({ type: 'header', ring, count: groups[ringWeight].length })
    groups[ringWeight].forEach(item => listData.push({ type: 'item', item }))
  })

  // Category pills from location items only — no "Partners" pill (B2B detail users don't need)
  const cats = ['all', ...new Set(locationItems.map(i => i.categoryName).filter(Boolean))]

  function openItem(item) {
    if (item.is_secret) {
      // Pass listItemId: null — there's no specific list context from Nearby.
      // PhotoCheckInScreen's fan-out will mark the item across all active lists.
      navigation.navigate('SecretReveal', { item, listItemId: null })
      return
    }
    navigation.navigate('ItemDetail', { item, listId: null, listTitle: 'Nearby' })
  }

  function renderRow({ item: row }) {
    if (row.type === 'header') {
      const { ring } = row
      return (
        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeaderLeft}>
            <View style={[styles.ringDot, { backgroundColor: ring.color }]} />
            <View>
              <Text style={[styles.ringLabel, { color: ring.color }]}>{ring.label}</Text>
              <Text style={styles.ringSub}>{ring.sublabel}</Text>
            </View>
          </View>
          <View style={styles.countBadge}>
            <Text style={styles.ringCount}>{row.count}</Text>
          </View>
        </View>
      )
    }

    const { item } = row
    return (
      <TouchableOpacity style={styles.rowCard} onPress={() => openItem(item)} activeOpacity={0.85}>
        <View style={styles.rowLeft}>
          <View style={[styles.catDotWrap, {
            backgroundColor: `${item.categoryColor ?? '#888'}18`,
            borderColor: `${item.categoryColor ?? '#888'}30`,
          }]}>
            <View style={[styles.catDot, { backgroundColor: item.categoryColor ?? '#888' }]} />
          </View>
        </View>

        <View style={styles.rowBody}>
          <Text style={styles.rowText} numberOfLines={2}>
            {item.is_secret
              ? (item.partnerName ? `🔒 Secret at ${item.partnerName}` : '🔒 Secret item')
              : item.body}
          </Text>
          <View style={styles.rowMeta}>
            {item.dist_label && (
              <Text style={[
                styles.distLabel,
                !item.hasExactLocation && { color: MUTED, fontWeight: '600' }
              ]}>
                {item.hasExactLocation ? item.dist_label : `~${item.dist_label}`}
              </Text>
            )}
            {item.neighborhoodName && <Text style={styles.hoodLabel}>{item.neighborhoodName}</Text>}
            <View style={styles.ptsBadge}>
              <Text style={styles.ptsText}>+{item.difficulty ?? 1} pts</Text>
            </View>
          </View>
        </View>

        <View style={styles.rowRight}>
          <Text style={styles.chevron}>›</Text>
        </View>
      </TouchableOpacity>
    )
  }

  if (locError) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
        <View style={styles.errorIconWrap}>
          <Text style={styles.errorIcon}>⌖</Text>
        </View>
        <Text style={styles.errorTitle}>Location needed</Text>
        <Text style={styles.errorSub}>{locError}</Text>
        <TouchableOpacity style={styles.settingsBtn} onPress={() => Linking.openURL('app-settings:').catch(() => {})} activeOpacity={0.88}>
          <Text style={styles.settingsBtnText}>Open Settings</Text>
        </TouchableOpacity>
      </View>
    )
  }

  if (loading && !refreshing) {
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
        data={listData}
        keyExtractor={(row, i) => row.type === 'header' ? `h-${row.ring.weight}` : String(row.item.id)}
        renderItem={renderRow}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={AMBER} />}
        ItemSeparatorComponent={({ leadingItem }) =>
          leadingItem?.type === 'item' ? <View style={styles.sep} /> : null
        }
        ListHeaderComponent={
          <>
            <View style={styles.headerCard}>
              <Text style={styles.headerTitle}>Nearby</Text>
              <Text style={styles.headerSub}>
                {location
                  ? `${filtered.length} thing${filtered.length === 1 ? '' : 's'} to do · sorted by distance`
                  : 'Things to do around you'}
              </Text>
            </View>

            <FlatList
              horizontal
              data={cats}
              keyExtractor={c => c}
              showsHorizontalScrollIndicator={false}
              style={styles.filterRow}
              contentContainerStyle={styles.filterContent}
              renderItem={({ item: cat }) => (
                <TouchableOpacity
                  style={[styles.pill, filter === cat && styles.pillOn]}
                  onPress={() => setFilter(cat)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.pillText, filter === cat && styles.pillTextOn]}>
                    {cat === 'all' ? 'All' : cat}
                  </Text>
                </TouchableOpacity>
              )}
            />

            {filtered.length === 0 && !loading && (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>Nothing nearby</Text>
                <Text style={styles.emptySub}>
                  {filter !== 'all'
                    ? `No ${filter} spots near you right now.`
                    : 'No location-specific items found near you.'}
                </Text>
              </View>
            )}
          </>
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  center:    { alignItems: 'center', justifyContent: 'center', flex: 1, padding: 32, backgroundColor: BG },

  headerCard: {
    marginHorizontal: 16, marginTop: 8, marginBottom: 8,
    backgroundColor: CARD, borderRadius: 24, padding: 18,
    borderWidth: 1.2, borderColor: BORDER,
  },
  headerTitle:    { fontSize: 28, fontWeight: '800', color: TEXT },
  headerSub:      { fontSize: 13, color: MUTED, marginTop: 4, lineHeight: 18, fontWeight: '600' },

  filterRow:     { flexGrow: 0, marginBottom: 6 },
  filterContent: { paddingHorizontal: 16, gap: 8, paddingVertical: 8 },
  pill:          { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD },
  pillOn:        { backgroundColor: AMBER, borderColor: AMBER },
  pillText:      { fontSize: 13, color: TEXT, fontWeight: '700' },
  pillTextOn:    { color: NAVY, fontWeight: '800' },

  sectionHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 18, paddingBottom: 8 },
  sectionHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ringDot:           { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  ringLabel:         { fontSize: 14, fontWeight: '800', letterSpacing: 0.2 },
  ringSub:           { fontSize: 12, color: MUTED, marginTop: 2, fontWeight: '600' },
  countBadge:        { minWidth: 28, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: SOFT_2, borderWidth: 1, borderColor: '#DED3C5', alignItems: 'center' },
  ringCount:         { fontSize: 12, color: MUTED, fontWeight: '800' },

  rowCard:    { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, paddingVertical: 14, paddingHorizontal: 14, gap: 12, backgroundColor: CARD, borderRadius: 18, borderWidth: 1, borderColor: BORDER },
  rowLeft:    { width: 28, alignItems: 'center' },
  catDotWrap: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  catDot:     { width: 8, height: 8, borderRadius: 4 },
  rowBody:    { flex: 1 },
  rowText:    { fontSize: 15, color: TEXT, lineHeight: 21, fontWeight: '700' },
  rowMeta:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' },
  distLabel:  { fontSize: 11, color: '#9A6A00', fontWeight: '800' },
  hoodLabel:  { fontSize: 11, color: MUTED, fontWeight: '600' },
  ptsBadge:   { backgroundColor: '#FFF7E8', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: '#F5C660' },
  ptsText:    { fontSize: 11, color: '#9A6A00', fontWeight: '800' },
  rowRight:   { width: 20, alignItems: 'center' },
  chevron:    { fontSize: 20, color: '#B0A69A', fontWeight: '600' },
  sep:        { height: 10 },

  errorIconWrap:   { width: 72, height: 72, borderRadius: 36, backgroundColor: SOFT_2, borderWidth: 1, borderColor: '#DED3C5', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  errorIcon:       { fontSize: 34, color: '#A79A89' },
  errorTitle:      { fontSize: 22, fontWeight: '800', color: TEXT, marginBottom: 8, textAlign: 'center' },
  errorSub:        { fontSize: 14, color: MUTED, textAlign: 'center', lineHeight: 20, marginBottom: 24, fontWeight: '600' },
  settingsBtn:     { backgroundColor: AMBER, borderRadius: 999, paddingHorizontal: 24, paddingVertical: 12 },
  settingsBtnText: { fontSize: 14, fontWeight: '800', color: NAVY },

  loadingText: { fontSize: 15, color: TEXT, fontWeight: '700', marginTop: 16 },
  loadingSub:  { fontSize: 12, color: MUTED, marginTop: 6, fontWeight: '600' },

  empty:      { alignItems: 'center', justifyContent: 'center', padding: 32, marginTop: 10 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: TEXT, marginBottom: 8, textAlign: 'center' },
  emptySub:   { fontSize: 13, color: MUTED, textAlign: 'center', lineHeight: 19, fontWeight: '600', maxWidth: 300 },
})