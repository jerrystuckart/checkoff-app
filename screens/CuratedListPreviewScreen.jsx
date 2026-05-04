import React, { useState, useEffect } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, StatusBar, ActivityIndicator, Alert,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase } from '../lib/supabase'
import { fetchCuratedListItems } from '../lib/useItems'

const AMBER  = '#F5A623'
const NAVY   = '#1A1A2E'
const GREEN  = '#1D9E75'
const BG     = '#FFF9F2'
const CARD   = '#FFFFFF'
const TEXT   = '#243045'
const MUTED  = '#6F7785'
const BORDER = '#E6D8C7'
const SOFT   = '#FFF1DB'
const SUCCESS_BG     = '#EAF8F2'
const SUCCESS_BORDER = '#BFE7D7'

const SEASON_META = {
  summer:  { label: 'Summer',  bg: '#FFF1DB', text: '#A16A00', border: '#E8C98E' },
  fall:    { label: 'Fall',    bg: '#FDF0E6', text: '#8B4A0E', border: '#EAC49A' },
  winter:  { label: 'Winter',  bg: '#EAF4FB', text: '#1A5F85', border: '#B0D9F0' },
  spring:  { label: 'Spring',  bg: '#EAF8F2', text: '#1D6A50', border: '#BFE7D7' },
  anytime: { label: 'Anytime', bg: '#F4F0FB', text: '#5A3D99', border: '#CFC2F0' },
}

