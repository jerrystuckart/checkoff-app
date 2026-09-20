// Lists Landing Redesign (2026-09-19) — the Lists tab's personal collection
// hub, restyled to match the visual/product language shipped by the Home,
// Nearby, and Item Detail redesigns (midnight navy dark mode / warm cream
// type / amber accents / raised CARD_ELEVATED surfaces / restrained glow),
// while preserving every real behavior the pre-redesign screen had:
// fetching (list_members -> lists, official vs. personal split, crew
// membership/handles), create-list navigation, delete/leave with their
// existing confirmations, and the Saved Items V1 virtual destination.
//
// What changed vs. the pre-redesign screen:
//   - A single virtualized FlatList (via lib/listsSections.js's
//     buildListsRows) replaces the plain ScrollView — no behavior change,
//     just proper virtualization for a screen that can grow with many
//     lists.
//   - Presentation is now owned by components/lists/* (ListsHeader,
//     SavedCollectionCard, ListCollectionCard) instead of inline markup —
//     this screen owns data/handlers only, matching this app's established
//     hook/screen-owns-policy, component-owns-presentation split.
//   - list.hero_image_url is now selected (zero extra query — same
//     list_members->lists embedded select) so a list WITH a real cover
//     image (the same column ListScreen.jsx's own header already reads)
//     shows it; one without falls back to a code-native accent panel.
//   - A real "More options" button per personal-list card gives the
//     existing delete/leave actions a discoverable, accessible entry point
//     alongside the pre-existing onLongPress (kept, unchanged) — same
//     handlers, same Alert-based confirmations, nothing new is destructive.
//   - Section label is "Your Lists" (not "In Progress") — this screen has
//     no genuine per-list completion-progress data (that lives in
//     ListScreen.jsx, keyed off check_ins + each list's own season window,
//     and isn't safely reproducible here without a second, list-detail-
//     duplicating query); labeling it "in progress" would fabricate a
//     meaning the data doesn't support, so this redesign deliberately
//     doesn't add a progress query or that label.
//
// Signed-out state: the ListsTab is entirely hidden from the bottom tab
// bar when signed out (App.jsx's `tabBarButton: isSignedIn ? undefined :
// () => null`), so this screen's own !userId branch below is structurally
// unreachable via normal navigation. It's kept (functionally as-is, just
// restyled) rather than removed, in case some future entry point reaches
// this screen directly while signed out — but no new elaborate signed-out
// UI was built for what is, today, dead-in-practice code per the task's
// own instruction.

import React, { useState, useCallback, useMemo } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect } from '@react-navigation/native'
import { supabase } from '../lib/supabase'
import { useTheme } from '../lib/ThemeContext'
import { useSavedItems } from '../lib/SavedItemsContext'
import { trackEvent } from '../lib/trackEvent'
import { buildListsRows } from '../lib/listsSections'
import ListsHeader from '../components/lists/ListsHeader'
import SavedCollectionCard from '../components/lists/SavedCollectionCard'
import ListCollectionCard from '../components/lists/ListCollectionCard'

function calDaysLeft(endsAt) {
  if (!endsAt) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const end   = new Date(`${endsAt}T00:00:00`); end.setHours(0, 0, 0, 0)
  return Math.round((end - today) / (1000 * 60 * 60 * 24))
}

function timeLeft(endsAt) {
  if (!endsAt) return null
  const days = calDaysLeft(endsAt)
  if (days < 0) return null
  if (days === 0) return 'Ends today'
  if (days === 1) return '1 day left'
  return `${days} days left`
}

function isEnded(endsAt) {
  if (!endsAt) return false
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const end   = new Date(`${endsAt}T00:00:00`); end.setHours(0, 0, 0, 0)
  return end < today
}

function isUrgent(endsAt, withinDays = 7) {
  if (!endsAt) return false
  const days = calDaysLeft(endsAt)
  return days !== null && days >= 0 && days <= withinDays
}

