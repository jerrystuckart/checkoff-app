import React, { useState, useEffect, useMemo } from 'react'
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, ActivityIndicator,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase } from '../lib/supabase'
import { useTheme } from '../lib/ThemeContext'

export default function CreatorListScreen({ navigation, route }) {
  const { metro } = route.params ?? {}
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const { BG, CARD, TEXT, MUTED, BORDER, SOFT, AMBER, NAVY } = colors

  const styles = useMemo(() => createStyles({ BG, CARD, TEXT, MUTED, BORDER, SOFT, AMBER, NAVY }),
    [BG, CARD, TEXT, MUTED, BORDER, SOFT, AMBER, NAVY])

  const [creators, setCreators] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    load()
  }, [metro?.id])

  async function load() {
    setLoading(true)
    try {
      // Step 1: find creator IDs that have a qualifying list in this metro
      const listQuery = supabase
        .from('lists')
        .select('checkoff_creator_id')
        .eq('is_featured_eligible', true)
        .not('goes_public_at', 'is', null)
        .not('checkoff_creator_id', 'is', null)

      if (metro?.id) {
        listQuery.eq('metro_id', metro.id)
      }

      const { data: listRows } = await listQuery
      const creatorIds = [...new Set((listRows ?? []).map(l => l.checkoff_creator_id).filter(Boolean))]

      if (creatorIds.length === 0) {
        setCreators([])
        return
      }

      // Step 2: fetch active creators with those IDs
      const { data: rows } = await supabase
        .from('creators')
        .select('id, handle, display_name, bio, avatar_url')
        .in('id', creatorIds)
        .eq('is_active', true)
        .order('display_name')

      setCreators(rows ?? [])
    } catch (e) {
      // silent
    } finally {
      setLoading(false)
    }
  }

  const metroLabel = metro?.name?.replace(' Metro', '') ?? 'Local'

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.title}>Local Creators</Text>
          <Text style={styles.subtitle}>{metroLabel} curated lists</Text>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color={AMBER} style={{ marginTop: 40 }} />
      ) : creators.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No creators yet</Text>
          <Text style={styles.emptySub}>Check back soon as we expand to more cities.</Text>
        </View>
      ) : (
        <FlatList
          data={creators}
          keyExtractor={c => c.id}
          contentContainerStyle={styles.list}
          renderItem={({ item: c }) => (
            <TouchableOpacity
              style={styles.creatorCard}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('CreatorProfile', { handle: c.handle })}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {(c.display_name ?? c.handle ?? '?')[0].toUpperCase()}
                </Text>
              </View>
              <View style={styles.info}>
                <Text style={styles.displayName}>{c.display_name ?? c.handle}</Text>
                <Text style={styles.handle}>@{c.handle}</Text>
                {!!c.bio && (
                  <Text style={styles.bio} numberOfLines={2}>{c.bio}</Text>
                )}
              </View>
              <Text style={styles.arrow}>→</Text>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  )
}

function createStyles({ BG, CARD, TEXT, MUTED, BORDER, SOFT, AMBER, NAVY }) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: BG,
    },
    header: {
      paddingHorizontal: 20,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: BORDER,
    },
    backBtn: {
      marginBottom: 10,
    },
    backText: {
      fontSize: 14,
      color: AMBER,
      fontWeight: '700',
    },
    headerText: {},
    title: {
      fontSize: 22,
      fontWeight: '800',
      color: TEXT,
    },
    subtitle: {
      fontSize: 13,
      color: MUTED,
      marginTop: 2,
      fontWeight: '600',
    },
    list: {
      padding: 20,
      gap: 12,
    },
    creatorCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: CARD,
      borderRadius: 18,
      padding: 16,
      borderWidth: 1,
      borderColor: BORDER,
      gap: 14,
    },
    avatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: AMBER,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: {
      fontSize: 20,
      fontWeight: '800',
      color: NAVY,
    },
    info: {
      flex: 1,
    },
    displayName: {
      fontSize: 16,
      fontWeight: '800',
      color: TEXT,
    },
    handle: {
      fontSize: 12,
      color: MUTED,
      fontWeight: '600',
      marginTop: 1,
    },
    bio: {
      fontSize: 13,
      color: MUTED,
      marginTop: 4,
      lineHeight: 18,
    },
    arrow: {
      fontSize: 18,
      color: AMBER,
      fontWeight: '800',
    },
    empty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 40,
    },
    emptyTitle: {
      fontSize: 17,
      fontWeight: '800',
      color: TEXT,
      marginBottom: 8,
    },
    emptySub: {
      fontSize: 14,
      color: MUTED,
      textAlign: 'center',
      lineHeight: 20,
    },
  })
}
