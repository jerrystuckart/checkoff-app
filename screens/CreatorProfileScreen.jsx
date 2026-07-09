import React, { useState, useEffect, useMemo } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, Image,
  StyleSheet, ActivityIndicator, StatusBar, Linking,
  Modal, TextInput, FlatList,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase } from '../lib/supabase'
import { useTheme } from '../lib/ThemeContext'

const AMBER = '#F5A623'
const NAVY  = '#0F0F1E'
const GREEN = '#1D9E75'

export default function CreatorProfileScreen({ route, navigation }) {
  const { handle } = route.params ?? {}
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const { BG, CARD, TEXT, MUTED, BORDER, SOFT } = colors
  const styles = useMemo(() => createStyles({ BG, CARD, TEXT, MUTED, BORDER, SOFT }), [BG, CARD, TEXT, MUTED, BORDER, SOFT])

  const [loading, setLoading]   = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [creator, setCreator]   = useState(null)
  const [isOwner, setIsOwner]   = useState(false)
  const [userId, setUserId]     = useState(null)
  // Per-list state — keyed by list.id
  const [creatorLists, setCreatorLists]   = useState([]) // [{ id, title, goes_public_at, metro_id, items }]
  const [followStateMap, setFollowStateMap] = useState({}) // { [listId]: { isFollowing, loading, success } }
  const [checkedIdsMap, setCheckedIdsMap]   = useState({}) // { [listId]: Set<listItemId> }
  const [expandedListIds, setExpandedListIds] = useState(new Set()) // which lists show their items

  function toggleListExpanded(listId) {
    setExpandedListIds(prev => {
      const next = new Set(prev)
      if (next.has(listId)) next.delete(listId)
      else next.add(listId)
      return next
    })
  }

  // Owner add-items modal state
  const [addItemsListId, setAddItemsListId] = useState(null) // which list is open
  const [itemSearch, setItemSearch]         = useState('')
  const [searchResults, setSearchResults]   = useState([])
  const [searchLoading, setSearchLoading]   = useState(false)
  const [addingItemId, setAddingItemId]     = useState(null)

  useEffect(() => {
    if (!handle) { setNotFound(true); setLoading(false); return }
    load()
  }, [handle])

  async function load() {
    setLoading(true)
    try {
      // 1. Fetch creator by handle — no is_active filter so owners can see their
      //    own profile before activation. Active check enforced below for non-owners.
      const { data: creatorRow, error: creatorErr } = await supabase
        .from('creators')
        .select('id, user_id, handle, display_name, bio, avatar_url, social_url, is_active')
        .eq('handle', handle.toLowerCase())
        .maybeSingle()

      if (creatorErr) throw creatorErr
      if (!creatorRow) { setNotFound(true); setLoading(false); return }

      // 2. Check ownership before deciding whether to show an inactive profile
      const { data: { user } } = await supabase.auth.getUser()
      const viewerIsOwner = !!(user && user.id === creatorRow.user_id)

      // Non-owners cannot see inactive profiles
      if (!creatorRow.is_active && !viewerIsOwner) { setNotFound(true); setLoading(false); return }

      setCreator(creatorRow)
      setIsOwner(viewerIsOwner)
      if (user) setUserId(user.id)

      // 3. Fetch all creator lists.
      //    Owners see private lists (no goes_public_at filter).
      //    Everyone else only sees published lists.
      let listsQuery = supabase
        .from('lists')
        .select('id, title, goes_public_at, metro_id')
        .eq('checkoff_creator_id', creatorRow.id)
        .eq('is_creator_list', true)
        .order('goes_public_at', { ascending: true, nullsFirst: true })

      if (!viewerIsOwner) {
        listsQuery = listsQuery.not('goes_public_at', 'is', null)
      }

      const { data: listsData, error: listsErr } = await listsQuery
      if (listsErr) throw listsErr
      const lists = listsData ?? []

      // 4. Fetch items for all lists in parallel.
      const itemResults = await Promise.all(
        lists.map(l =>
          supabase
            .from('list_items')
            .select('id, sort_order, is_partner_item, items(id, body, difficulty, neighborhoods!items_neighborhood_id_fkey(name))')
            .eq('list_id', l.id)
            .order('sort_order')
        )
      )

      setCreatorLists(lists.map((l, i) => {
        const raw = itemResults[i].data ?? []
        const sorted = [...raw].sort((a, b) => {
          if (a.is_partner_item && !b.is_partner_item) return -1
          if (!a.is_partner_item && b.is_partner_item) return 1
          return (a.sort_order ?? 0) - (b.sort_order ?? 0)
        })
        return { ...l, items: sorted }
      }))

      // Default: with a single list, expand it — no other lists to bury.
      // With multiple lists, start all collapsed so every list's header is
      // visible without scrolling past a 50-item list above it.
      setExpandedListIds(new Set(lists.length === 1 ? [lists[0].id] : []))

      // 5. Check follow status for all lists in one query (non-owners only).
      if (user && !viewerIsOwner && lists.length > 0) {
        const { data: memberships } = await supabase
          .from('list_members')
          .select('list_id')
          .eq('user_id', user.id)
          .in('list_id', lists.map(l => l.id))
        const followingSet = new Set((memberships ?? []).map(m => m.list_id))
        const fMap = {}
        lists.forEach(l => {
          fMap[l.id] = { isFollowing: followingSet.has(l.id), loading: false, success: false }
        })
        setFollowStateMap(fMap)
      }

      // 6. Load checked IDs for all lists in one query.
      if (user && lists.length > 0) {
        const allItemIds = itemResults.flatMap(r => (r.data ?? []).map(li => li.id))
        if (allItemIds.length > 0) {
          const { data: checkins } = await supabase
            .from('check_ins')
            .select('list_item_id')
            .eq('user_id', user.id)
            .in('list_item_id', allItemIds)
          const checkedSet = new Set((checkins ?? []).map(c => c.list_item_id))
          const cMap = {}
          itemResults.forEach((r, i) => {
            const lid = lists[i].id
            cMap[lid] = new Set((r.data ?? []).filter(li => checkedSet.has(li.id)).map(li => li.id))
          })
          setCheckedIdsMap(cMap)
        }
      }
    } catch (e) {
      console.error('CreatorProfileScreen load error:', e?.message ?? e)
    } finally {
      setLoading(false)
    }
  }

  async function handleFollow(listId) {
    const { data: { user: currentUser } } = await supabase.auth.getUser()
    if (!currentUser) { navigation.navigate('SignIn'); return }
    const fs = followStateMap[listId] ?? {}
    if (fs.isFollowing || fs.loading) return
    setFollowStateMap(prev => ({ ...prev, [listId]: { isFollowing: false, loading: true, success: false } }))
    const { error } = await supabase
      .from('list_members')
      .insert({ list_id: listId, user_id: currentUser.id, invite_source: 'creator_profile' })
    if (!error) {
      setFollowStateMap(prev => ({ ...prev, [listId]: { isFollowing: true, loading: false, success: true } }))
      setTimeout(() => {
        setFollowStateMap(prev => ({ ...prev, [listId]: { isFollowing: true, loading: false, success: false } }))
      }, 2000)
    } else {
      setFollowStateMap(prev => ({ ...prev, [listId]: { isFollowing: false, loading: false, success: false } }))
    }
  }

  // Search items when owner has modal open and types ≥2 chars
  useEffect(() => {
    if (!addItemsListId || itemSearch.length < 2) { setSearchResults([]); return }
    const activeList = creatorLists.find(l => l.id === addItemsListId)
    const metroId    = activeList?.metro_id ?? null
    let cancelled    = false
    setSearchLoading(true)
    ;(async () => {
      let q = supabase
        .from('items')
        .select('id, body, difficulty, neighborhoods!items_neighborhood_id_fkey(name)')
        .eq('is_active', true)
        .eq('is_approved', true)
        .ilike('body', `%${itemSearch}%`)
        .limit(40)
      if (metroId) {
        // Filter to items whose neighborhood belongs to this metro
        q = q.eq('neighborhoods.metro_id', metroId)
      }
      const { data } = await q
      if (!cancelled) {
        setSearchResults(data ?? [])
        setSearchLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [itemSearch, addItemsListId])

  async function handleAddItem(item) {
    if (addingItemId) return
    const activeList = creatorLists.find(l => l.id === addItemsListId)
    if (!activeList) return
    // Already in list?
    if (activeList.items.some(li => li.items?.id === item.id)) return
    setAddingItemId(item.id)
    // Get current max sort_order
    const { data: maxRow } = await supabase
      .from('list_items')
      .select('sort_order')
      .eq('list_id', addItemsListId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()
    const nextOrder = (maxRow?.sort_order ?? 0) + 1
    const { data: newRow, error } = await supabase
      .from('list_items')
      .insert({ list_id: addItemsListId, item_id: item.id, sort_order: nextOrder })
      .select('id, sort_order, items(id, body, difficulty, neighborhoods!items_neighborhood_id_fkey(name))')
      .single()
    if (!error && newRow) {
      setCreatorLists(prev => prev.map(l =>
        l.id === addItemsListId ? { ...l, items: [...l.items, newRow] } : l
      ))
    }
    setAddingItemId(null)
  }

  function closeAddItemsModal() {
    setAddItemsListId(null)
    setItemSearch('')
    setSearchResults([])
  }

  if (loading) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <StatusBar barStyle="light-content" />
        <ActivityIndicator size="small" color={AMBER} />
      </View>
    )
  }

  if (notFound) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <StatusBar barStyle="light-content" />
        <Text style={styles.notFoundEmoji}>🔍</Text>
        <Text style={styles.notFoundTitle}>Creator not found</Text>
        <Text style={styles.notFoundSub}>@{handle} doesn't exist or is no longer active.</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnText}>Go back</Text>
        </TouchableOpacity>
      </View>
    )
  }

  const avatarUri = creator.avatar_url ?? null
  const initials  = (creator.display_name ?? creator.handle ?? '?')
    .split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }]}
      showsVerticalScrollIndicator={false}
    >
      <StatusBar barStyle="light-content" />

      {/* Avatar */}
      <View style={styles.avatarWrap}>
        {avatarUri ? (
          <Image source={{ uri: avatarUri }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarInitials}>{initials}</Text>
          </View>
        )}
      </View>

      {/* Name + handle */}
      <Text style={styles.displayName}>{creator.display_name ?? creator.handle}</Text>
      <Text style={styles.handle}>@{creator.handle}</Text>

      {/* Bio */}
      {creator.bio ? <Text style={styles.bio}>{creator.bio}</Text> : null}

      {/* Lists — one section per list */}
      {creatorLists.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyEmoji}>🔒</Text>
          <Text style={styles.emptyTitle}>List coming soon</Text>
          <Text style={styles.emptySub}>
            {creator.display_name ?? creator.handle} is building their list. Check back soon.
          </Text>
        </View>
      ) : (
        creatorLists.map((list, idx) => {
          const isPrivate  = list.goes_public_at == null
          const fs         = followStateMap[list.id] ?? { isFollowing: false, loading: false, success: false }
          const checkedIds = checkedIdsMap[list.id] ?? new Set()
          return (
            <View key={list.id} style={[styles.listSection, idx > 0 && { marginTop: 28 }]}>

              {isOwner && isPrivate ? (
                <View style={styles.privateBanner}>
                  <Text style={styles.privateBannerText}>
                    Your list is private — it goes live when your first partner activates.
                  </Text>
                </View>
              ) : null}

              <TouchableOpacity
                style={styles.listHeaderRow}
                onPress={() => toggleListExpanded(list.id)}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.listTitle}>{list.title}</Text>
                  <Text style={styles.listItemCount}>{list.items.length} {list.items.length === 1 ? 'place' : 'places'}</Text>
                </View>
                <Text style={styles.listChevron}>{expandedListIds.has(list.id) ? '▾' : '▸'}</Text>
              </TouchableOpacity>

              {isOwner ? (
                <TouchableOpacity
                  style={styles.addItemsBtn}
                  onPress={() => { setAddItemsListId(list.id); setItemSearch(''); setSearchResults([]) }}
                  activeOpacity={0.75}
                >
                  <Text style={styles.addItemsBtnText}>+ Add Items</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[
                    styles.followBtn,
                    fs.isFollowing && styles.followBtnFollowing,
                    fs.success && styles.followBtnSuccess,
                  ]}
                  onPress={() => handleFollow(list.id)}
                  activeOpacity={fs.isFollowing ? 1 : 0.75}
                >
                  <Text style={[styles.followBtnText, fs.isFollowing && styles.followBtnTextFollowing]}>
                    {fs.success
                      ? 'Added to your lists!'
                      : fs.isFollowing
                        ? 'Following ✓'
                        : fs.loading
                          ? 'Adding…'
                          : !userId
                            ? 'Sign in to follow this list'
                            : 'Follow This List'}
                  </Text>
                </TouchableOpacity>
              )}

              {expandedListIds.has(list.id) && list.items.map(li => {
                const item      = li.items
                const checked   = checkedIds.has(li.id)
                const isPartner = !!li.is_partner_item
                if (!item) return null
                return (
                  <TouchableOpacity
                    key={li.id}
                    style={[styles.itemCard, checked && styles.itemCardChecked, isPartner && styles.itemCardPartner]}
                    activeOpacity={0.75}
                    onPress={() => navigation.navigate('ItemDetail', {
                      item: {
                        listItemId:       li.id,
                        id:               item.id,
                        body:             item.body,
                        difficulty:       item.difficulty,
                        neighborhoodName: item.neighborhoods?.name ?? null,
                        checked,
                      },
                      listId: list.id,
                      listTitle: list.title,
                    })}
                  >
                    {isPartner && <View style={styles.itemPartnerBorder} />}
                    <View style={styles.itemContent}>
                      <View style={styles.itemTopRow}>
                        <Text style={[styles.itemName, checked && styles.itemNameChecked]} numberOfLines={1}>
                          {item.body}
                        </Text>
                        {isPartner ? (
                          <View style={styles.partnerChip}>
                            <Text style={styles.partnerChipText}>★ Partner</Text>
                          </View>
                        ) : checked ? (
                          <Text style={styles.checkMark}>✓</Text>
                        ) : null}
                      </View>
                      {item.neighborhoods?.name ? (
                        <Text style={styles.itemNeighborhood}>{item.neighborhoods.name}</Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                )
              })}
            </View>
          )
        })
      )}

      {creator.social_url ? (
        <TouchableOpacity
          style={styles.followLink}
          onPress={() => Linking.openURL(creator.social_url)}
          activeOpacity={0.7}
        >
          <Text style={styles.followLinkText}>Follow @{creator.handle} →</Text>
        </TouchableOpacity>
      ) : null}

      {/* Owner — Add Items modal */}
      <Modal
        visible={!!addItemsListId}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeAddItemsModal}
      >
        <View style={[styles.addItemsModal, { paddingTop: insets.top + 16 }]}>

          {/* Header */}
          <View style={styles.addItemsHeader}>
            <TouchableOpacity onPress={closeAddItemsModal}>
              <Text style={styles.addItemsCancel}>Done</Text>
            </TouchableOpacity>
            <Text style={styles.addItemsTitle}>Add Items</Text>
            <View style={{ width: 44 }} />
          </View>

          {/* Search input */}
          <View style={styles.addItemsSearchWrap}>
            <TextInput
              style={styles.addItemsSearch}
              placeholder="Search items…"
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={itemSearch}
              onChangeText={setItemSearch}
              autoFocus
              returnKeyType="search"
            />
          </View>

          {/* Results */}
          {itemSearch.length < 2 ? (
            <View style={styles.addItemsHint}>
              <Text style={styles.addItemsHintText}>Type at least 2 characters to search</Text>
            </View>
          ) : searchLoading ? (
            <View style={styles.addItemsHint}>
              <ActivityIndicator size="small" color={AMBER} />
            </View>
          ) : (
            <FlatList
              data={searchResults}
              keyExtractor={i => i.id}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <View style={styles.addItemsHint}>
                  <Text style={styles.addItemsHintText}>No items match</Text>
                </View>
              }
              renderItem={({ item }) => {
                const activeList  = creatorLists.find(l => l.id === addItemsListId)
                const alreadyAdded = activeList?.items.some(li => li.items?.id === item.id) ?? false
                const isAdding    = addingItemId === item.id
                return (
                  <TouchableOpacity
                    style={[styles.addItemsRow, alreadyAdded && styles.addItemsRowAdded]}
                    onPress={() => !alreadyAdded && handleAddItem(item)}
                    activeOpacity={alreadyAdded ? 1 : 0.75}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.addItemsBody} numberOfLines={2}>{item.body}</Text>
                      {item.neighborhoods?.name ? (
                        <Text style={styles.addItemsNeighborhood}>{item.neighborhoods.name}</Text>
                      ) : null}
                    </View>
                    <View style={styles.addItemsRight}>
                      {item.difficulty ? (
                        <Text style={styles.addItemsDifficulty}>{item.difficulty} pts</Text>
                      ) : null}
                      {isAdding ? (
                        <ActivityIndicator size="small" color={AMBER} style={{ marginLeft: 8 }} />
                      ) : alreadyAdded ? (
                        <Text style={styles.addItemsCheck}>✓ Added</Text>
                      ) : (
                        <View style={styles.addItemsAddBtn}>
                          <Text style={styles.addItemsAddBtnText}>Add</Text>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                )
              }}
            />
          )}
        </View>
      </Modal>

    </ScrollView>
  )
}