export default function ListsScreen({ navigation }) {
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const { AMBER } = colors
  const styles = useMemo(() => createStyles({ colors }), [colors])

  const [userId, setUserId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [personalLists, setPersonalLists] = useState([])
  // Saved Items V1 (2026-09-18) — the pinned "Saved" destination reads its
  // count straight off the already-loaded savedItemIds Set (zero extra
  // query). See screens/SavedItemsScreen.jsx / lib/SavedItemsContext.js.
  const { savedItemIds } = useSavedItems()
  const [memberMap, setMemberMap] = useState({})
  const [joinedOfficial, setJoinedOfficial] = useState([])
  const [loadError, setLoadError] = useState(false)

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setUserId(null)
      setPersonalLists([])
      setJoinedOfficial([])
      setLoading(false)
      return
    }
    setUserId(user.id)
    setLoadError(false)

    try {
      const { data: memberLists, error: memberErr } = await supabase
        .from('list_members')
        .select('lists(id, title, starts_at, ends_at, is_public, is_official, creator_id, cover_emoji, checkoff_creator_id, is_featured_eligible, hero_image_url)')
        .eq('user_id', user.id)

      if (memberErr) throw memberErr

      const all = (memberLists ?? []).map(m => m.lists).filter(Boolean)
      const personal = all.filter(l => !l.is_official && !isEnded(l.ends_at))
      const official = all.filter(l => l.is_official && !isEnded(l.ends_at))
      setJoinedOfficial(official)

      if (personal.length === 0) {
        setPersonalLists([])
        setMemberMap({})
        setLoading(false)
        return
      }

      const creatorIds = [...new Set(personal.map(l => l.checkoff_creator_id).filter(Boolean))]
      const creatorHandleMap = {}
      if (creatorIds.length > 0) {
        const { data: creatorRows } = await supabase
          .from('creators')
          .select('id, handle')
          .in('id', creatorIds)
        ;(creatorRows ?? []).forEach(c => { creatorHandleMap[c.id] = c.handle })
      }

      const { data: memberships } = await supabase
        .from('list_members')
        .select('list_id, user_id, users(id, display_name)')
        .in('list_id', personal.map(l => l.id))
        .neq('user_id', user.id)

      const mMap = {}
      const memberCountMap = {}
      ;(memberships ?? []).forEach(m => {
        memberCountMap[m.list_id] = (memberCountMap[m.list_id] ?? 0) + 1
        if (!mMap[m.list_id]) mMap[m.list_id] = []
        if (mMap[m.list_id].length < 4) {
          mMap[m.list_id].push({
            id:      m.user_id,
            initial: (m.users?.display_name ?? '?')[0].toUpperCase(),
          })
        }
      })
      setMemberMap(mMap)
      setPersonalLists(personal.map(l => ({
        ...l,
        memberCount:   (memberCountMap[l.id] ?? 0) + 1,
        creatorHandle: creatorHandleMap[l.checkoff_creator_id] ?? null,
      })))
    } catch (e) {
      console.error('ListsScreen load error:', e?.message ?? e)
      setLoadError(true)
      setPersonalLists([])
      setJoinedOfficial([])
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(useCallback(() => { load() }, [load]))

  useFocusEffect(useCallback(() => {
    trackEvent('lists_tab_view')
  }, []))

  async function deleteList(list) {
    const { count } = await supabase
      .from('list_members')
      .select('*', { count: 'exact', head: true })
      .eq('list_id', list.id)

    const memberCount = count ?? 1
    const message = memberCount > 1
      ? `Delete this list? This will remove it for all ${memberCount} members and cannot be undone.`
      : 'Delete this list? This cannot be undone.'

    Alert.alert('Delete list?', message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase
            .from('lists')
            .delete()
            .eq('id', list.id)
            .eq('creator_id', userId)

          if (error) {
            if (error.code === '23503' && error.message?.includes('destination_lists_list_id_fkey')) {
              const { data: destList } = await supabase
                .from('destination_lists')
                .select('destinations ( name )')
                .eq('list_id', list.id)
                .maybeSingle()
              Alert.alert(
                'Could not delete',
                `This list can't be deleted because it's linked to a destination banner (${destList?.destinations?.name ?? 'a destination'}). Remove or reassign the destination link first, then try again.`
              )
            } else {
              Alert.alert('Could not delete', error.message)
            }
          } else {
            setPersonalLists(prev => prev.filter(l => l.id !== list.id))
          }
        },
      },
    ])
  }

  async function leaveList(list) {
    if (!userId) return
    Alert.alert('Leave list?', 'You can rejoin using the original invite link.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase
            .from('list_members')
            .delete()
            .eq('list_id', list.id)
            .eq('user_id', userId)

          if (error) {
            Alert.alert('Could not leave', error.message)
          } else {
            setPersonalLists(prev => prev.filter(l => l.id !== list.id))
          }
        },
      },
    ])
  }

  function handleListAction(list) {
    if (list.creator_id === userId) {
      deleteList(list)
    } else {
      leaveList(list)
    }
  }

  function openMore(list) {
    trackEvent('list_overflow_opened', { listId: list.id })
    handleListAction(list)
  }

  function openList(list) {
    navigation.navigate('List', { listId: list.id, title: list.title })
  }

  function handleCreate() {
    trackEvent('list_create_initiated')
    navigation.navigate('CreateList')
  }

  const rows = useMemo(
    () => buildListsRows({ personalLists, joinedOfficial }),
    [personalLists, joinedOfficial]
  )

  const renderItem = useCallback(({ item: row }) => {
    switch (row.type) {
      case 'saved':
        return (
          <SavedCollectionCard
            count={savedItemIds.size}
            onPress={() => navigation.navigate('SavedItems')}
            colors={colors}
          />
        )
      case 'header':
        return <Text style={styles.sectionTitle}>{row.title}</Text>
      case 'empty-personal':
        return (
          <TouchableOpacity
            style={styles.emptyListCard}
            onPress={handleCreate}
            activeOpacity={0.88}
            accessibilityRole="button"
            accessibilityLabel="Start your first list"
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.emptyListTitle}>Start your first list</Text>
              <Text style={styles.emptyListSub}>
                Pick items, invite your crew, and see who checks off the most.
              </Text>
            </View>
            <Text style={styles.emptyListArrow}>→</Text>
          </TouchableOpacity>
        )
      case 'list': {
        const { list, official } = row
        const crewMembers = official ? [] : (memberMap[list.id] ?? [])
        return (
          <ListCollectionCard
            list={list}
            official={official}
            timeLeftText={list.ends_at ? timeLeft(list.ends_at) : null}
            isUrgent={!official && isUrgent(list.ends_at)}
            crewMembers={crewMembers}
            onPress={() => openList(list)}
            onLongPress={official ? undefined : () => handleListAction(list)}
            onMore={official ? undefined : () => openMore(list)}
            onAddCrew={() => navigation.navigate('SavedCrew', { list })}
            colors={colors}
          />
        )
      }
      default:
        return null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedItemIds, memberMap, colors, styles, navigation, userId])

  const keyExtractor = useCallback((row) => row.key, [])

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={AMBER} />
      </View>
    )
  }

  if (!userId) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 40 }]}>
        <View style={styles.signedOutWrap}>
          <Text style={styles.signedOutTitle}>Sign in to see your lists</Text>
          <Text style={styles.signedOutSub}>Track progress, invite your crew, and see who checks off the most.</Text>
          <TouchableOpacity style={styles.signInBtn} onPress={() => navigation.navigate('SignIn')} activeOpacity={0.88}>
            <Text style={styles.signInBtnText}>Sign in</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  if (loadError) {
    return (
      <View style={[styles.container, styles.center, { paddingHorizontal: 24 }]}>
        <Text style={styles.errorTitle}>Couldn't load your lists</Text>
        <Text style={styles.errorSub}>Check your connection and try again.</Text>
        <TouchableOpacity
          style={styles.retryBtn}
          onPress={load}
          activeOpacity={0.88}
          accessibilityRole="button"
          accessibilityLabel="Retry loading your lists"
        >
          <Text style={styles.retryBtnText}>Retry</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <FlatList
      style={styles.container}
      data={rows}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      ListHeaderComponent={<ListsHeader onCreate={handleCreate} colors={colors} />}
      ListFooterComponent={
        personalLists.length > 0 ? (
          <Text style={styles.deleteHint}>Long-press a list, or tap ⋯, to delete or leave it</Text>
        ) : null
      }
      contentContainerStyle={{ padding: 20, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }}
      showsVerticalScrollIndicator={false}
    />
  )
}