export default function CuratedListPreviewScreen({ navigation, route }) {
  const insets = useSafeAreaInsets()
  const {
    curatedListId,
    groupName,
    groupEmoji,
    groupTagline,
    citySlug,
    metroName = 'Phoenix',
    variants,     // optional — if group has multiple season variants
  } = route.params

  const [selectedId, setSelectedId]     = useState(curatedListId)
  const [previewItems, setPreviewItems] = useState([])
  const [totalCount, setTotalCount]     = useState(0)
  const [loadingPreview, setLoadingPreview] = useState(true)
  const [adopting, setAdopting]         = useState(false)
  const [user, setUser]                 = useState(null)

  // Resolve current user
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data?.user ?? null))
  }, [])

  // Load preview items whenever selected variant changes
  useEffect(() => {
    loadPreview(selectedId)
  }, [selectedId])

  async function loadPreview(id) {
    setLoadingPreview(true)
    const { data, error } = await fetchCuratedListItems(id)
    if (!error) {
      setTotalCount(data.length)
      // Show first 5 as a teaser
      setPreviewItems(data.slice(0, 5))
    }
    setLoadingPreview(false)
  }

  async function handleAdopt() {
    if (!user) {
      Alert.alert(
        'Sign in first',
        'You need an account to create and save lists.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sign in', onPress: () => navigation.navigate('SignIn') },
        ]
      )
      return
    }

    // Resolve city_id and metro_id, build default title, then hand off to
    // CreateListScreen so the user can set a name and end date before anything
    // is written to the database.
    setAdopting(true)
    try {
      const { data: cityRow } = await supabase
        .from('cities')
        .select('id')
        .ilike('name', `%${metroName.replace(' Metro', '')}%`)
        .maybeSingle()

      const { data: metroRow } = await supabase
        .from('metro_areas')
        .select('id')
        .eq('slug', citySlug)
        .maybeSingle()

      const selectedVariant = variants?.find(v => v.id === selectedId)
      const season      = selectedVariant?.season ?? 'anytime'
      const year        = selectedVariant?.year   ?? new Date().getFullYear()
      const seasonLabel = SEASON_META[season]?.label ?? 'My'
      const defaultTitle = `${groupName} · ${seasonLabel} ${year}`

      navigation.navigate('CreateList', {
        curatedListId:  selectedId,
        defaultTitle,
        groupEmoji:     groupEmoji ?? '📋',
        curatedCityId:  cityRow?.id  ?? null,
        curatedMetroId: metroRow?.id ?? null,
      })
    } catch (e) {
      Alert.alert('Something went wrong', e.message)
    } finally {
      setAdopting(false)
    }
  }

  const selectedVariant = variants?.find(v => v.id === selectedId)
  const season = selectedVariant?.season ?? 'anytime'
  const seasonMeta = SEASON_META[season] ?? SEASON_META.anytime

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ ...styles.content, paddingTop: insets.top + 12 }}
        showsVerticalScrollIndicator={false}
      >
        <StatusBar barStyle="dark-content" />

        {/* Header */}
        <View style={styles.heroCard}>
          <View style={styles.emojiCircle}>
            <Text style={styles.emojiText}>{groupEmoji ?? '📋'}</Text>
          </View>
          <Text style={styles.groupName}>{groupName}</Text>
          <Text style={styles.groupTagline}>"{groupTagline}"</Text>

          {/* Season variant selector — only if multiple */}
          {variants && variants.length > 1 && (
            <View style={styles.variantSelector}>
              <Text style={styles.variantSelectorLabel}>Pick a season</Text>
              <View style={styles.variantRow}>
                {variants.map(v => {
                  const s = SEASON_META[v.season] ?? SEASON_META.anytime
                  const active = v.id === selectedId
                  return (
                    <TouchableOpacity
                      key={v.id}
                      onPress={() => setSelectedId(v.id)}
                      style={[
                        styles.variantPill,
                        { backgroundColor: s.bg, borderColor: s.border },
                        active && styles.variantPillActive,
                      ]}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.variantPillText, { color: s.text }]}>
                        {s.label}{v.year ? ` ${v.year}` : ''}
                      </Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
            </View>
          )}
        </View>

        {/* Item preview */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionLabel}>What's on it</Text>
          {!loadingPreview && (
            <View style={[styles.countPill, { backgroundColor: seasonMeta.bg, borderColor: seasonMeta.border }]}>
              <Text style={[styles.countPillText, { color: seasonMeta.text }]}>
                {totalCount} items
              </Text>
            </View>
          )}
        </View>

        {loadingPreview ? (
          <ActivityIndicator color={AMBER} style={{ marginVertical: 24 }} />
        ) : (
          <>
            {previewItems.map((li, index) => (
              <View key={li.id} style={styles.previewItem}>
                <View style={[
                  styles.previewNumber,
                  { backgroundColor: index < 3 ? SOFT : '#F4F0FB',
                    borderColor: index < 3 ? '#F0D29D' : '#CFC2F0' }
                ]}>
                  <Text style={[
                    styles.previewNumberText,
                    { color: index < 3 ? '#A16A00' : '#5A3D99' }
                  ]}>
                    {index + 1}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.previewBody}>{li.items?.body ?? ''}</Text>
                  {li.items?.categories?.name && (
                    <Text style={styles.previewCategory}>{li.items.categories.name}</Text>
                  )}
                </View>
                {li.items?.checkin_type === 'photo' && (
                  <Text style={styles.photoTag}>📷</Text>
                )}
                {li.items?.checkin_type === 'gps' && (
                  <Text style={styles.photoTag}>📍</Text>
                )}
              </View>
            ))}

            {totalCount > 5 && (
              <View style={styles.moreCard}>
                <Text style={styles.moreText}>
                  + {totalCount - 5} more items waiting for you
                </Text>
              </View>
            )}
          </>
        )}

        {/* What happens when you adopt */}
        <View style={styles.howItWorksCard}>
          <Text style={styles.howTitle}>How it works</Text>
          <Text style={styles.howItem}>✓  We build your list from this template</Text>
          <Text style={styles.howItem}>✓  You own it — rename, add, or remove items</Text>
          <Text style={styles.howItem}>✓  Invite friends to join and compete</Text>
          <Text style={styles.howItem}>✓  Check things off as you go</Text>
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Sticky adopt button */}
      <View style={[styles.stickyFooter, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={[styles.adoptBtn, adopting && styles.adoptBtnDisabled]}
          onPress={handleAdopt}
          disabled={adopting}
          activeOpacity={0.88}
        >
          {adopting ? (
            <ActivityIndicator color={NAVY} size="small" />
          ) : (
            <Text style={styles.adoptBtnText}>
              {groupEmoji ?? '📋'}  Build my {groupName} list
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  heroCard: {
    backgroundColor: CARD,
    borderRadius: 24,
    padding: 20,
    marginBottom: 24,
    borderWidth: 1.2,
    borderColor: BORDER,
    alignItems: 'center',
  },
  emojiCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: SOFT,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#F0D29D',
    marginBottom: 14,
  },
  emojiText: {
    fontSize: 36,
  },
  groupName: {
    fontSize: 22,
    fontWeight: '900',
    color: TEXT,
    textAlign: 'center',
    letterSpacing: -0.3,
    marginBottom: 8,
  },
  groupTagline: {
    fontSize: 15,
    color: MUTED,
    fontStyle: 'italic',
    textAlign: 'center',
    lineHeight: 22,
  },
  variantSelector: {
    marginTop: 16,
    width: '100%',
    paddingTop: 16,
    borderTopWidth: 0.5,
    borderTopColor: BORDER,
  },
  variantSelectorLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: MUTED,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 10,
    textAlign: 'center',
  },
  variantRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  variantPill: {
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
  },
  variantPillActive: {
    borderWidth: 2,
  },
  variantPillText: {
    fontSize: 13,
    fontWeight: '800',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.4,
    color: MUTED,
    textTransform: 'uppercase',
  },
  countPill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
  },
  countPillText: {
    fontSize: 12,
    fontWeight: '800',
  },
  previewItem: {
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 14,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: BORDER,
  },
  previewNumber: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  previewNumberText: {
    fontSize: 13,
    fontWeight: '900',
  },
  previewBody: {
    fontSize: 14,
    fontWeight: '700',
    color: TEXT,
    lineHeight: 20,
  },
  previewCategory: {
    fontSize: 12,
    color: MUTED,
    marginTop: 3,
    fontWeight: '600',
  },
  photoTag: {
    fontSize: 16,
  },
  moreCard: {
    backgroundColor: SOFT,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#F0D29D',
  },
  moreText: {
    fontSize: 14,
    color: '#A16A00',
    fontWeight: '800',
  },
  howItWorksCard: {
    backgroundColor: SUCCESS_BG,
    borderRadius: 18,
    padding: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: SUCCESS_BORDER,
    gap: 8,
  },
  howTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: GREEN,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  howItem: {
    fontSize: 14,
    color: '#287A5F',
    fontWeight: '600',
    lineHeight: 20,
  },
  stickyFooter: {
    backgroundColor: BG,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 0.5,
    borderTopColor: BORDER,
  },
  adoptBtn: {
    backgroundColor: AMBER,
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adoptBtnDisabled: {
    opacity: 0.6,
  },
  adoptBtnText: {
    fontSize: 16,
    fontWeight: '900',
    color: NAVY,
    letterSpacing: -0.2,
  },
})
