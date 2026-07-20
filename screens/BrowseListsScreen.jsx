import React, { useState, useMemo, useEffect } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, StatusBar, ActivityIndicator, ImageBackground,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { fetchCuratedLists } from '../lib/useItems'
import { useTheme } from '../lib/ThemeContext'

const AMBER  = '#F5A623'
const NAVY   = '#1A1A2E'

// Maps season tag → display label and color
const SEASON_META = {
  summer: { label: 'Summer',  bg: '#FFF1DB', text: '#A16A00', border: '#E8C98E' },
  fall:   { label: 'Fall',    bg: '#FDF0E6', text: '#8B4A0E', border: '#EAC49A' },
  winter: { label: 'Winter',  bg: '#EAF4FB', text: '#1A5F85', border: '#B0D9F0' },
  spring: { label: 'Spring',  bg: '#EAF8F2', text: '#1D6A50', border: '#BFE7D7' },
  anytime:{ label: 'Anytime', bg: '#F4F0FB', text: '#5A3D99', border: '#CFC2F0' },
}

export default function BrowseListsScreen({ navigation, route }) {
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const { BG, CARD, TEXT, MUTED, BORDER, SOFT, AMBER, NAVY } = colors
  const styles = useMemo(() => createBrowseStyles({ BG, CARD, TEXT, MUTED, BORDER, SOFT, AMBER, NAVY }),
    [BG, CARD, TEXT, MUTED, BORDER, SOFT, AMBER, NAVY])
  const citySlug  = route.params?.citySlug  ?? 'phoenix'
  const metroName = route.params?.metroName ?? 'Phoenix'

  const [lists, setLists]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    load()
  }, [citySlug])

  async function load() {
    setLoading(true)
    setError(null)
    const { data, error: err } = await fetchCuratedLists(citySlug)
    if (err) setError(err)
    else setLists(data)
    setLoading(false)
  }

  // Group lists by audience_group so we show one card per group
  // (a group can have summer + fall variants — show both under the group)
  const grouped = lists.reduce((acc, item) => {
    const gid = item.audience_groups?.id
    if (!gid) return acc
    if (!acc[gid]) {
      acc[gid] = { group: item.audience_groups, variants: [] }
    }
    acc[gid].variants.push(item)
    return acc
  }, {})

  const groupList = Object.values(grouped)

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={AMBER} size="large" />
      </View>
    )
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Could not load templates</Text>
        <TouchableOpacity onPress={load} style={styles.retryBtn}>
          <Text style={styles.retryText}>Try again</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ ...styles.content, paddingTop: insets.top + 12 }}
      showsVerticalScrollIndicator={false}
    >
      <StatusBar barStyle="dark-content" />

      <View style={styles.headerBlock}>
        <Text style={styles.headerEyebrow}>{metroName}</Text>
        <Text style={styles.headerTitle}>Who are you?</Text>
        <Text style={styles.headerSub}>
          Pick a crew that sounds like you. We've built a list for that.
        </Text>
      </View>

      {groupList.map(({ group, variants }) => {
        const hasImage = !!group.image_url
        const navParams = {
          curatedListId: variants[0].id,
          groupName:     group.name,
          groupEmoji:    group.emoji,
          groupTagline:  group.tagline,
          groupImageUrl: group.image_url ?? undefined,
          citySlug,
          metroName,
          userCitySlug: citySlug,   // this screen's citySlug is the viewer's own metro
        }
        const cardInner = (
          <>
            {/* City-specific badge */}
            {group.city_slug && (
              <View style={styles.cityBadge}>
                <Text style={styles.cityBadgeText}>{metroName} only</Text>
              </View>
            )}

            <View style={styles.groupCardTop}>
              <View style={[styles.emojiCircle, hasImage && styles.emojiCircleOnImg]}>
                <Text style={styles.emojiText}>{group.emoji ?? '📋'}</Text>
              </View>

              <View style={{ flex: 1 }}>
                <Text style={[styles.groupName, hasImage && styles.groupNameOnImg]}>{group.name}</Text>
                <Text style={[styles.groupTagline, hasImage && styles.groupTaglineOnImg]} numberOfLines={2}>
                  "{group.tagline}"
                </Text>
              </View>

              <Text style={[styles.chevron, hasImage && { color: '#FFFFFF' }]}>→</Text>
            </View>

            {/* Season variant pills */}
            {variants.length > 0 && (
              <View style={styles.variantRow}>
                {variants.map(v => {
                  const s = SEASON_META[v.season] ?? SEASON_META.anytime
                  return (
                    <View
                      key={v.id}
                      style={[styles.variantPill, { backgroundColor: s.bg, borderColor: s.border }]}
                    >
                      <Text style={[styles.variantPillText, { color: s.text }]}>
                        {s.label}{v.year ? ` ${v.year}` : ''}
                      </Text>
                    </View>
                  )
                })}
              </View>
            )}
          </>
        )

        if (hasImage) {
          return (
            <TouchableOpacity
              key={group.id}
              style={styles.groupCard}
              activeOpacity={0.88}
              onPress={() => navigation.navigate('CuratedListPreview',
                variants.length > 1 ? { ...navParams, variants } : navParams
              )}
            >
              <ImageBackground
                source={{ uri: group.image_url }}
                style={styles.groupCardImageBg}
                imageStyle={{ borderRadius: 18 }}
                resizeMode="cover"
              >
                <View style={styles.groupCardImageOverlay} />
                {cardInner}
              </ImageBackground>
            </TouchableOpacity>
          )
        }

        return (
          <TouchableOpacity
            key={group.id}
            style={styles.groupCard}
            activeOpacity={0.88}
            onPress={() => navigation.navigate('CuratedListPreview',
              variants.length > 1 ? { ...navParams, variants } : navParams
            )}
          >
            {cardInner}
          </TouchableOpacity>
        )
      })}

      {groupList.length === 0 && (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No templates yet for {metroName}</Text>
          <Text style={styles.emptySub}>
            We're building lists for this city. Check back soon.
          </Text>
        </View>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  )
}

