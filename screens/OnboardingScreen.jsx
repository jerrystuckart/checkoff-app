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
import OnboardingDeviceFrame from '../components/OnboardingDeviceFrame'
import {
  SeasonalHeroCard,
  CuratedListRow,
  ChecklistCard,
  FriendAvatarsRow,
  Pill,
} from '../components/OnboardingPreviews'

const { width: SCREEN_W } = Dimensions.get('window')

const TEAL   = '#2DD4BF'
const PURPLE = '#8B5CF6'
const AMBER  = '#F5A623'
const GREEN  = '#1D9E75'
const BLUE   = '#378ADD'
const NAVY   = '#1A1A2E'

/**
 * OnboardingScreen
 *
 * 3-slide horizontal swipe flow shown only on first launch.
 * Rendered directly by App.jsx when useOnboarding().needsOnboarding is true.
 *
 * Props:
 *   onComplete: () => void  — called when user taps "Get started" / final CTA / Skip
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
      key: 'discovery',
      accent: TEAL,
      title: 'Your city is\nwaiting.',
      body: 'Pick a curated list, find real spots nearby, and never wonder what to do again.',
      cta: 'Get started',
      preview: (
        <View style={{ gap: 8 }}>
          <SeasonalHeroCard emoji="🍂" title="Phoenix Fall 30" cityTag="Phoenix" />
          <CuratedListRow title="Weekend Day Trips" subtitle="18 items · curated" accent={TEAL} />
          <CuratedListRow title="Best Tacos in Town" subtitle="12 items · curated" accent={AMBER} />
          <CuratedListRow title="Live Music This Month" subtitle="9 items · curated" accent={PURPLE} />
        </View>
      ),
    },
    {
      key: 'friends',
      accent: PURPLE,
      title: 'Better with\nyour crew.',
      body: "Find things worth doing and invite the people you'd want to do them with.",
      cta: 'Next →',
      preview: (
        <View style={{ gap: 8 }}>
          <ChecklistCard
            items={[
              { label: 'Catch a local band at an open mic night', cat: 'Music', catColor: PURPLE, done: true },
              { label: 'Try the rooftop taco spot downtown', cat: 'Food', catColor: AMBER, done: false },
              { label: 'Sunset hike at Camelback', cat: 'Outdoors', catColor: GREEN, done: false },
            ]}
          />
          <FriendAvatarsRow
            people={[
              { initial: 'J', color: AMBER },
              { initial: 'A', color: BLUE },
              { initial: 'M', color: GREEN },
              { initial: 'S', color: PURPLE },
            ]}
            label="Doing this together"
          />
        </View>
      ),
    },
    {
      key: 'depth',
      accent: AMBER,
      title: "There's always\nmore to find.",
      body: 'Unlock hidden gems, discover local secrets, and build your own lists for trips and weekends.',
      cta: 'Start checking off',
      preview: (
        <View style={{ gap: 8 }}>
          <ChecklistCard
            items={[
              { label: 'Visit Joe\'s BBQ', cat: 'Food', catColor: AMBER, done: true },
              { label: 'Catch a local band at an open mic night', cat: 'Music', catColor: PURPLE, done: false },
              { label: 'Secret item at Baba\'s Burgers & Birds', locked: true },
            ]}
          />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pill text="✨ Hidden Gem" color={PURPLE} />
            <Pill text="+25 discovery pts" color={AMBER} />
          </View>
        </View>
      ),
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
        <Text style={styles.skipText} allowFontScaling={false}>Skip</Text>
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
          <View key={page.key} style={[styles.slide, { width: SCREEN_W, paddingTop: insets.top + 56 }]}>

            {/* Device-framed visual — leads the screen */}
            <View style={styles.frameArea}>
              <OnboardingDeviceFrame accent={page.accent}>
                {page.preview}
              </OnboardingDeviceFrame>
            </View>

            {/* Text */}
            <Text style={styles.title} allowFontScaling={false}>{page.title}</Text>
            <Text style={styles.body} numberOfLines={2} allowFontScaling={false}>{page.body}</Text>

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
        <Text style={styles.ctaBtnText} allowFontScaling={false}>
          {PAGES[currentPage].cta}
        </Text>
      </TouchableOpacity>

    </View>
  )
}

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
    paddingBottom: 12,
    alignItems: 'flex-start',
  },

  frameArea: {
    width: '100%',
    flex: 0.55,
    marginBottom: 22,
  },

  title: {
    fontSize: 36,
    fontWeight: '900',
    lineHeight: 40,
    letterSpacing: -0.6,
    color: '#fff',
    marginBottom: 10,
  },

  body: {
    fontSize: 17,
    lineHeight: 26,
    color: '#9A9AB0',
    fontWeight: '500',
  },

  dotRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
  },

  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  ctaBtn: {
    marginHorizontal: 24,
    height: 60,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },

  ctaBtnText: {
    fontSize: 17,
    fontWeight: '800',
    color: NAVY,
  },
})
