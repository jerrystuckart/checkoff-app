import React, { useState, useEffect, useMemo } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, ImageBackground, Linking,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { supabase } from '../lib/supabase'
import { useTheme } from '../lib/ThemeContext'

const AMBER = '#F5A623'

const DISTANCE_COLORS = {
  'local':    '#1D9E75',
  'day-trip': '#F5A623',
  'weekend':  '#378ADD',
}

export default function LocalGuidesScreen({ navigation, route }) {
  const { metro } = route.params ?? {}
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const { BG, CARD, TEXT, MUTED, BORDER } = colors
  const styles = useMemo(() => createStyles({ BG, CARD, TEXT, MUTED, BORDER }),
    [BG, CARD, TEXT, MUTED, BORDER])

  const [guides, setGuides] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    load()
  }, [metro?.slug])

  async function load() {
    setLoading(true)
    try {
      let query = supabase
        .from('featured_experiences')
        .select('id, title, subtitle, image_url, city, distance_type, distance_label, vibes, deep_link, list_id, metro_slug')
        .eq('active', true)
        .eq('distance_type', 'local')
        .order('display_order', { ascending: true })

      if (metro?.slug) {
        query = query.or(`metro_slug.eq.${metro.slug},metro_slug.is.null`)
      }

      const { data } = await query
      setGuides(data ?? [])
    } catch (e) {
      // silent
    } finally {
      setLoading(false)
    }
  }

  function handlePress(item) {
    const imageUrl = item.image_url

    if (item.list_id) {
      navigation.navigate('CuratedListPreview', {
        curatedListId: item.list_id,
        groupImageUrl: imageUrl ?? undefined,
        citySlug:      item.metro_slug ?? undefined,
        userCitySlug:  metro?.slug ?? undefined,
      })
      return
    }

    const deepLink = item.deep_link
    if (!deepLink) return

    if (deepLink.includes('list?id=')) {
      try {
        const url    = new URL(deepLink.replace('checkoff://', 'https://x.com/'))
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

    Linking.openURL(deepLink).catch(() => {})
  }

  const metroLabel = metro?.name?.replace(' Metro', '') ?? 'Local'

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Explore {metroLabel}</Text>
        <Text style={styles.subtitle}>Curated guides from around the city</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={AMBER} style={{ marginTop: 40 }} />
      ) : guides.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>🏙️</Text>
          <Text style={styles.emptyTitle}>No guides yet</Text>
          <Text style={styles.emptySub}>We're building local guides for {metroLabel}. Check back soon.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        >
          {guides.map(item => (
            <GuideCard
              key={item.id}
              item={item}
              onPress={handlePress}
              styles={styles}
              colors={colors}
            />
          ))}
          <View style={{ height: 20 }} />
        </ScrollView>
      )}
    </View>
  )
}

function GuideCard({ item, onPress, styles, colors }) {
  const distanceColor = DISTANCE_COLORS[item.distance_type] ?? AMBER
  const vibe = Array.isArray(item.vibes) && item.vibes.length > 0 ? item.vibes[0] : null

  const cardInner = (
    <View style={styles.cardBody}>
      <View style={styles.cardPillRow}>
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

      <Text style={[styles.cardTitle, !item.image_url && { color: colors?.TEXT ?? '#FFFFFF' }]} numberOfLines={2}>
        {item.title}
      </Text>
      {!!item.subtitle && (
        <Text style={[styles.cardSubtitle, !item.image_url && { color: colors?.MUTED ?? 'rgba(255,255,255,0.85)' }]} numberOfLines={2}>
          {item.subtitle}
        </Text>
      )}

      <View style={styles.cardFooter}>
        <Text style={[styles.cardCity, !item.image_url && { color: colors?.MUTED ?? 'rgba(255,255,255,0.7)' }]}>
          {item.city ?? ''}
        </Text>
        <Text style={styles.cardCTA}>Open →</Text>
      </View>
    </View>
  )

  if (item.image_url) {
    return (
      <TouchableOpacity style={styles.card} activeOpacity={0.88} onPress={() => onPress(item)}>
        <ImageBackground
          source={{ uri: item.image_url }}
          style={styles.cardImageBg}
          imageStyle={{ borderRadius: 18 }}
          resizeMode="cover"
        >
          <LinearGradient
            colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.78)']}
            start={{ x: 0, y: 0.3 }}
            end={{ x: 0, y: 1 }}
            style={styles.cardGradientOverlay}
          />
          {cardInner}
        </ImageBackground>
      </TouchableOpacity>
    )
  }

  return (
    <TouchableOpacity style={[styles.card, styles.cardNoImage]} activeOpacity={0.88} onPress={() => onPress(item)}>
      {cardInner}
    </TouchableOpacity>
  )
}

function createStyles({ BG, CARD, TEXT, MUTED, BORDER }) {
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
      padding: 16,
      gap: 14,
    },
    card: {
      borderRadius: 18,
      overflow: 'hidden',
    },
    cardNoImage: {
      backgroundColor: CARD,
      borderWidth: 1,
      borderColor: BORDER,
    },
    cardImageBg: {
      width: '100%',
      minHeight: 200,
      justifyContent: 'flex-end',
    },
    cardGradientOverlay: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: 18,
    },
    cardBody: {
      padding: 16,
      gap: 6,
    },
    cardPillRow: {
      flexDirection: 'row',
      gap: 6,
      flexWrap: 'wrap',
    },
    vibePill: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      backgroundColor: 'rgba(255,255,255,0.18)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.3)',
    },
    vibePillText: {
      fontSize: 10,
      fontWeight: '700',
      color: '#FFFFFF',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    distancePill: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      borderWidth: 1,
    },
    distancePillText: {
      fontSize: 10,
      fontWeight: '700',
    },
    cardTitle: {
      fontSize: 20,
      fontWeight: '800',
      color: '#FFFFFF',
      lineHeight: 26,
      textShadowColor: 'rgba(0,0,0,0.6)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 4,
    },
    cardSubtitle: {
      fontSize: 13,
      color: 'rgba(255,255,255,0.85)',
      lineHeight: 18,
      textShadowColor: 'rgba(0,0,0,0.5)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 3,
    },
    cardFooter: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: 4,
    },
    cardCity: {
      fontSize: 12,
      color: 'rgba(255,255,255,0.7)',
      fontWeight: '600',
    },
    cardCTA: {
      fontSize: 13,
      color: AMBER,
      fontWeight: '800',
    },
    empty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 40,
      gap: 10,
    },
    emptyEmoji: {
      fontSize: 40,
    },
    emptyTitle: {
      fontSize: 17,
      fontWeight: '800',
      color: TEXT,
    },
    emptySub: {
      fontSize: 14,
      color: MUTED,
      textAlign: 'center',
      lineHeight: 20,
    },
  })
}
