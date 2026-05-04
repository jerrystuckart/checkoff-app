import React, { useState, useRef } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Dimensions,
  Animated,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'

const { width: SCREEN_W } = Dimensions.get('window')

const AMBER  = '#F5A623'
const NAVY   = '#1A1A2E'
const PURPLE = '#8B5CF6'
const GREEN  = '#1D9E75'
const BLUE   = '#378ADD'

/**
 * OnboardingScreen
 *
 * 3-slide horizontal swipe flow shown only on first launch.
 * Rendered directly by App.jsx when useOnboarding().needsOnboarding is true.
 *
 * Props:
 *   onComplete: () => void  — called when user taps "Get started" or "Skip"
 */
export default function OnboardingScreen({ onComplete }) {
  const insets = useSafeAreaInsets()
  const scrollRef = useRef(null)
  const [currentPage, setCurrentPage] = useState(0)
  const dotAnim = useRef([
    new Animated.Value(1),
    new Animated.Value(0.3),
    new Animated.Value(0.3),
  ]).current

  const PAGES = [
    {
      key: 'what',
      emoji: '📋',
      title: 'Stop saying\n"I don\'t know,\nwhat do YOU\nwant to do?"',
      subtitle: 'CheckOff is your crew\'s bucket list for your city. Real places, real experiences, real competition.',
      accent: AMBER,
      preview: <WhatPreview />,
    },
    {
      key: 'how',
      emoji: '🏆',
      title: 'Check things off.\nEarn points.\nBeat your crew.',
      subtitle: 'Every item is worth points. Rare spots and secret experiences are worth more. Your leaderboard updates live.',
      accent: PURPLE,
      preview: <HowPreview />,
    },
    {
      key: 'start',
      emoji: '🔥',
      title: 'Your city is\nwaiting.',
      subtitle: 'Start with a curated list for your city, or build your own and invite your crew.',
      accent: GREEN,
      preview: <StartPreview />,
    },
  ]

  function goToPage(page) {
    scrollRef.current?.scrollTo({ x: page * SCREEN_W, animated: true })
    animateDots(page)
    setCurrentPage(page)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  }

  function animateDots(page) {
    dotAnim.forEach((anim, i) => {
      Animated.spring(anim, {
        toValue: i === page ? 1 : 0.3,
        useNativeDriver: true,
      }).start()
    })
  }

  function handleScroll(e) {
    const page = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W)
    if (page !== currentPage) {
      animateDots(page)
      setCurrentPage(page)
    }
  }

  function handleNext() {
    if (currentPage < PAGES.length - 1) {
      goToPage(currentPage + 1)
    } else {
      onComplete()
    }
  }

  const currentAccent = PAGES[currentPage].accent

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + 16 }]}>

      {/* Skip button */}
      <TouchableOpacity
        style={[styles.skipBtn, { paddingTop: insets.top + 12 }]}
        onPress={onComplete}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <Text style={styles.skipText}>Skip</Text>
      </TouchableOpacity>

      {/* Slides */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScroll}
        scrollEventThrottle={16}
        style={{ flex: 1 }}
      >
        {PAGES.map((page, index) => (
          <View key={page.key} style={[styles.slide, { width: SCREEN_W }]}>

            {/* Preview card */}
            <View style={[styles.previewCard, { borderColor: page.accent + '40' }]}>
              {page.preview}
            </View>

            {/* Text */}
            <Text style={styles.emoji}>{page.emoji}</Text>
            <Text style={[styles.title, { color: page.accent }]}>{page.title}</Text>
            <Text style={styles.subtitle}>{page.subtitle}</Text>

          </View>
        ))}
      </ScrollView>

      {/* Dots */}
      <View style={styles.dotRow}>
        {PAGES.map((_, i) => (
          <Animated.View
            key={i}
            style={[
              styles.dot,
              {
                backgroundColor: currentAccent,
                opacity: dotAnim[i],
                transform: [{ scale: dotAnim[i].interpolate({
                  inputRange: [0.3, 1],
                  outputRange: [0.7, 1],
                }) }],
              },
            ]}
          />
        ))}
      </View>

      {/* CTA button */}
      <TouchableOpacity
        style={[styles.ctaBtn, { backgroundColor: currentAccent }]}
        onPress={handleNext}
        activeOpacity={0.88}
      >
        <Text style={styles.ctaBtnText}>
          {currentPage < PAGES.length - 1 ? 'Next →' : 'Get started'}
        </Text>
      </TouchableOpacity>

    </View>
  )
}