function createBrowseStyles({ BG, CARD, TEXT, MUTED, BORDER, SOFT, AMBER, NAVY }) {
 return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BG,
    gap: 12,
  },
  errorText: {
    fontSize: 15,
    color: MUTED,
    fontWeight: '700',
  },
  retryBtn: {
    backgroundColor: SOFT,
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#E8C98E',
  },
  retryText: {
    fontSize: 14,
    color: '#A16A00',
    fontWeight: '800',
  },
  headerBlock: {
    marginBottom: 24,
  },
  headerEyebrow: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.4,
    color: MUTED,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  headerTitle: {
    fontSize: 30,
    fontWeight: '900',
    color: TEXT,
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  headerSub: {
    fontSize: 15,
    color: MUTED,
    lineHeight: 22,
  },
  groupCard: {
    backgroundColor: CARD,
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1.2,
    borderColor: BORDER,
    overflow: 'hidden',
  },

  groupCardImageBg: {
    margin: -16,
    padding: 16,
    borderRadius: 20,
    minHeight: 120,
    justifyContent: 'center',
  },

  groupCardImageOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.58)',
    borderRadius: 18,
  },

  emojiCircleOnImg: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderColor: 'rgba(255,255,255,0.3)',
  },

  groupNameOnImg: {
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },

  groupTaglineOnImg: {
    color: 'rgba(255,255,255,0.85)',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  cityBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#E8F0FE',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#C5D8FC',
  },
  cityBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#2A5BC4',
  },
  groupCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  emojiCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: SOFT,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#F0D29D',
  },
  emojiText: {
    fontSize: 26,
  },
  groupName: {
    fontSize: 16,
    fontWeight: '800',
    color: TEXT,
    marginBottom: 4,
  },
  groupTagline: {
    fontSize: 13,
    color: MUTED,
    fontStyle: 'italic',
    lineHeight: 18,
  },
  chevron: {
    fontSize: 18,
    color: MUTED,
    fontWeight: '700',
  },
  variantRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 0.5,
    borderTopColor: BORDER,
  },
  variantPill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
  },
  variantPillText: {
    fontSize: 12,
    fontWeight: '800',
  },
  emptyCard: {
    backgroundColor: CARD,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: BORDER,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: TEXT,
    marginBottom: 8,
  },
  emptySub: {
    fontSize: 14,
    color: MUTED,
    lineHeight: 20,
  },
 })
}
