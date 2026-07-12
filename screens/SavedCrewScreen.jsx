import React, { useState, useCallback } from 'react'
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, ActivityIndicator, TextInput,
  Alert,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useCrewInvite } from '../lib/useCrewInvite'

const AMBER  = '#F5A623'
const NAVY   = '#1A1A2E'
const GREEN  = '#1D9E75'
const BG     = '#FFF9F2'
const CARD   = '#FFFFFF'
const TEXT   = '#243045'
const MUTED  = '#6F7785'
const BORDER = '#E6D8C7'
const SOFT   = '#FFF1DB'

/**
 * SavedCrewScreen
 *
 * Two modes:
 *   1. Browse mode (no params) — view your full saved crew
 *   2. Invite mode (list passed in params) — select crew members to add to a list
 *
 * Route params: { list?: { id, title, invite_code }, preSelected?: string[] }
 */
export default function SavedCrewScreen({ route, navigation }) {
  const { list = null, preSelected = [] } = route?.params ?? {}
  const insets = useSafeAreaInsets()
  const isInviteMode = !!list

  const { savedCrew, loading, userId, addToList } = useCrewInvite()
  const [selected, setSelected] = useState(new Set(preSelected))
  const [search, setSearch]     = useState('')
  const [adding, setAdding]     = useState(false)

  // Only the list creator can add crew members to a list
  const isCreator = !!(list?.creator_id && userId && list.creator_id === userId)
  const canInvite = isInviteMode && isCreator

  const filtered = savedCrew.filter(m =>
    !search.trim() ||
    m.displayName.toLowerCase().includes(search.toLowerCase())
  )

  function toggleMember(id) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleAddToList() {
    if (!selected.size || !list) return
    setAdding(true)
    const { error } = await addToList([...selected], list.id)
    setAdding(false)

    if (error) {
      Alert.alert('Could not add crew', error)
      return
    }

    const names = savedCrew
      .filter(m => selected.has(m.id))
      .map(m => m.displayName.split(' ')[0])
      .join(', ')

    Alert.alert(
      `${selected.size} added! 🎉`,
      `${names} ${selected.size === 1 ? 'has' : 'have'} been added to "${list.title}". They can now open the list from their home screen.`,
      [{ text: 'Done', onPress: () => navigation.goBack() }]
    )
  }

  const renderMember = useCallback(({ item: member }) => {
    const isOn = selected.has(member.id)
    return (
      <TouchableOpacity
        style={[styles.memberRow, isOn && styles.memberRowOn]}
        onPress={() => canInvite ? toggleMember(member.id) : null}
        activeOpacity={canInvite ? 0.85 : 1}
      >
        <View style={[styles.avatar, isOn && styles.avatarOn]}>
          <Text style={[styles.avatarText, isOn && styles.avatarTextOn]}>
            {member.initial}
          </Text>
        </View>

        <View style={styles.memberInfo}>
          <Text style={styles.memberName}>{member.displayName}</Text>
        </View>

        {canInvite && (
          <View style={[styles.checkCircle, isOn && styles.checkCircleOn]}>
            {isOn && <Text style={styles.checkMark}>✓</Text>}
          </View>
        )}
      </TouchableOpacity>
    )
  }, [selected, canInvite])

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={AMBER} size="large" />
      </View>
    )
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.8}>
          <Text style={styles.backBtn}>← Back</Text>
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>
            {canInvite ? 'Add to list' : 'Your crew'}
          </Text>
          {isInviteMode && (
            <Text style={styles.headerSub} numberOfLines={1}>{list.title}</Text>
          )}
        </View>

        {canInvite && selected.size > 0 ? (
          <Text style={styles.selectedCount}>{selected.size} selected</Text>
        ) : (
          <View style={{ width: 64 }} />
        )}
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search crew..."
          placeholderTextColor="#98A2B3"
          autoCorrect={false}
        />
      </View>

      {/* Empty state */}
      {savedCrew.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyEmoji}>👥</Text>
          <Text style={styles.emptyTitle}>No crew yet</Text>
          <Text style={styles.emptySub}>
            People you've shared lists with will appear here automatically. Create a list and invite someone to get started.
          </Text>
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>No results</Text>
          <Text style={styles.emptySub}>Try a different name.</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={m => m.id}
          renderItem={renderMember}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
        />
      )}

      {/* Invite mode CTA */}
      {isInviteMode && (
        <View style={[styles.ctaWrap, { paddingBottom: insets.bottom + 16 }]}>
          {!canInvite ? (
            <Text style={styles.ctaHint}>Only the list creator can add crew members</Text>
          ) : selected.size === 0 ? (
            <Text style={styles.ctaHint}>Tap crew members to select them</Text>
          ) : (
            <TouchableOpacity
              style={[styles.addBtn, adding && { opacity: 0.6 }]}
              onPress={handleAddToList}
              disabled={adding}
              activeOpacity={0.88}
            >
              {adding
                ? <ActivityIndicator color={NAVY} />
                : <Text style={styles.addBtnText}>
                    Add {selected.size} {selected.size === 1 ? 'person' : 'people'} to list →
                  </Text>
              }
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: BG },
  center:        { alignItems: 'center', justifyContent: 'center', flex: 1 },

  header: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical:   14,
    backgroundColor: BG,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },

  backBtn:       { fontSize: 15, color: TEXT, fontWeight: '700', width: 64 },

  headerCenter:  { flex: 1, alignItems: 'center' },
  headerTitle:   { fontSize: 16, fontWeight: '800', color: TEXT },
  headerSub:     { fontSize: 12, color: MUTED, marginTop: 2, maxWidth: 180 },

  selectedCount: { fontSize: 13, fontWeight: '800', color: AMBER, width: 64, textAlign: 'right' },

  searchWrap:    { paddingHorizontal: 16, paddingVertical: 10 },
  searchInput:   {
    backgroundColor: CARD,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: TEXT,
    fontSize: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },

  listContent:   { paddingHorizontal: 16, paddingBottom: 100 },
  sep:           { height: 8 },

  memberRow: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            12,
    padding:        14,
    backgroundColor: CARD,
    borderRadius:   16,
    borderWidth:    1,
    borderColor:    BORDER,
  },

  memberRowOn: {
    borderColor:    AMBER,
    backgroundColor: '#FFF7E8',
  },

  avatar: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: SOFT,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#F0D29D',
    flexShrink: 0,
  },

  avatarOn: { backgroundColor: AMBER, borderColor: AMBER },

  avatarText:    { fontSize: 16, fontWeight: '800', color: '#A16A00' },
  avatarTextOn:  { color: NAVY },

  memberInfo:    { flex: 1 },
  memberName:    { fontSize: 15, color: TEXT, fontWeight: '700' },

  checkCircle: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 1.5, borderColor: '#CABFB1',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fff',
    flexShrink: 0,
  },

  checkCircleOn: { backgroundColor: AMBER, borderColor: AMBER },
  checkMark:     { fontSize: 12, color: NAVY, fontWeight: '800' },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyEmoji:    { fontSize: 44, marginBottom: 16 },
  emptyTitle:    { fontSize: 18, fontWeight: '800', color: TEXT, marginBottom: 8 },
  emptySub:      { fontSize: 14, color: MUTED, textAlign: 'center', lineHeight: 21 },

  ctaWrap: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 20, paddingTop: 12,
    backgroundColor: BG,
    borderTopWidth: 1, borderTopColor: BORDER,
  },

  ctaHint:    { fontSize: 13, color: MUTED, textAlign: 'center', paddingVertical: 14, fontWeight: '600' },

  addBtn: {
    backgroundColor: AMBER, borderRadius: 16,
    paddingVertical: 17, alignItems: 'center',
  },

  addBtnText: { fontSize: 15, fontWeight: '800', color: NAVY },
})