// ── Slide 1 Preview: animated list with items and difficulty badges ────────────

function WhatPreview() {
  const ITEMS = [
    { body: 'Catch a local band at an open mic night', cat: 'Music', catColor: PURPLE, pts: 1, label: null },
    { body: 'Visit Joes BBQ', cat: 'Food', catColor: AMBER, pts: 5, label: 'Partner' },
    { body: '🔒 Secret item at Baba\'s Burgers & Birds', cat: 'Food', catColor: AMBER, pts: 25, label: 'Legend' },
  ]
  const DIFF_COLORS = {
    Partner: { bg: '#EBF4FF', text: BLUE },
    Rare:    { bg: '#FFF7E6', text: '#92400E' },
    Legend:  { bg: '#F3EEFF', text: PURPLE },
  }
  return (
    <View style={{ gap: 8 }}>
      {ITEMS.map((item, i) => (
        <View key={i} style={pw.row}>
          <View style={[pw.check, i === 0 && pw.checkDone]}>
            {i === 0 && <Text style={{ fontSize: 10, color: NAVY, fontWeight: '800' }}>✓</Text>}
            {i === 2 && <Text style={{ fontSize: 10 }}>🔒</Text>}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={pw.body} numberOfLines={1}>{item.body}</Text>
            <View style={{ flexDirection: 'row', gap: 5, marginTop: 3 }}>
              <View style={[pw.tag, { backgroundColor: item.catColor + '20' }]}>
                <Text style={[pw.tagText, { color: item.catColor }]}>{item.cat}</Text>
              </View>
              {item.label && (
                <View style={[pw.tag, { backgroundColor: DIFF_COLORS[item.label]?.bg }]}>
                  <Text style={[pw.tagText, { color: DIFF_COLORS[item.label]?.text, fontWeight: '800' }]}>
                    {item.label} · {item.pts}pts
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>
      ))}
    </View>
  )
}

// ── Slide 2 Preview: leaderboard with fake crew scores ────────────────────────

function HowPreview() {
  const CREW = [
    { name: 'Jerry',  score: 47, streak: 5,  medal: '🥇', color: AMBER  },
    { name: 'Alex',   score: 38, streak: 3,  medal: '🥈', color: BLUE   },
    { name: 'Morgan', score: 22, streak: 0,  medal: '🥉', color: GREEN  },
    { name: 'Sam',    score: 10, streak: 0,  medal: '4',  color: '#6B7280' },
  ]
  return (
    <View style={{ gap: 8 }}>
      {CREW.map((m, i) => (
        <View key={i} style={[pw.lbRow, i === 0 && { backgroundColor: AMBER + '12', borderColor: AMBER + '40' }]}>
          <Text style={[pw.lbMedal, { color: i < 3 ? m.color : '#6B7280' }]}>{m.medal}</Text>
          <View style={[pw.lbAvatar, { backgroundColor: m.color + '30' }]}>
            <Text style={[pw.lbAvatarText, { color: m.color }]}>{m.name[0]}</Text>
          </View>
          <Text style={[pw.lbName, i === 0 && { color: AMBER, fontWeight: '800' }]}>{m.name}</Text>
          {m.streak >= 4 && <Text style={pw.lbFlame}>🔥{m.streak}w</Text>}
          <View style={pw.lbScoreWrap}>
            <Text style={[pw.lbScore, i === 0 && { color: AMBER }]}>{m.score}</Text>
            <Text style={pw.lbPts}>pts</Text>
          </View>
        </View>
      ))}
    </View>
  )
}

// ── Slide 3 Preview: curated list card + crew invite section ──────────────────

function StartPreview() {
  const CREW = [
    { initial: 'J', color: AMBER },
    { initial: 'A', color: BLUE },
    { initial: 'M', color: GREEN },
  ]
  return (
    <View style={{ gap: 10 }}>
      {/* Curated list card */}
      <View style={[pw.listCard, { borderColor: AMBER + '40' }]}>
        <Text style={{ fontSize: 22, marginBottom: 6 }}>☀️</Text>
        <Text style={pw.listCardTitle}>Phoenix Summer 2026</Text>
        <Text style={pw.listCardSub}>48 items · curated for your city</Text>
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
          <View style={[pw.tag, { backgroundColor: AMBER + '20' }]}>
            <Text style={[pw.tagText, { color: AMBER }]}>Summer</Text>
          </View>
          <View style={[pw.tag, { backgroundColor: GREEN + '20' }]}>
            <Text style={[pw.tagText, { color: GREEN }]}>Phoenix</Text>
          </View>
        </View>
      </View>

      {/* Crew invite preview */}
      <View style={[pw.crewCard, { borderColor: PURPLE + '30' }]}>
        <Text style={pw.crewLabel}>Invite your crew</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <View style={{ flexDirection: 'row', gap: -6 }}>
            {CREW.map((c, i) => (
              <View key={i} style={[pw.crewAvatar, { backgroundColor: c.color, marginRight: -6 }]}>
                <Text style={pw.crewAvatarText}>{c.initial}</Text>
              </View>
            ))}
          </View>
          <Text style={pw.crewText}>See who checks off the most</Text>
        </View>
      </View>
    </View>
  )
}

// ── Preview styles ────────────────────────────────────────────────────────────

const pw = StyleSheet.create({
  row:            { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  check:          { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 },
  checkDone:      { backgroundColor: AMBER, borderColor: AMBER },
  body:           { fontSize: 12, color: '#fff', fontWeight: '600', lineHeight: 16 },
  tag:            { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999 },
  tagText:        { fontSize: 9, fontWeight: '700' },

  lbRow:          { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', backgroundColor: 'rgba(255,255,255,0.03)' },
  lbMedal:        { fontSize: 14, fontWeight: '800', width: 20, textAlign: 'center' },
  lbAvatar:       { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  lbAvatarText:   { fontSize: 11, fontWeight: '800' },
  lbName:         { flex: 1, fontSize: 12, color: 'rgba(255,255,255,0.8)', fontWeight: '600' },
  lbFlame:        { fontSize: 10, color: AMBER },
  lbScoreWrap:    { alignItems: 'center' },
  lbScore:        { fontSize: 14, fontWeight: '800', color: 'rgba(255,255,255,0.9)' },
  lbPts:          { fontSize: 8, color: 'rgba(255,255,255,0.4)', fontWeight: '700', textTransform: 'uppercase' },

  listCard:       { backgroundColor: 'rgba(245,166,35,0.07)', borderRadius: 14, padding: 14, borderWidth: 1 },
  listCardTitle:  { fontSize: 14, fontWeight: '800', color: '#fff' },
  listCardSub:    { fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 },

  crewCard:       { backgroundColor: 'rgba(139,92,246,0.07)', borderRadius: 14, padding: 14, borderWidth: 1 },
  crewLabel:      { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 0.8 },
  crewAvatar:     { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#0F0F1E' },
  crewAvatarText: { fontSize: 11, fontWeight: '800', color: NAVY },
  crewText:       { fontSize: 11, color: 'rgba(255,255,255,0.5)', flex: 1 },
})

// ── Main screen styles ────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0F1E',
  },

  skipBtn: {
    position: 'absolute',
    top: 0,
    right: 20,
    zIndex: 10,
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  skipText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.35)',
    fontWeight: '600',
  },

  slide: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 80,
    paddingBottom: 20,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },

  previewCard: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    marginBottom: 28,
  },

  emoji: {
    fontSize: 36,
    marginBottom: 12,
  },

  title: {
    fontSize: 30,
    fontWeight: '800',
    lineHeight: 36,
    letterSpacing: -0.5,
    marginBottom: 14,
  },

  subtitle: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.5)',
    lineHeight: 22,
    fontWeight: '500',
  },

  dotRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 20,
  },

  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  ctaBtn: {
    marginHorizontal: 24,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    marginBottom: 8,
  },

  ctaBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: NAVY,
  },
})