function createStyles({ BG, CARD, TEXT, MUTED, BORDER, SOFT }) {
  return StyleSheet.create({
    scroll: { flex: 1, backgroundColor: BG },
    container: { paddingHorizontal: 20, alignItems: 'center' },
    center: { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', gap: 8 },

    // Avatar
    avatarWrap:      { marginBottom: 14 },
    avatar:          { width: 88, height: 88, borderRadius: 44, borderWidth: 2.5, borderColor: AMBER },
    avatarFallback:  { width: 88, height: 88, borderRadius: 44, backgroundColor: CARD, alignItems: 'center', justifyContent: 'center', borderWidth: 2.5, borderColor: AMBER },
    avatarInitials:  { fontSize: 28, fontWeight: '800', color: AMBER },

    // Header text
    displayName: { fontSize: 22, fontWeight: '800', color: TEXT, marginBottom: 2, textAlign: 'center' },
    handle:      { fontSize: 14, fontWeight: '600', color: MUTED, marginBottom: 12, textAlign: 'center' },
    bio:         { fontSize: 14, color: MUTED, textAlign: 'center', lineHeight: 20, marginBottom: 24, maxWidth: 320 },

    // List section
    listSection: { width: '100%', marginTop: 8 },
    listHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    listChevron:   { fontSize: 16, color: MUTED, fontWeight: '700', marginLeft: 8 },
    listTitle:     { fontSize: 17, fontWeight: '800', color: TEXT, marginBottom: 4 },
    listItemCount: { fontSize: 13, color: MUTED, marginBottom: 12 },

    // Item cards
    itemCard: {
      flexDirection: 'row',
      backgroundColor: CARD,
      borderRadius: 14,
      marginBottom: 10,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: BORDER,
    },
    itemCardChecked:  { borderColor: GREEN, opacity: 0.85 },
    itemCardPartner:  { borderColor: AMBER },
    itemPartnerBorder: { width: 3, backgroundColor: AMBER },
    partnerChip: {
      backgroundColor: AMBER,
      borderRadius: 4,
      paddingVertical: 2,
      paddingHorizontal: 4,
    },
    partnerChipText: { fontSize: 10, fontWeight: '700', color: NAVY },
    itemContent:      { flex: 1, padding: 12, justifyContent: 'center' },
    itemTopRow:       { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
    itemName:         { flex: 1, fontSize: 15, fontWeight: '700', color: TEXT },
    itemNameChecked:  { color: GREEN },
    checkMark:        { fontSize: 14, color: GREEN, fontWeight: '700' },
    itemNeighborhood: { fontSize: 11, color: MUTED, marginBottom: 3 },
    itemDesc:         { fontSize: 12, color: MUTED, lineHeight: 16 },

    // Follow This List button
    followBtn: {
      width: '100%',
      backgroundColor: AMBER,
      borderRadius: 14,
      paddingVertical: 15,
      alignItems: 'center',
      marginBottom: 24,
    },
    followBtnFollowing: {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: BORDER,
    },
    followBtnSuccess: {
      backgroundColor: GREEN,
    },
    followBtnText: {
      fontSize: 15,
      fontWeight: '800',
      color: NAVY,
    },
    followBtnTextFollowing: {
      color: MUTED,
    },

    // Social follow link
    followLink:     { marginTop: 24, alignSelf: 'center' },
    followLinkText: { fontSize: 13, color: AMBER, fontWeight: '600' },

    // Private preview banner (owner-only)
    privateBanner: {
      backgroundColor: 'rgba(245,166,35,0.1)',
      borderWidth: 1,
      borderColor: 'rgba(245,166,35,0.3)',
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 14,
      marginBottom: 14,
      width: '100%',
    },
    privateBannerText: { fontSize: 13, color: AMBER, lineHeight: 18, fontWeight: '600' },

    // Empty / not-found
    emptyCard:      { backgroundColor: CARD, borderRadius: 16, padding: 28, alignItems: 'center', width: '100%', borderWidth: 1, borderColor: BORDER },
    emptyEmoji:     { fontSize: 32, marginBottom: 10 },
    emptyTitle:     { fontSize: 16, fontWeight: '700', color: TEXT, marginBottom: 6 },
    emptySub:       { fontSize: 13, color: MUTED, textAlign: 'center', lineHeight: 18 },

    notFoundEmoji: { fontSize: 40, marginBottom: 12 },
    notFoundTitle: { fontSize: 18, fontWeight: '800', color: TEXT, marginBottom: 6 },
    notFoundSub:   { fontSize: 14, color: MUTED, textAlign: 'center', marginBottom: 24, paddingHorizontal: 32 },
    backBtn:       { paddingVertical: 12, paddingHorizontal: 28, backgroundColor: CARD, borderRadius: 12, borderWidth: 1, borderColor: BORDER },
    backBtnText:   { fontSize: 14, fontWeight: '700', color: TEXT },

    // Owner Add Items button
    addItemsBtn: {
      borderWidth: 1,
      borderColor: AMBER,
      borderRadius: 12,
      paddingVertical: 10,
      paddingHorizontal: 20,
      alignSelf: 'flex-start',
      marginBottom: 16,
    },
    addItemsBtnText: { fontSize: 14, fontWeight: '700', color: AMBER },

    // Add Items modal
    addItemsModal:       { flex: 1, backgroundColor: NAVY },
    addItemsHeader:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 12 },
    addItemsTitle:       { fontSize: 16, fontWeight: '800', color: TEXT },
    addItemsCancel:      { fontSize: 15, color: AMBER, fontWeight: '600', width: 44 },
    addItemsSearchWrap:  { paddingHorizontal: 16, paddingVertical: 10 },
    addItemsSearch: {
      backgroundColor: CARD,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 14,
      fontSize: 15,
      color: TEXT,
      borderWidth: 1,
      borderColor: BORDER,
    },
    addItemsHint:        { alignItems: 'center', paddingTop: 40 },
    addItemsHintText:    { fontSize: 14, color: MUTED },
    addItemsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: BORDER,
    },
    addItemsRowAdded:    { opacity: 0.5 },
    addItemsBody:        { fontSize: 14, fontWeight: '600', color: TEXT, marginBottom: 2 },
    addItemsNeighborhood: { fontSize: 12, color: MUTED },
    addItemsRight:       { flexDirection: 'row', alignItems: 'center', marginLeft: 12 },
    addItemsDifficulty:  { fontSize: 11, color: MUTED },
    addItemsCheck:       { fontSize: 16, color: GREEN, marginLeft: 8, fontWeight: '700' },
    addItemsAddBtn: {
      borderWidth: 1,
      borderColor: AMBER,
      borderRadius: 8,
      paddingVertical: 7,
      paddingHorizontal: 14,
      marginLeft: 8,
    },
    addItemsAddBtnText: { fontSize: 13, fontWeight: '700', color: AMBER },
  })
}
