// Saved Items V1 (2026-09-18) — the Lists tab's pinned "Saved" destination.
// A standalone screen (not a parameterized reuse of ListScreen.jsx) because
// ListScreen.jsx's rendering is deeply coupled to list_items/list-specific
// concerns (sort_order, bonus drops, list dates/season windows, crew
// membership, invite codes — see lib/useItems.js) that don't apply here at
// all: a Saved row has no sort_order, no season window, no crew. Bending
// ListScreen to accept a Saved-backed item list would mean threading a
// second, parallel data shape through most of its branches for a feature
// that's structurally much simpler (just: fetch items for a set of ids,
// render them, tap opens ItemDetail). A dedicated screen keeps both files
// easy to reason about; the one thing intentionally reused verbatim is the
// query pattern already established by lib/useItems.js (same embedded
// select shape: categories/neighborhoods/partners) so archetype/photo
// resolution and every field ItemDetailScreen.jsx reads off `item` work
// identically here.
//
// Query: one request joining saved_items -> items (mirrors the
// list_items -> items join in lib/useItems.js), ordered by
// saved_items.created_at DESC (most recently saved first) — not a second
// query for ordering. Deleted/inactive items are filtered out using the
// exact same is_active/is_approved condition verified and applied in
// screens/DeepLinkItemResolverScreen.jsx (afc1a61).
//
// The visible list is a derived value (useMemo over fetchedRows x the
// LIVE savedItemIds Set from useSavedItems()), not a snapshot taken once
// on mount — so un-saving an item from inside this screen (or from
// Detail, navigated to from here) removes it from view immediately, and
// logging out (which clears savedItemIds synchronously — see
// lib/SavedItemsContext.js) empties this screen's list immediately too,
// with no separate stale local copy held here.

import React, { useState, useCallback, useMemo } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect } from '@react-navigation/native'
import { supabase } from '../lib/supabase'
import { useTheme } from '../lib/ThemeContext'
import { useSavedItems } from '../lib/SavedItemsContext'
import { trackEvent } from '../lib/trackEvent'
import BookmarkIcon from '../components/BookmarkIcon'

// Maps one saved_items->items join row into the same field shape
// lib/useItems.js already produces for list_items->items, so
// ItemDetailScreen.jsx (and every card/util that reads item.* fields)
// behaves identically regardless of which screen navigated to it.
function mapRow(row) {
  const it = row.items
  if (!it) return null
  return {
    id:               it.id,
    body:             it.body ?? '',
    isActive:         it.is_active ?? false,
    isApproved:       it.is_approved ?? false,
    checkinType:      it.checkin_type ?? 'tap',
    checkin_type:     it.checkin_type ?? 'tap',
    isUniversal:      it.is_universal ?? true,
    ring_weight:      it.ring_weight ?? 0,
    difficulty:       it.difficulty ?? 1,
    photoRequired:    it.photo_required ?? false,
    isSecret:         it.is_secret ?? false,
    is_secret:        it.is_secret ?? false,
    secretRevealText: it.secret_reveal_text ?? null,
    mapsLat:          it.maps_lat ?? null,
    mapsLng:          it.maps_lng ?? null,
    maps_lat:         it.maps_lat ?? null,
    maps_lng:         it.maps_lng ?? null,
    geoRadiusM:       it.geo_radius_m ?? null,
    categoryName:     it.categories?.name ?? 'Misc',
    categoryColor:    it.categories?.color_hex ?? '#888780',
    neighborhoodName: it.neighborhoods?.name ?? null,
    metroId:          it.neighborhoods?.metro_id ?? null,
    website_url:      it.website_url ?? null,
    maps_query:       it.maps_query ?? null,
    partner_id:       it.partner_id ?? null,
    partnerName:      it.partners?.business_name ?? null,
    has_alcohol:      it.has_alcohol ?? false,
    allowsPersonalNote:  it.allows_personal_note ?? false,
    personalPromptLabel: it.personal_prompt_label ?? null,
    personalPlaceLabel:  it.personal_place_label ?? null,
    savedAt: row.created_at,
  }
}

