import React, { useState, useEffect, useMemo } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, StatusBar, ActivityIndicator, Alert,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CommonActions } from '@react-navigation/native'
import { supabase } from '../lib/supabase'
import { fetchCuratedListItems } from '../lib/useItems'
import { useTheme } from '../lib/ThemeContext'

const AMBER  = '#F5A623'
const NAVY   = '#1A1A2E'
const GREEN  = '#1D9E75'
const SUCCESS_BG     = '#EAF8F2'

const SEASON_META = {
  summer:  { label: 'Summer',  bg: '#FFF1DB', text: '#A16A00', border: '#E8C98E' },
  fall:    { label: 'Fall',    bg: '#FDF0E6', text: '#8B4A0E', border: '#EAC49A' },
  winter:  { label: 'Winter',  bg: '#EAF4FB', text: '#1A5F85', border: '#B0D9F0' },
  spring:  { label: 'Spring',  bg: '#EAF8F2', text: '#1D6A50', border: '#BFE7D7' },
  anytime: { label: 'Anytime', bg: '#F4F0FB', text: '#5A3D99', border: '#CFC2F0' },
}

export default function CuratedListPreviewScreen({ navigation, route }) {
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const { BG, CARD, TEXT, MUTED, BORDER, SOFT, AMBER, NAVY, GREEN, SUCCESS_BG, SUCCESS_BORDER } = colors
  const styles = useMemo(() => createCuratedStyles({ BG, CARD, TEXT, MUTED, BORDER, SOFT, AMBER, NAVY, GREEN, SUCCESS_BG, SUCCESS_BORDER }),
    [BG, CARD, TEXT, MUTED, BORDER, SOFT, AMBER, NAVY, GREEN, SUCCESS_BG, SUCCESS_BORDER])

  // Params — standard mode passes all group fields; next10 mode passes only listId
  const {
    listId,                          // next10 / deep-link mode
    curatedListId,                   // standard mode
    groupName:     paramGroupName,
    groupEmoji:    paramGroupEmoji,
    groupTagline:  paramGroupTagline,
    citySlug:      paramCitySlug,
    metroName:     paramMetroName,
    variants,
  } = route.params ?? {}

  // next10 mode: either a listId was passed (banner), or nothing was passed (deep link)
  // Standard mode only when curatedListId + group params are explicitly provided
  const next10Mode = !curatedListId

  // ── Resolved display state ──
  // Standard mode: seeded from params immediately.
  // next10 mode: seeded to defaults then overwritten by fetch.
  const [groupName,    setGroupName]    = useState(paramGroupName    ?? '')
  const [groupEmoji,   setGroupEmoji]   = useState(paramGroupEmoji   ?? '🔟')
  const [groupTagline, setGroupTagline] = useState(paramGroupTagline ?? '')
  const [citySlug,     setCitySlug]     = useState(paramCitySlug     ?? '')
  const [metroName,    setMetroName]    = useState(paramMetroName    ?? 'Phoenix')

  // ── Core list state ──
  const [selectedId, setSelectedId]         = useState(listId ?? curatedListId ?? null)
  const [previewItems, setPreviewItems]     = useState([])
  const [totalCount, setTotalCount]         = useState(0)
  const [loadingPreview, setLoadingPreview] = useState(true)
  const [adopting, setAdopting]             = useState(false)
  const [joining, setJoining]               = useState(false)
  const [resolvedMetroId, setResolvedMetroId] = useState(null)
  const [user, setUser]                     = useState(null)
  const [fetchError, setFetchError]         = useState(null) // null | 'no_list' | 'fetch_failed'
  const [next10EndsAt, setNext10EndsAt]     = useState(null)

  // Resolve current user
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data?.user ?? null))
  }, [])

  // next10 mode: fetch list metadata + metro
  useEffect(() => {
    if (next10Mode) fetchNext10Meta()
  }, []) // eslint-disable-line

  // Load preview items whenever selectedId is set / changes
  useEffect(() => {
    if (selectedId) loadPreview(selectedId)
  }, [selectedId]) // eslint-disable-line

  async function fetchNext10Meta() {
    // loadingPreview is already true from useState — keep it true until items resolve.
    setFetchError(null)

    let listRow = null
    try {
      let query = supabase
        .from('curated_lists')
        .select('id, title, tagline, city_slug, ends_at')

      if (listId) {
        query = query.eq('id', listId)
      } else {
        query = query
          .eq('audience_group', 'the-next-10')
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(1)
      }

      const { data, error } = await query.maybeSingle()
      if (error) throw error
      listRow = data
    } catch (e) {
      console.error('fetchNext10Meta error:', e?.message ?? e)
      setFetchError('fetch_failed')
      setLoadingPreview(false)
      return
    }

    if (!listRow) {
      setFetchError('no_list')
      setLoadingPreview(false)
      return
    }

    setGroupName(listRow.title)
    setGroupTagline(listRow.tagline ?? '')
    if (listRow.ends_at) setNext10EndsAt(listRow.ends_at)

    // Trigger item load — loadPreview will set loadingPreview → false when done.
    // When listId was already known (banner path) selectedId is already set and
    // loadPreview fired via the other useEffect, so only call setSelectedId here
    // for the pure deep-link path where we just looked up the id.
    if (!listId) setSelectedId(listRow.id)

    // Resolve metro display name + id from city_slug (non-blocking)
    if (listRow.city_slug) {
      setCitySlug(listRow.city_slug)
      const { data: metro } = await supabase
        .from('metro_areas')
        .select('id, name, slug')
        .eq('slug', listRow.city_slug)
        .maybeSingle()
      if (metro) {
        setMetroName(metro.name?.replace(' Metro', '') ?? 'Phoenix')
        setResolvedMetroId(metro.id)
      }
    }
  }

  async function loadPreview(id) {
    setLoadingPreview(true)
    const { data, error } = await fetchCuratedListItems(id)
    if (!error) {
      setTotalCount(data.length)
      setPreviewItems(data.slice(0, 5))
    }
    setLoadingPreview(false)
  }


  async function handleNext10Join() {
    if (!user) {
      Alert.alert(
        'Sign in first',
        'You need an account to join the challenge.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sign in', onPress: () => navigation.navigate('SignIn') },
        ]
      )
      return
    }

    if (!selectedId) {
      Alert.alert('Still loading', 'The list is still loading — please wait a moment and try again.')
      return
    }

    setJoining(true)
    try {
      // 0. Dedup check — if user already has an active Next 10 list, go straight there
      const today = new Date().toISOString().split('T')[0]
      const { data: existingNext10 } = await supabase
        .from('lists')
        .select('id, title')
        .eq('creator_id', user.id)
        .eq('cover_emoji', '🔟')
        .gte('ends_at', today)
        .maybeSingle()

      if (existingNext10) {
        navigation.dispatch(
          CommonActions.reset({
            index: 1,
            routes: [
              { name: 'Home' },
              { name: 'List', params: { listId: existingNext10.id, title: existingNext10.title || 'The Next 10' } },
            ],
          })
        )
        return
      }

      // 1. Fetch all 10 curated item IDs in display_order
      const { data: listItems, error: itemsError } = await supabase
        .from('curated_list_items')
        .select('item_id, display_order')
        .eq('curated_list_id', selectedId)
        .order('display_order', { ascending: true })

      if (itemsError) throw itemsError

      // 2. Resolve city_id (nullable, matches CreateListScreen pattern)
      const { data: cityRow } = await supabase
        .from('cities')
        .select('id')
        .ilike('name', `%${metroName.replace(' Metro', '')}%`)
        .maybeSingle()

      // 3. Create the list — exact same fields as CreateListScreen curated mode
      const inviteCode = Math.random().toString(36).slice(2, 9).toUpperCase()
      const { data: newList, error: listError } = await supabase
        .from('lists')
        .insert({
          creator_id:  user.id,
          title:       groupName || 'The Next 10',
          city_id:     cityRow?.id       ?? null,
          metro_id:    resolvedMetroId   ?? null,
          starts_at:   new Date().toISOString().split('T')[0],
          ends_at:     next10EndsAt,
          is_public:   false,
          is_official: false,
          cover_emoji: '🔟',
          invite_code: inviteCode,
        })
        .select('id, title, invite_code')
        .single()

      if (listError) throw listError

      // 4. Insert list_items using sort_order (matches CreateListScreen)
      const listItemRows = (listItems ?? []).map((cli, i) => ({
        list_id:    newList.id,
        item_id:    cli.item_id,
        sort_order: i,
      }))

      if (listItemRows.length) {
        const { error: insertError } = await supabase
          .from('list_items')
          .insert(listItemRows)
        if (insertError) throw insertError
      }

      // 5. Reset stack: Home → List, so back button goes Home and preview is gone
      navigation.dispatch(
        CommonActions.reset({
          index: 1,
          routes: [
            { name: 'Home' },
            { name: 'List', params: { listId: newList.id, title: newList.title } },
          ],
        })
      )
    } catch (e) {
      Alert.alert('Something went wrong', e.message || 'Please try again.')
    } finally {
      setJoining(false)
    }
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
      const defaultTitle = next10Mode
        ? groupName
        : `${groupName} · ${seasonLabel} ${year}`

      navigation.navigate('CreateList', {
        curatedListId:  selectedId,
        defaultTitle,
        groupEmoji:     groupEmoji ?? '🔟',
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

  // Secret item count (for "2 secret drops" display)
  const secretCount = previewItems.filter(li => li.items?.is_secret).length

  // Join button is only live once the list id is resolved and items have loaded
  const joinReady = !loadingPreview && !!selectedId && !fetchError

  // ── Error state (next10 deep-link path only) ──
  if (fetchError) {
    return (
      <View style={[styles.container, styles.errorContainer, { paddingTop: insets.top + 32 }]}>
        <StatusBar barStyle="dark-content" />
        <Text style={{ fontSize: 36, marginBottom: 16 }}>
          {fetchError === 'no_list' ? '🗓' : '⚠️'}
        </Text>
        <Text style={styles.errorText}>
          {fetchError === 'no_list'
            ? 'No active challenge right now — check back Friday.'
            : "Couldn't load this week's challenge."}
        </Text>
        {fetchError === 'fetch_failed' && (
          <TouchableOpacity onPress={fetchNext10Meta} style={styles.retryBtn}>
            <Text style={styles.retryBtnText}>Try again</Text>
          </TouchableOpacity>
        )}
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ ...styles.content, paddingTop: insets.top + 12 }}
        showsVerticalScrollIndicator={false}
      >
        <StatusBar barStyle="dark-content" />

        {/* ── next10 hero header ── */}
        {next10Mode ? (
          <View style={styles.next10HeroCard}>
            <Text style={styles.next10Label}>🔟  THE NEXT 10</Text>
            <Text style={styles.next10Title}>
              {groupName || 'The Next 10'}
            </Text>
            {!!groupTagline && (
              <Text style={styles.next10Tagline}>{groupTagline}</Text>
            )}
            {!loadingPreview && totalCount > 0 && (
              <View style={styles.next10MetaRow}>
                <Text style={styles.next10Meta}>
                  {totalCount} spots
                  {secretCount > 0 ? `  ·  ${secretCount} secret drop${secretCount > 1 ? 's' : ''}` : ''}
                  {'  ·  Drops Friday'}
                </Text>
              </View>
            )}
          </View>
        ) : (
          /* ── Standard hero header ── */
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
        )}

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
            {previewItems.map((li, index) => {
              const isSecret = li.items?.is_secret === true
              return (
                <View key={li.id} style={[styles.previewItem, isSecret && styles.previewItemSecret]}>
                  <View style={[
                    styles.previewNumber,
                    { backgroundColor: index < 3 ? SOFT : '#F4F0FB',
                      borderColor: index < 3 ? '#F0D29D' : '#CFC2F0' }
                  ]}>
                    <Text style={[
                      styles.previewNumberText,
                      { color: index < 3 ? '#A16A00' : '#5A3D99' }
                    ]}>
                      {li.display_order ?? index + 1}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    {isSecret ? (
                      <>
                        <Text style={styles.previewBody}>🔒  Secret Drop</Text>
                        <Text style={styles.previewCategory}>Reveals when you arrive</Text>
                      </>
                    ) : (
                      <>
                        <Text style={styles.previewBody}>{li.items?.body ?? ''}</Text>
                        {li.items?.categories?.name && (
                          <Text style={styles.previewCategory}>{li.items.categories.name}</Text>
                        )}
                      </>
                    )}
                  </View>
                  {!isSecret && li.items?.checkin_type === 'photo' && (
                    <Text style={styles.photoTag}>📷</Text>
                  )}
                  {!isSecret && li.items?.checkin_type === 'gps' && (
                    <Text style={styles.photoTag}>📍</Text>
                  )}
                </View>
              )
            })}

            {totalCount > 5 && (
              <View style={styles.moreCard}>
                <Text style={styles.moreText}>
                  + {totalCount - 5} more items waiting for you
                </Text>
              </View>
            )}
          </>
        )}

        {/* How it works */}
        <View style={styles.howItWorksCard}>
          <Text style={styles.howTitle}>How it works</Text>
          {next10Mode ? (
            <>
              <Text style={styles.howItem}>✓  Pick this week's list and start checking things off</Text>
              <Text style={styles.howItem}>✓  Hit 3 check-offs before Sunday to complete the challenge</Text>
              <Text style={styles.howItem}>✓  Secret drops unlock when your GPS puts you at the door</Text>
              <Text style={styles.howItem}>✓  New challenge drops every Friday</Text>
            </>
          ) : (
            <>
              <Text style={styles.howItem}>✓  We build your list from this template</Text>
              <Text style={styles.howItem}>✓  You own it — rename, add, or remove items</Text>
              <Text style={styles.howItem}>✓  Invite friends to join and compete</Text>
              <Text style={styles.howItem}>✓  Check things off as you go</Text>
            </>
          )}
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Sticky CTA button */}
      <View style={[styles.stickyFooter, { paddingBottom: insets.bottom + 12 }]}>
        {next10Mode ? (
          <TouchableOpacity
            style={[styles.adoptBtn, (!joinReady || joining) && styles.adoptBtnDisabled]}
            onPress={handleNext10Join}
            disabled={!joinReady || joining}
            activeOpacity={0.88}
          >
            {(loadingPreview || joining)
              ? <ActivityIndicator color={NAVY} size="small" />
              : <Text style={styles.adoptBtnText}>🔟  Join this week's challenge</Text>
            }
          </TouchableOpacity>
        ) : (
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
        )}
      </View>
    </View>
  )
}

