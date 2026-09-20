// Lists Landing Redesign (2026-09-19) — a single list card for the Lists
// landing screen's "Your Lists" and "Joined lists" sections. Visually
// unifies what were two different pre-redesign treatments (a bordered
// listCard row for personal lists vs. a plainer officialRow for joined
// official lists) into one card family, matching the raised-surface /
// accent-bar language already established by Home's EditorialCard 'row'
// variant and Nearby's NearbyResultRow — while preserving every real
// behavior and data field the pre-redesign screen used.
//
// Cover image priority (see lib/listsSections.js's resolveListCover):
//   1. list.hero_image_url — a REAL per-list column already used by
//      ListScreen.jsx's own header (settable via the admin tool). If
//      present and hasn't already failed to load once, it's shown.
//   2. a code-native accent-color fallback panel (this app has no icon/
//      vector library — same reasoning as BookmarkIcon.jsx) showing the
//      list's cover_emoji when one exists, or just the accent color.
// Image failure follows the same "mark failed, never retry, fall back to
// the generic layer" technique ArchetypeArtwork.jsx/DetailArtwork.jsx use
// for item artwork — reimplemented locally here (not by importing those
// components directly) since they are item-artwork-specific per the task's
// own instruction not to conflate item- and list-level imagery.
//
// Overflow action: a real, explicit "More options" button is added
// alongside the pre-existing onLongPress (kept, unchanged, on the card
// itself) — long-press alone is not reliably discoverable via a screen
// reader, so this is an ADDITIVE accessibility improvement, not a new
// destructive gesture. Both paths call the exact same owner-vs-member
// handler the screen already passes in (deleteList/leaveList), so no new
// action or confirmation behavior is introduced — the existing Alert-based
// confirmation still gates every destructive outcome.

import React, { useState } from 'react'
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native'
import { accentForList, isFeaturedCreatorList, resolveListCover } from '../../lib/listsSections'

function CoverPanel({ list, accent, size = 52 }) {
  const [failed, setFailed] = useState(false)
  const { hasCover, url } = resolveListCover(list, failed)

  if (hasCover) {
    return (
      <Image
        source={{ uri: url }}
        style={[styles.cover, { width: size, height: size }]}
        resizeMode="cover"
        onError={() => setFailed(true)}
        accessibilityElementsHidden
        importantForAccessibility="no"
        accessibilityLabel=""
      />
    )
  }

  return (
    <View
      style={[styles.coverFallback, { width: size, height: size, backgroundColor: `${accent}22`, borderColor: `${accent}55` }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {list?.cover_emoji ? (
        <Text style={styles.coverEmoji}>{list.cover_emoji}</Text>
      ) : (
        <View style={[styles.coverDot, { backgroundColor: accent }]} />
      )}
    </View>
  )
}

export default function ListCollectionCard({
  list,
  official = false,
  timeLeftText,
  isUrgent = false,
  crewMembers = [],
  onPress,
  onLongPress,
  onMore,
  onAddCrew,
  colors,
}) {
  const { CARD_ELEVATED, TEXT, MUTED, BORDER, SOFT, AMBER } = colors
  const featured = !official && isFeaturedCreatorList(list)
  const accent = featured ? AMBER : accentForList(list)
  const metaText = timeLeftText || 'Open-ended'

  const a11yParts = [
    list.title,
    metaText,
    official ? 'Joined list' : null,
    featured ? `by ${list.creatorHandle}` : null,
  ].filter(Boolean)

  return (
    <TouchableOpacity
      style={[
        styles.card,
        { backgroundColor: CARD_ELEVATED, borderColor: BORDER },
        isUrgent && { borderColor: `${AMBER}80` },
        featured && { borderColor: `${AMBER}59` },
      ]}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.88}
      accessibilityRole="button"
      accessibilityLabel={a11yParts.join(', ')}
      accessibilityHint="Opens this list"
    >
      <CoverPanel list={list} accent={accent} />

      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: TEXT }]} numberOfLines={2}>{list.title}</Text>
        {featured ? (
          <Text style={[styles.creatorByline, { color: AMBER }]} numberOfLines={1}>by @{list.creatorHandle}</Text>
        ) : null}
        <View style={styles.metaRow}>
          <Text style={[styles.meta, { color: isUrgent ? AMBER : MUTED }, isUrgent && styles.metaUrgent]}>
            {metaText}
          </Text>
          {crewMembers.length > 0 && (
            <View style={styles.crewStack} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {crewMembers.map(m => (
                <View key={m.id} style={[styles.crewAvatar, { backgroundColor: SOFT, borderColor: '#F0D29D' }]}>
                  <Text style={styles.crewAvatarText}>{m.initial}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </View>

      <View style={styles.rightCol}>
        {!official && list.memberCount > 1 && (
          <TouchableOpacity
            style={[styles.addCrewBtn, { backgroundColor: SOFT, borderColor: '#E8C98E' }]}
            onPress={onAddCrew}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={`View crew for ${list.title}`}
          >
            <Text style={styles.addCrewBtnText}>+ Crew</Text>
          </TouchableOpacity>
        )}
        {!official && onMore ? (
          <TouchableOpacity
            style={styles.moreBtn}
            onPress={onMore}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={`More options for ${list.title}`}
          >
            <Text style={[styles.moreDots, { color: MUTED }]}>⋯</Text>
          </TouchableOpacity>
        ) : null}
        <Text style={[styles.chevron, { color: MUTED }]}>→</Text>
      </View>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
  },
  cover: {
    borderRadius: 13,
  },
  coverFallback: {
    borderRadius: 13,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverEmoji: { fontSize: 22 },
  coverDot: { width: 12, height: 12, borderRadius: 6 },

  title: { fontSize: 15, fontWeight: '800', flex: 1 },
  creatorByline: { fontSize: 11, fontWeight: '700', marginTop: 2 },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5, flexWrap: 'wrap' },
  meta: { fontSize: 12, fontWeight: '700' },
  metaUrgent: { fontWeight: '800' },

  crewStack: { flexDirection: 'row' },
  crewAvatar: {
    width: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, marginRight: -6,
  },
  crewAvatarText: { fontSize: 8, fontWeight: '800', color: '#A16A00' },

  rightCol: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  addCrewBtn: {
    borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, borderWidth: 1,
  },
  addCrewBtnText: { fontSize: 10, fontWeight: '800', color: '#A16A00' },
  moreBtn: { paddingHorizontal: 4, paddingVertical: 2 },
  moreDots: { fontSize: 16, fontWeight: '900' },
  chevron: { fontSize: 16, fontWeight: '800' },
})