export default function SavedItemsScreen({ navigation }) {
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const { BG, CARD, TEXT, MUTED, BORDER, SOFT, AMBER } = colors
  const styles = useMemo(() => createStyles({ BG, CARD, TEXT, MUTED, BORDER, SOFT, AMBER }), [BG, CARD, TEXT, MUTED, BORDER, SOFT, AMBER])

  const { savedItemIds, isSaved, toggleSaved, loading: savedLoading } = useSavedItems()
  const [fetchedRows, setFetchedRows] = useState([]) // ordered by created_at DESC, active/approved only
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setFetchedRows([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('saved_items')
        .select(`
          created_at,
          items (
            id, body, is_active, is_approved, checkin_type, is_universal, ring_weight,
            difficulty, photo_required, is_secret, secret_reveal_text,
            maps_lat, maps_lng, geo_radius_m,
            website_url, maps_query, partner_id, has_alcohol,
            allows_personal_note, personal_prompt_label, personal_place_label,
            categories ( name, color_hex ),
            neighborhoods!items_neighborhood_id_fkey ( id, name, metro_id ),
            partners!items_partner_id_fkey ( business_name )
          )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (error) throw error

      // Same active/approved condition verified and applied in
      // screens/DeepLinkItemResolverScreen.jsx (afc1a61) — RLS can also
      // return `items: null` for an item the user can't read at all
      // (e.g. hard-deleted, or inactive and never checked off), same
      // pattern lib/useItems.js already handles.
      const mapped = (data ?? [])
        .map(mapRow)
        .filter((it) => it && it.isActive && it.isApproved)

      setFetchedRows(mapped)
    } catch (e) {
      console.warn('SavedItemsScreen load error:', e?.message ?? e)
      setFetchedRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(useCallback(() => { load() }, [load]))

  useFocusEffect(useCallback(() => {
    trackEvent('saved_collection_view')
  }, []))

  // Derived, not a snapshot: re-filters the fetched (ordered) rows against
  // the LIVE savedItemIds Set on every render, so un-saving anywhere
  // (this screen, Detail, Home) removes the item from view immediately,
  // and a logout (which clears savedItemIds synchronously) empties this
  // list immediately too.
  const visibleItems = useMemo(
    () => fetchedRows.filter((it) => savedItemIds.has(it.id)),
    [fetchedRows, savedItemIds]
  )

  function openItem(item) {
    navigation.navigate('ItemDetail', { item })
  }

  if (loading && savedLoading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={AMBER} />
      </View>
    )
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 20, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.screenTitle}>Saved</Text>

      {visibleItems.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>Nothing saved yet</Text>
          <Text style={styles.emptyBody}>Bookmark something that looks good and it'll be waiting here.</Text>
        </View>
      ) : (
        visibleItems.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={styles.row}
            onPress={() => openItem(item)}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.rowBody} numberOfLines={2}>{item.body}</Text>
              {item.neighborhoodName ? (
                <Text style={styles.rowMeta}>{item.neighborhoodName}</Text>
              ) : null}
            </View>
            <TouchableOpacity
              style={styles.bookmarkBtn}
              onPress={() => toggleSaved(item.id, navigation)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityState={{ selected: isSaved(item.id) }}
              accessibilityLabel={isSaved(item.id) ? `Remove ${item.body} from Saved` : `Save ${item.body}`}
            >
              <BookmarkIcon filled={isSaved(item.id)} color={AMBER} size={18} />
            </TouchableOpacity>
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  )
}

function createStyles({ BG, CARD, TEXT, MUTED, BORDER, SOFT, AMBER }) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: BG },
    center: { alignItems: 'center', justifyContent: 'center' },
    screenTitle: { fontSize: 22, fontWeight: '800', color: TEXT, marginBottom: 16 },
    row: {
      backgroundColor: CARD,
      borderRadius: 18,
      padding: 16,
      marginBottom: 10,
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: BORDER,
      gap: 12,
    },
    rowBody: { fontSize: 15, color: TEXT, fontWeight: '700' },
    rowMeta: { fontSize: 12, color: MUTED, marginTop: 4, fontWeight: '600' },
    bookmarkBtn: { padding: 4 },
    emptyWrap: { alignItems: 'center', paddingTop: 40, paddingHorizontal: 24 },
    emptyTitle: { fontSize: 17, fontWeight: '800', color: TEXT, marginBottom: 8, textAlign: 'center' },
    emptyBody: { fontSize: 14, color: MUTED, textAlign: 'center', lineHeight: 20 },
  })
}
