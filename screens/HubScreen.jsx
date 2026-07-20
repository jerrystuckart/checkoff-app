import React, { useState, useEffect, useMemo } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, Image, ImageBackground,
  StyleSheet, ActivityIndicator, Linking, Alert,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { supabase } from '../lib/supabase'
import { adoptDestinationList } from '../lib/useItems'
import { useTheme } from '../lib/ThemeContext'

const AMBER = '#F5A623'

// "Oct 17–18" for a range, "Oct 17" for a single day, null if unset.
// event_ends_at alone with no event_starts_at renders nothing — a
// range needs a start.
function formatSpotlightDateRange(startsAt, endsAt) {
  if (!startsAt) return null
  const start = new Date(`${startsAt}T12:00:00`)
  const startLabel = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  if (!endsAt || endsAt === startsAt) return startLabel
  const end = new Date(`${endsAt}T12:00:00`)
  const endLabel = start.getMonth() === end.getMonth()
    ? end.toLocaleDateString('en-US', { day: 'numeric' })
    : end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${startLabel}–${endLabel}`
}

export default function HubScreen({ navigation, route }) {
  const { destinationId } = route.params ?? {}
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const { BG, CARD, TEXT, MUTED, BORDER } = colors
  const styles = useMemo(() => createStyles({ BG, CARD, TEXT, MUTED, BORDER }),
    [BG, CARD, TEXT, MUTED, BORDER])

  const [destination, setDestination] = useState(null)
  const [partnerNames, setPartnerNames] = useState({})
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [joiningDestListId, setJoiningDestListId] = useState(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data?.user ?? null))
  }, [])

  useEffect(() => {
    load()
  }, [destinationId]) // eslint-disable-line

  async function load() {
    if (!destinationId) { setLoading(false); return }
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('destinations')
        .select('*, destination_spotlights(*), destination_lists(*, lists!destination_lists_list_id_fkey(id,title))')
        .eq('id', destinationId)
        .maybeSingle()

      if (error) throw error
      setDestination(data)

      // Partner credit lines need org_name — destination_partners itself is
      // locked to service_role, so this reads destination_partners_public
      // instead (id, org_name, active-contract partners only). Scoped to
      // just the partner ids actually opted in via show_partner_credit.
      const partnerIds = new Set()
      ;(data?.destination_spotlights ?? []).forEach(s => {
        if (s.show_partner_credit && s.owner_partner_id) partnerIds.add(s.owner_partner_id)
      })
      ;(data?.destination_lists ?? []).forEach(dl => {
        if (dl.show_partner_credit && dl.owner_partner_id) partnerIds.add(dl.owner_partner_id)
      })

      if (partnerIds.size) {
        const { data: partners } = await supabase
          .from('destination_partners_public')
          .select('id, org_name')
          .in('id', Array.from(partnerIds))
        setPartnerNames(Object.fromEntries((partners ?? []).map(p => [p.id, p.org_name])))
      } else {
        setPartnerNames({})
      }
    } catch (e) {
      setDestination(null)
    } finally {
      setLoading(false)
    }
  }

  async function handleListTap(destListId, sourceListId) {
    if (!user) {
      Alert.alert(
        'Sign in first',
        'You need an account to join this list.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sign in', onPress: () => navigation.navigate('SignIn') },
        ]
      )
      return
    }

    if (joiningDestListId) return // guard against double-taps while a copy is being created

    setJoiningDestListId(destListId)
    try {
      // Personal-copy model — replaces the old shared-list list_members
      // upsert. Re-visit detection: reuse an existing copy from this
      // destination's list if the user already has one that hasn't
      // expired (ends_at still in the future). "Expired" here means
      // last season's copy — a fresh one gets created for a new season.
      const today = new Date().toISOString().slice(0, 10)
      const { data: existing } = await supabase
        .from('lists')
        .select('id')
        .eq('source_destination_list_id', destListId)
        .eq('creator_id', user.id)
        .gt('ends_at', today)
        .order('created_at', { ascending: false })
        .limit(1)

      if (existing?.[0]?.id) {
        navigation.push('List', { listId: existing[0].id })
        return
      }

      // First visit (or last season's copy expired) — create a fresh
      // personal list, auto-named/dated, items bulk-copied in.
      const { listId: newListId, error } = await adoptDestinationList({
        destinationListId: destListId,
        sourceListId,
        userId: user.id,
      })

      if (error || !newListId) {
        Alert.alert('Something went wrong', error ?? 'Please try again.')
        return
      }

      navigation.push('List', { listId: newListId })
    } finally {
      setJoiningDestListId(null)
    }
  }

  function handleSpotlightTap(spotlight) {
    if (spotlight.external_url) {
      Linking.openURL(spotlight.external_url).catch(() => {})
    }
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.centerFill, { paddingTop: insets.top }]}>
        <ActivityIndicator color={AMBER} />
      </View>
    )
  }

  if (!destination) {
    return (
      <View style={[styles.container, styles.centerFill, { paddingTop: insets.top }]}>
        <Text style={styles.emptyTitle}>Not found</Text>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginTop: 12 }}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
      </View>
    )
  }

  const spotlights = (destination.destination_spotlights ?? []).slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  const lists = (destination.destination_lists ?? []).slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        {/* Hero */}
        <View style={styles.heroWrap}>
          {destination.hero_image_url ? (
            <Image source={{ uri: destination.hero_image_url }} style={styles.heroImage} resizeMode="cover" />
          ) : (
            <View style={[styles.heroImage, styles.heroFallback]} />
          )}
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            activeOpacity={0.8}
            style={[styles.backBtn, { top: insets.top + 10 }]}
          >
            <Text style={styles.backBtnText}>← Back</Text>
          </TouchableOpacity>
        </View>

        {/* Name / description */}
        <View style={styles.headerBlock}>
          <Text style={styles.destName}>{destination.name}</Text>
          {!!destination.description && (
            <Text style={styles.destDescription}>{destination.description}</Text>
          )}
        </View>

        {/* Spotlights — RLS already filters to active/visible rows, so an
            empty array here means genuinely nothing to show. No placeholder.
            Full-width banner cards, stacked (not a horizontal carousel) —
            these are meant to pop, not compete for space in a small tile. */}
        {spotlights.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>✨ Spotlight</Text>
            {spotlights.map(s => (
              <SpotlightCard
                key={s.id}
                spotlight={s}
                partnerName={s.show_partner_credit && s.owner_partner_id ? partnerNames[s.owner_partner_id] : null}
                onPress={() => handleSpotlightTap(s)}
                styles={styles}
                colors={colors}
              />
            ))}
          </View>
        )}

        {/* Lists */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🗂 Lists</Text>
          {lists.length === 0 ? (
            <Text style={styles.emptySub}>Nothing here yet — check back soon.</Text>
          ) : (
            lists.map(dl => (
              <ListCard
                key={dl.id}
                destList={dl}
                partnerName={dl.show_partner_credit && dl.owner_partner_id ? partnerNames[dl.owner_partner_id] : null}
                joining={joiningDestListId === dl.id}
                onPress={() => handleListTap(dl.id, dl.list_id)}
                styles={styles}
              />
            ))
          )}
        </View>
      </ScrollView>
    </View>
  )
}

function SpotlightCard({ spotlight, partnerName, onPress, styles, colors }) {
  const tappable = !!spotlight.external_url
  const hasImage = !!spotlight.image_url
  const dateLabel = formatSpotlightDateRange(spotlight.event_starts_at, spotlight.event_ends_at)

  const cardInner = (
    <View style={[styles.spotlightBody, hasImage && styles.spotlightBodyOnImage]}>
      <View style={styles.spotlightBadgeRow}>
        <View style={styles.spotlightBadge}>
          <Text style={styles.spotlightBadgeText}>FEATURED</Text>
        </View>
        {!!dateLabel && (
          <Text
            style={[styles.spotlightDateText, !hasImage && { color: colors?.TEXT }]}
            numberOfLines={1}
          >
            {dateLabel}
          </Text>
        )}
      </View>
      <Text
        style={[styles.spotlightTitle, !hasImage && { color: colors?.TEXT }]}
        numberOfLines={2}
      >
        {spotlight.title}
      </Text>
      {!!spotlight.subtitle && (
        <Text
          style={[styles.spotlightSubtitle, !hasImage && { color: colors?.MUTED }]}
          numberOfLines={3}
        >
          {spotlight.subtitle}
        </Text>
      )}
      {!!partnerName && (
        <Text style={styles.creditText}>Presented by {partnerName}</Text>
      )}
    </View>
  )

  return (
    <TouchableOpacity
      style={styles.spotlightCard}
      activeOpacity={tappable ? 0.88 : 1}
      onPress={tappable ? onPress : undefined}
      disabled={!tappable}
    >
      {hasImage ? (
        <ImageBackground source={{ uri: spotlight.image_url }} style={styles.spotlightImageBg} resizeMode="cover">
          <LinearGradient
            colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.2)', 'rgba(0,0,0,0.88)']}
            locations={[0, 0.45, 1]}
            style={StyleSheet.absoluteFillObject}
          />
          {cardInner}
        </ImageBackground>
      ) : (
        <View style={styles.spotlightNoImage}>
          {cardInner}
        </View>
      )}
    </TouchableOpacity>
  )
}

function ListCard({ destList, partnerName, joining, onPress, styles }) {
  return (
    <TouchableOpacity style={styles.listCard} activeOpacity={0.88} onPress={onPress} disabled={joining}>
      <View style={{ flex: 1 }}>
        <Text style={styles.listCardTitle} numberOfLines={2}>{destList.lists?.title ?? 'Untitled list'}</Text>
        {!!partnerName && (
          <Text style={styles.creditText}>Presented by {partnerName}</Text>
        )}
      </View>
      {joining
        ? <ActivityIndicator size="small" color={AMBER} />
        : <Text style={styles.listCardCTA}>Open →</Text>
      }
    </TouchableOpacity>
  )
}

function createStyles({ BG, CARD, TEXT, MUTED, BORDER }) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: BG },
    centerFill: { alignItems: 'center', justifyContent: 'center' },
    heroWrap: { width: '100%', height: 240, backgroundColor: CARD },
    heroImage: { width: '100%', height: '100%' },
    heroFallback: { backgroundColor: CARD },
    backBtn: {
      position: 'absolute',
      left: 16,
      backgroundColor: 'rgba(0,0,0,0.45)',
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 999,
    },
    backBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
    headerBlock: { padding: 20, paddingBottom: 8 },
    destName: { fontSize: 24, fontWeight: '800', color: TEXT },
    destDescription: { fontSize: 14, color: MUTED, marginTop: 6, lineHeight: 20 },
    section: { paddingHorizontal: 20, paddingTop: 20 },
    sectionTitle: { fontSize: 16, fontWeight: '800', color: TEXT, marginBottom: 12 },
    spotlightCard: {
      width: '100%',
      borderRadius: 20,
      overflow: 'hidden',
      marginBottom: 14,
    },
    spotlightImageBg: {
      width: '100%',
      minHeight: 260,
      justifyContent: 'flex-end',
    },
    spotlightNoImage: {
      width: '100%',
      backgroundColor: CARD,
      borderWidth: 1,
      borderColor: BORDER,
      borderRadius: 20,
    },
    spotlightBody: { padding: 18, gap: 5 },
    spotlightBodyOnImage: { paddingTop: 44 },
    spotlightBadgeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    spotlightBadge: {
      alignSelf: 'flex-start',
      backgroundColor: AMBER,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
    },
    spotlightDateText: {
      fontSize: 13,
      fontWeight: '800',
      color: '#FFFFFF',
      letterSpacing: 0.3,
      textShadowColor: 'rgba(0,0,0,0.5)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 3,
      marginLeft: 10,
    },
    spotlightBadgeText: {
      fontSize: 10,
      fontWeight: '800',
      color: '#1A1A2E',
      letterSpacing: 0.6,
    },
    spotlightTitle: {
      fontSize: 24,
      fontWeight: '800',
      color: '#FFFFFF',
      lineHeight: 29,
      textShadowColor: 'rgba(0,0,0,0.5)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 4,
    },
    spotlightSubtitle: {
      fontSize: 14,
      lineHeight: 20,
      color: 'rgba(255,255,255,0.92)',
      textShadowColor: 'rgba(0,0,0,0.4)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 3,
    },
    creditText: { fontSize: 11, color: AMBER, fontWeight: '700', marginTop: 6 },
    listCard: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: CARD,
      borderWidth: 1,
      borderColor: BORDER,
      borderRadius: 14,
      padding: 16,
      marginBottom: 10,
    },
    listCardTitle: { fontSize: 15, fontWeight: '800', color: TEXT },
    listCardCTA: { fontSize: 13, fontWeight: '800', color: AMBER, marginLeft: 12 },
    emptySub: { fontSize: 13, color: MUTED },
    emptyTitle: { fontSize: 16, fontWeight: '800', color: TEXT },
    backText: { fontSize: 14, color: AMBER, fontWeight: '700' },
  })
}