function createCuratedStyles({ BG, CARD, TEXT, MUTED, BORDER, SOFT, AMBER, NAVY, GREEN, SUCCESS_BG, SUCCESS_BORDER }) {
 return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },

  // ── next10 header ──
  next10HeroCard: {
    backgroundColor: NAVY,
    borderRadius: 20,
    padding: 20,
    marginBottom: 24,
    borderLeftWidth: 3,
    borderLeftColor: AMBER,
  },
  next10Label: {
    color: AMBER,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  next10Title: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 28,
    marginBottom: 6,
  },
  next10Tagline: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 10,
  },
  next10MetaRow: {
    marginTop: 4,
  },
  next10Meta: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
  },

  // ── Standard header ──
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

  // ── Item preview ──
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
  previewItemSecret: {
    opacity: 0.55,
    borderStyle: 'dashed',
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

  // ── How it works ──
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

  // ── Footer adopt button ──
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

  // ── Error state ──
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  errorText: {
    fontSize: 16,
    fontWeight: '700',
    color: TEXT,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 24,
  },
  retryBtn: {
    backgroundColor: AMBER,
    borderRadius: 999,
    paddingHorizontal: 28,
    paddingVertical: 14,
  },
  retryBtnText: {
    fontSize: 15,
    fontWeight: '900',
    color: NAVY,
  },
 })
}
