import React, { useState, useEffect } from 'react'
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, ActivityIndicator,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase } from '../lib/supabase'

const AMBER  = '#F5A623'
const BG     = '#FFF9F2'
const CARD   = '#FFFFFF'
const TEXT   = '#243045'
const MUTED  = '#6F7785'
const BORDER = '#E6D8C7'

const ENDED_BG     = '#F4EEF9'
const ENDED_BORDER = '#DCCCED'
const ENDED_TEXT   = '#7A4DB3'

function formatEndedDate(endsAt) {
  if (!endsAt) return 'Ended'
  const d = new Date(`${endsAt}T12:00:00`)
  if (Number.isNaN(d.getTime())) return 'Ended'
  return `Ended ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
}

export default function PastListsScreen({ route, navigation }) {
  const { userId, metroId } = route.params ?? {}
  const insets = useSafeAreaInsets()

  const [personalLists, setPersonalLists] = useState([])
  const [officialLists, setOfficialLists]  = useState([])
  const [loading, setLoading]              = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const todayStr = today.toISOString()

      const queries = [
        // Official ended lists for this metro, newest first
        supabase
          .from('lists')
          .select('id, title, ends_at, cover_emoji, starts_at')
          .eq('is_official', true)
          .eq('is_public', true)
          .eq('metro_id', metroId)
          .lt('ends_at', todayStr)
          .order('ends_at', { ascending: false }),
      ]

      if (userId) {
        // Personal ended lists the user is a member of
        queries.push(
          supabase
            .from('list_members')
            .select('lists(id, title, ends_at, is_official)')
            .eq('user_id', userId)
        )
      }

      const [officialRes, personalRes] = await Promise.all(queries)

      setOfficialLists(officialRes.data ?? [])

      if (personalRes) {
        const ended = (personalRes.data ?? [])
          .map(m => m.lists)
          .filter(l => l && !l.is_official && l.ends_at && new Date(`${l.ends_at}T12:00:00`) < today)
          .sort((a, b) => new Date(b.ends_at) - new Date(a.ends_at))
        setPersonalLists(ended)
      }
    } catch (e) {
      console.warn('PastListsScreen load error:', e.message)
    } finally {
      setLoading(false)
    }
  }

  const sections = []
  if (personalLists.length > 0) {
    sections.push({ type: 'header', label: 'Your past lists' })
    personalLists.forEach(l => sections.push({ type: 'personal', list: l }))
  }
  if (officialLists.length > 0) {
    sections.push({ type: 'header', label: 'Past seasonal lists' })
    officialLists.forEach(l => sections.push({ type: 'official', list: l }))
  }

  function renderRow({ item: row }) {
    if (row.type === 'header') {
      return <Text style={styles.sectionLabel}>{row.label}</Text>
    }

    const { list } = row
    const isOfficial = row.type === 'official'

    return (
      <TouchableOpacity
        style={[styles.card, isOfficial && styles.cardOfficial]}
        onPress={() => navigation.navigate('List', { listId: list.id, title: list.title })}
        activeOpacity={0.85}
      >
        {isOfficial ? (
          <View style={styles.emojiWrap}>
            <Text style={styles.emoji}>{list.cover_emoji ?? '🏁'}</Text>
          </View>
        ) : (
          <View style={styles.accent} />
        )}

        <View style={{ flex: 1 }}>
          <Text style={styles.listTitle} numberOfLines={1}>{list.title}</Text>
          <Text style={styles.listMeta}>{formatEndedDate(list.ends_at)}</Text>
        </View>

        <View style={styles.badge}>
          <Text style={styles.badgeText}>{isOfficial ? 'Results →' : 'Ended'}</Text>
        </View>
      </TouchableOpacity>
    )
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.8}>
          <Text style={styles.backBtn}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Past lists</Text>
        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={AMBER} size="large" />
        </View>
      ) : sections.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>📋</Text>
          <Text style={styles.emptyTitle}>No past lists yet</Text>
          <Text style={styles.emptySub}>Ended lists will appear here.</Text>
        </View>
      ) : (
        <FlatList
          data={sections}
          keyExtractor={(row, i) => row.type === 'header' ? `h-${i}` : String(row.list.id)}
          renderItem={renderRow}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={({ leadingItem }) =>
            leadingItem?.type !== 'header' ? <View style={styles.sep} /> : null
          }
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: BG },
  center:     { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  listContent: { paddingHorizontal: 16, paddingBottom: 40 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    backgroundColor: BG,
  },
  backBtn:     { fontSize: 15, color: TEXT, fontWeight: '700', width: 60 },
  headerTitle: { fontSize: 17, fontWeight: '800', color: TEXT },

  sectionLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: MUTED,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingTop: 20,
    paddingBottom: 10,
  },

  card: {
    backgroundColor: CARD,
    borderRadius: 18,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER,
    gap: 12,
  },

  cardOfficial: {
    borderColor: ENDED_BORDER,
    backgroundColor: CARD,
  },

  accent: {
    width: 8,
    alignSelf: 'stretch',
    borderRadius: 999,
    backgroundColor: ENDED_BG,
    borderWidth: 1,
    borderColor: ENDED_BORDER,
  },

  emojiWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: ENDED_BG,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: ENDED_BORDER,
  },

  emoji:     { fontSize: 22 },
  listTitle: { fontSize: 15, fontWeight: '800', color: TEXT },
  listMeta:  { fontSize: 12, color: MUTED, fontWeight: '600', marginTop: 3 },

  badge: {
    backgroundColor: ENDED_BG,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: ENDED_BORDER,
  },
  badgeText: { fontSize: 11, color: ENDED_TEXT, fontWeight: '800' },

  sep: { height: 8 },

  emptyEmoji:  { fontSize: 44, marginBottom: 16 },
  emptyTitle:  { fontSize: 18, fontWeight: '800', color: TEXT, marginBottom: 8 },
  emptySub:    { fontSize: 14, color: MUTED, textAlign: 'center', lineHeight: 20 },
})
