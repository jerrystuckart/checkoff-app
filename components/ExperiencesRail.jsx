import React, { useState, useEffect, useCallback } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, Linking, ImageBackground } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { useNavigation } from '@react-navigation/native'
import { supabase } from '../lib/supabase'
import { useTheme } from '../lib/ThemeContext'

const NAVY  = '#0F0F1E'
const AMBER = '#F5A623'
const WHITE = '#FFFFFF'
const MUTED = 'rgba(255,255,255,0.5)'

const TEAL   = '#1D9E75'
const BLUE   = '#378ADD'

// Gradient colors for the top bar, derived from deep_link slug
const GRADIENT_MAP = {
  'willcox-wine-trail':   ['#F5A623', '#7A2E2E'],
  'bachelorette':         ['#E0588F', '#F5A623'],
  'phoenix-hidden-gems':  ['#378ADD', '#1D9E75', '#F5A623'],
  'west-valley-best':     ['#1D9E75', '#F5A623'],
  'date-night':           ['#7A4DB3', '#F5A623'],
  'sedona-day-trip':      ['#D85A30', '#F5A623'],
  fallback:               ['#378ADD', '#1D9E75', '#F5A623'],
}

const DISTANCE_COLORS = {
  'local':     TEAL,
  'day-trip':  AMBER,
  'weekend':   BLUE,
}

function getGradientColors(deepLink) {
  if (!deepLink) return GRADIENT_MAP.fallback
  // deep_link looks like "checkoff://list/willcox-wine-trail" or similar — find a matching key
  const match = Object.keys(GRADIENT_MAP).find(key => key !== 'fallback' && deepLink.includes(key))
  return match ? GRADIENT_MAP[match] : GRADIENT_MAP.fallback
}

export default function ExperiencesRail({ citySlug }) {
  const navigation = useNavigation()
  const { colors } = useTheme()
  const [experiences, setExperiences] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        // Include experiences scoped to this metro OR universal (no metro_slug set)
        let query = supabase
          .from('featured_experiences')
          .select('*')
          .eq('active', true)
          .order('display_order', { ascending: true })
          .limit(20)

        if (citySlug) {
          query = query.or(`metro_slug.eq.${citySlug},metro_slug.is.null`)
        }

        const { data, error } = await query

        if (cancelled) return

        if (error || !data || data.length === 0) {
          setExperiences([])
        } else {
          setExperiences(data)
        }
      } catch (e) {
        if (!cancelled) setExperiences([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [citySlug])

  const handlePress = useCallback((item) => {
    const deepLink = item.deep_link
    const imageUrl = item.image_url

    // ── Priority 1: list_id set on the row → navigate directly ──────────────
    if (item.list_id) {
      navigation.navigate('CuratedListPreview', {
        curatedListId: item.list_id,
        groupImageUrl: imageUrl ?? undefined,
        citySlug:      item.metro_slug ?? undefined,
      })
      return
    }

    if (!deepLink) return

    // ── Priority 2: checkoff://list?id= slug-based deep link ─────────────────
    if (deepLink.includes('list?id=')) {
      try {
        const url = new URL(deepLink.replace('checkoff://', 'https://x.com/'))
        const listId = url.searchParams.get('id')
        const city   = url.searchParams.get('city')
        navigation.navigate('DeepLinkListResolver', {
          id:        listId,
          city:      city ?? null,
          heroImage: imageUrl ?? null,
        })
      } catch {
        Linking.openURL(deepLink).catch(() => {})
      }
      return
    }

    // ── Priority 3: experience?tag= → resolver screen ────────────────────────
    if (deepLink.includes('experience?tag=')) {
      try {
        const url = new URL(deepLink.replace('checkoff://', 'https://x.com/'))
        const tag = url.searchParams.get('tag')
        navigation.navigate('DeepLinkExperienceResolver', {
          tag:       tag ?? null,
          heroImage: imageUrl ?? null,
        })
      } catch {
        Linking.openURL(deepLink).catch(() => {})
      }
      return
    }

    // ── Fallback: unknown deep link scheme ────────────────────────────────────
    Linking.openURL(deepLink).catch(() => {})
  }, [navigation])

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="small" color={AMBER} />
      </View>
    )
  }

  if (!experiences.length) return null

  return (
    <View style={styles.section}>
      <Text style={[styles.title, { color: colors.TEXT }]}>Plan something worth the drive</Text>
      <Text style={[styles.subtitle, { color: colors.MUTED }]}>Curated day trips &amp; local experiences</Text>

      <FlatList
        horizontal
        data={experiences}
        keyExtractor={(item) => String(item.id)}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <ExperienceCard item={item} onPress={handlePress} colors={colors} />
        )}
      />
    </View>
  )
}

