import React, { useState, useCallback, useMemo } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect } from '@react-navigation/native'
import { supabase } from '../lib/supabase'
import { useTheme } from '../lib/ThemeContext'

const LIST_ACCENT_COLORS = ['#F5A623', '#7A4DB3', '#2E7D8C', '#2E6B3E', '#C0674A', '#378ADD']

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
  const { BG, CARD, TEXT, MUTED, BORDER, SOFT, AMBER, CARD_URGENT } = colors
  const styles = useMemo(() => createStyles({ BG, CARD, TEXT, MUTED, BORDER, SOFT, AMBER, CARD_URGENT }),
    [BG, CARD, TEXT, MUTED, BORDER, SOFT, AMBER, CARD_URGENT])

  const [userId, setUserId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [personalLists, setPersonalLists] = useState([])
  const [memberMap, setMemberMap] = useState({})
  const [joinedOfficial, setJoinedOfficial] = useState([])

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

    try {
      const { data: memberLists } = await supabase
        .from('list_members')
        .select('lists(id, title, starts_at, ends_at, is_public, is_official, creator_id, cover_emoji, checkoff_creator_id, is_featured_eligible)')
        .eq('user_id', user.id)

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
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(useCallback(() => { load() }, [load]))

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

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 20, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.headerRow}>
        <Text style={styles.screenTitle}>Your lists</Text>
        <TouchableOpacity
          style={styles.createNewBtn}
          onPress={() => navigation.navigate('CreateList')}
          activeOpacity={0.85}
        >
          <Text style={styles.createNewBtnText}>+ New list</Text>
        </TouchableOpacity>
      </View>

      {personalLists.length === 0 ? (
        <TouchableOpacity
          style={styles.emptyListCard}
          onPress={() => navigation.navigate('CreateList')}
          activeOpacity={0.88}
        >
          <Text style={styles.emptyListEmoji}>📋</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.emptyListTitle}>Start your first list</Text>
            <Text style={styles.emptyListSub}>
              Pick items, invite your crew, and see who checks off the most.
            </Text>
          </View>
          <Text style={styles.emptyListArrow}>→</Text>
        </TouchableOpacity>
      ) : (
        <>
          {personalLists.map(list => {
            const crewMembers = memberMap[list.id] ?? []
            const isFeaturedCreatorList = !!list.creatorHandle && !!list.is_featured_eligible
            const accent = isFeaturedCreatorList ? '#F5A623' : LIST_ACCENT_COLORS[list.id.charCodeAt(0) % 6]
            return (
              <TouchableOpacity
                key={list.id}
                style={[styles.listCard, isUrgent(list.ends_at) && styles.listCardUrgent, isFeaturedCreatorList && styles.listCardCreator]}
                onPress={() => navigation.navigate('List', { listId: list.id, title: list.title })}
                onLongPress={() => {
                  if (list.creator_id === userId) {
                    deleteList(list)
                  } else {
                    leaveList(list)
                  }
                }}
                activeOpacity={0.85}
              >
                <View style={[styles.listAccent, { backgroundColor: accent, borderColor: accent }]} />

                <View style={{ flex: 1 }}>
                  <Text style={styles.listTitle}>{list.title}</Text>
                  {isFeaturedCreatorList ? (
                    <Text style={styles.listCreatorByline}>by @{list.creatorHandle}</Text>
                  ) : null}
                  <View style={styles.listMetaRow}>
                    {list.ends_at ? (
                      <Text style={[styles.listMeta, isUrgent(list.ends_at) && styles.listMetaUrgent]}>
                        {timeLeft(list.ends_at)}
                      </Text>
                    ) : (
                      <Text style={styles.listMeta}>Open-ended</Text>
                    )}
                    {crewMembers.length > 0 && (
                      <View style={styles.crewAvatarStack}>
                        {crewMembers.map(m => (
                          <View key={m.id} style={styles.crewAvatarMini}>
                            <Text style={styles.crewAvatarMiniText}>{m.initial}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                </View>

                <View style={styles.listCardRight}>
                  {list.memberCount > 1 && (
                    <TouchableOpacity
                      style={styles.addCrewBtn}
                      onPress={() => navigation.navigate('SavedCrew', { list })}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={styles.addCrewBtnText}>+ Crew</Text>
                    </TouchableOpacity>
                  )}
                  <Text style={styles.listChevron}>→</Text>
                </View>
              </TouchableOpacity>
            )
          })}

          <Text style={styles.deleteHint}>Long-press a list to delete or leave it</Text>
        </>
      )}

      {joinedOfficial.length > 0 && (
        <>
          <Text style={[styles.screenTitle, styles.sectionSpacer]}>Joined lists</Text>
          {joinedOfficial.map(list => (
            <TouchableOpacity
              key={list.id}
              style={styles.officialRow}
              onPress={() => navigation.navigate('List', { listId: list.id, title: list.title })}
              activeOpacity={0.85}
            >
              <Text style={styles.officialEmoji}>{list.cover_emoji ?? '📋'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.listTitle}>{list.title}</Text>
                <Text style={styles.listMeta}>{list.ends_at ? timeLeft(list.ends_at) : 'Open-ended'}</Text>
              </View>
              <Text style={styles.listChevron}>→</Text>
            </TouchableOpacity>
          ))}
        </>
      )}
    </ScrollView>
  )
}

function createStyles({ BG, CARD, TEXT, MUTED, BORDER, SOFT, AMBER, CARD_URGENT }) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: BG,
    },
    center: {
      alignItems: 'center',
      justifyContent: 'center',
    },

    headerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 16,
    },
    screenTitle: {
      fontSize: 22,
      fontWeight: '800',
      color: TEXT,
    },
    sectionSpacer: {
      marginTop: 24,
      marginBottom: 12,
      fontSize: 16,
    },

    createNewBtn: {
      backgroundColor: SOFT,
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderWidth: 1,
      borderColor: '#E8C98E',
    },
    createNewBtnText: {
      fontSize: 14,
      color: '#A16A00',
      fontWeight: '800',
    },

    listCard: {
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
    listCardUrgent: {
      borderColor: 'rgba(245,166,35,0.5)',
      backgroundColor: CARD_URGENT,
    },
    listCardCreator: {
      borderColor: 'rgba(245,166,35,0.35)',
    },

    listAccent: {
      width: 8,
      alignSelf: 'stretch',
      borderRadius: 999,
      backgroundColor: SOFT,
    },

    listTitle: {
      fontSize: 15,
      color: TEXT,
      fontWeight: '800',
      flex: 1,
    },
    listCreatorByline: {
      fontSize: 12,
      color: '#F5A623',
      fontWeight: '600',
      marginTop: 2,
      marginBottom: 2,
    },

    listMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 4,
      flexWrap: 'wrap',
    },
    listMeta: {
      fontSize: 12,
      color: MUTED,
      marginTop: 4,
      fontWeight: '600',
    },
    listMetaUrgent: {
      color: AMBER,
      fontWeight: '800',
    },

    crewAvatarStack: {
      flexDirection: 'row',
      gap: -6,
    },
    crewAvatarMini: {
      width: 20, height: 20, borderRadius: 10,
      backgroundColor: SOFT,
      alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: '#F0D29D',
      marginRight: -6,
    },
    crewAvatarMiniText: {
      fontSize: 9, fontWeight: '800', color: '#A16A00',
    },

    listCardRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flexShrink: 0,
    },
    addCrewBtn: {
      backgroundColor: SOFT,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderWidth: 1,
      borderColor: '#E8C98E',
    },
    addCrewBtnText: {
      fontSize: 11, fontWeight: '800', color: '#A16A00',
    },
    listChevron: {
      fontSize: 17,
      color: MUTED,
      fontWeight: '700',
    },

    deleteHint: {
      fontSize: 12,
      color: MUTED,
      textAlign: 'center',
      marginTop: 6,
      marginBottom: 8,
      fontWeight: '600',
    },

    emptyListCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: SOFT,
      borderRadius: 20,
      padding: 18,
      marginBottom: 20,
      borderWidth: 1.5,
      borderColor: AMBER,
    },
    emptyListEmoji: { fontSize: 28 },
    emptyListTitle: { fontSize: 15, fontWeight: '800', color: TEXT, marginBottom: 3 },
    emptyListSub:   { fontSize: 12, color: MUTED, lineHeight: 17, fontWeight: '500' },
    emptyListArrow: { fontSize: 18, color: AMBER, fontWeight: '800' },

    officialRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: CARD,
      borderRadius: 18,
      padding: 16,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: BORDER,
    },
    officialEmoji: { fontSize: 22 },

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
  })
}