function createStyles({ colors }) {
  const { BG, TEXT, MUTED, AMBER, SOFT } = colors
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: BG,
    },
    center: {
      alignItems: 'center',
      justifyContent: 'center',
    },

    sectionTitle: {
      fontSize: 13,
      fontWeight: '900',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      color: MUTED,
      marginTop: 4,
      marginBottom: 10,
    },

    emptyListCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: SOFT,
      borderRadius: 20,
      padding: 18,
      marginBottom: 10,
      borderWidth: 1.5,
      borderColor: AMBER,
    },
    emptyListTitle: { fontSize: 15, fontWeight: '800', color: TEXT, marginBottom: 3 },
    emptyListSub:   { fontSize: 12, color: MUTED, lineHeight: 17, fontWeight: '500' },
    emptyListArrow: { fontSize: 18, color: AMBER, fontWeight: '800' },

    deleteHint: {
      fontSize: 12,
      color: MUTED,
      textAlign: 'center',
      marginTop: 8,
      marginBottom: 4,
      fontWeight: '600',
    },

    signedOutWrap: {
      alignItems: 'center',
      paddingHorizontal: 24,
    },
    signedOutTitle: {
      fontSize: 18,
      fontWeight: '800',
      color: TEXT,
      marginBottom: 8,
      textAlign: 'center',
    },
    signedOutSub: {
      fontSize: 14,
      color: MUTED,
      textAlign: 'center',
      lineHeight: 20,
      marginBottom: 20,
    },
    signInBtn: {
      backgroundColor: AMBER,
      borderRadius: 14,
      paddingVertical: 14,
      paddingHorizontal: 32,
    },
    signInBtnText: {
      fontSize: 15,
      fontWeight: '800',
      color: '#1A1A2E',
    },

    errorTitle: {
      fontSize: 17,
      fontWeight: '800',
      color: TEXT,
      marginBottom: 8,
      textAlign: 'center',
    },
    errorSub: {
      fontSize: 14,
      color: MUTED,
      textAlign: 'center',
      lineHeight: 20,
      marginBottom: 20,
    },
    retryBtn: {
      backgroundColor: AMBER,
      borderRadius: 14,
      paddingVertical: 12,
      paddingHorizontal: 28,
    },
    retryBtnText: {
      fontSize: 14,
      fontWeight: '800',
      color: '#1A1A2E',
    },
  })
}