function ExperienceCard({ item, onPress, colors }) {
  const vibe = Array.isArray(item.vibes) && item.vibes.length > 0 ? item.vibes[0] : null
  const distanceColor = DISTANCE_COLORS[item.distance_type] ?? AMBER
  const gradientColors = getGradientColors(item.deep_link)
  const hasImage = !!item.image_url

  const cardContent = (
    <>
      {hasImage ? (
        <LinearGradient
          colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.78)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.cardImageOverlay}
        />
      ) : (
        <LinearGradient
          colors={gradientColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.gradientBar}
        />
      )}

      <View style={[styles.cardBody, hasImage && styles.cardBodyOnImage]}>
        <View style={styles.pillRow}>
          {!!vibe && (
            <View style={styles.vibePill}>
              <Text style={styles.vibePillText}>{vibe}</Text>
            </View>
          )}
          {!!item.distance_label && (
            <View style={[styles.distancePill, { backgroundColor: `${distanceColor}22`, borderColor: `${distanceColor}55` }]}>
              <Text style={[styles.distancePillText, { color: distanceColor }]}>{item.distance_label}</Text>
            </View>
          )}
        </View>

        <Text style={[styles.cardTitle, !hasImage && { color: colors?.TEXT ?? WHITE }]} numberOfLines={2}>{item.title}</Text>
        {!!item.subtitle && (
          <Text style={[styles.cardSubtitle, !hasImage && { color: colors?.MUTED ?? MUTED }]} numberOfLines={2}>{item.subtitle}</Text>
        )}

        <View style={styles.cardFooter}>
          <Text style={[styles.cardCity, !hasImage && { color: colors?.MUTED ?? MUTED }]} numberOfLines={1}>{item.city ?? ''}</Text>
          <Text style={styles.cardOpen}>Open →</Text>
        </View>
      </View>
    </>
  )

  const cardBg = colors?.CARD ?? NAVY

  if (hasImage) {
    return (
      <TouchableOpacity
        style={[styles.card, { backgroundColor: cardBg }]}
        activeOpacity={0.88}
        onPress={() => onPress(item)}
      >
        <ImageBackground
          source={{ uri: item.image_url }}
          style={styles.cardImageBg}
          imageStyle={{ borderRadius: 16 }}
        >
          {cardContent}
        </ImageBackground>
      </TouchableOpacity>
    )
  }

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: cardBg }]}
      activeOpacity={0.88}
      onPress={() => onPress(item)}
    >
      {cardContent}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  loadingWrap: {
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },

  section: {
    marginBottom: 14,
  },

  title: {
    fontSize: 18,
    fontWeight: '800',
    color: WHITE,
    marginBottom: 2,
  },

  subtitle: {
    fontSize: 13,
    color: MUTED,
    marginBottom: 12,
  },

  listContent: {
    paddingRight: 20,
  },

  card: {
    width: 240,
    marginRight: 12,
    backgroundColor: NAVY,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },

  gradientBar: {
    height: 4,
    width: '100%',
  },

  cardImageBg: {
    width: '100%',
    minHeight: 180,
    justifyContent: 'flex-end',
  },

  cardImageOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 16,
  },

  cardBody: {
    padding: 14,
  },

  cardBodyOnImage: {
    paddingTop: 60,
  },

  pillRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 10,
  },

  vibePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(245,166,35,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.4)',
  },

  vibePillText: {
    fontSize: 11,
    fontWeight: '700',
    color: AMBER,
  },

  distancePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },

  distancePillText: {
    fontSize: 11,
    fontWeight: '700',
  },

  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: WHITE,
    marginBottom: 4,
  },

  cardSubtitle: {
    fontSize: 12.5,
    lineHeight: 17,
    color: MUTED,
    marginBottom: 12,
  },

  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  cardCity: {
    fontSize: 12,
    fontWeight: '600',
    color: MUTED,
    flexShrink: 1,
    marginRight: 8,
  },

  cardOpen: {
    fontSize: 12,
    fontWeight: '800',
    color: AMBER,
  },
})
