import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  View, Text, StyleSheet, Animated, Easing, Dimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

const { width } = Dimensions.get('window')
const AMBER = '#F5A623'
const NAVY  = '#070714'
const WHITE = '#F7F7FB'

const TAGLINES = [
  `Stop saying "I don't know what to do."`,
  'Hundreds of things to check off in Your City.',
  'Challenge your crew. Beat their score.',
  'Discover places locals actually go.',
  'Every weekend is a new adventure.',
]

const ITEMS = [
  "Order a Dirty Martini at Rosie's Bar 🍺",
  'Hike to the top of Camelback Mountain 🏔',
  'Watch a spring training game ⚾',
  'Find the best green chile in the valley 🌶',
  'Kayak on the Salt River 🛶',
  'Catch a sunset at South Mountain 🌅',
  'Try the Smash Burger at In-N-Out 🍔',
  'Bowl a perfect game 🎳',
  'Go to a food truck Friday 🚚',
  'Take a ghost tour of Old Town Scottsdale 👻',
]

const LOADING_LINES = [
  'Loading your city…',
  'Finding things to do…',
  'Scouting local favorites…',
  'Building your adventure list…',
]

export default function SplashScreen() {
  const insets = useSafeAreaInsets()

  const logoScale = useRef(new Animated.Value(0.9)).current
  const logoOpacity = useRef(new Animated.Value(0)).current
  const taglineOpacity = useRef(new Animated.Value(0)).current
  const chipOpacity = useRef(new Animated.Value(0)).current
  const chipTranslateY = useRef(new Animated.Value(10)).current
  const shimmer = useRef(new Animated.Value(0)).current

  const check1Y = useRef(new Animated.Value(12)).current
  const check1O = useRef(new Animated.Value(0)).current
  const check2Y = useRef(new Animated.Value(12)).current
  const check2O = useRef(new Animated.Value(0)).current
  const check3Y = useRef(new Animated.Value(12)).current
  const check3O = useRef(new Animated.Value(0)).current

  const [itemIndex, setItemIndex] = useState(0)
  const [loadingIndex, setLoadingIndex] = useState(0)

  const tagline = useMemo(() => {
    return TAGLINES[Math.floor(Math.random() * TAGLINES.length)]
  }, [])

  useEffect(() => {
    Animated.parallel([
      Animated.spring(logoScale, {
        toValue: 1,
        tension: 70,
        friction: 8,
        useNativeDriver: true,
      }),
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: 550,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start()

    const taglineTimer = setTimeout(() => {
      Animated.timing(taglineOpacity, {
        toValue: 1,
        duration: 550,
        useNativeDriver: true,
      }).start()
    }, 250)

    Animated.loop(
      Animated.timing(shimmer, {
        toValue: 1,
        duration: 2200,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      })
    ).start()

    startFloatingChecks()
    animateChipIn()

    const chipInterval = setInterval(() => {
      animateChipOut(() => {
        setItemIndex(prev => (prev + 1) % ITEMS.length)
        setTimeout(() => animateChipIn(), 80)
      })
    }, 2200)

    const loadingInterval = setInterval(() => {
      setLoadingIndex(prev => (prev + 1) % LOADING_LINES.length)
    }, 1800)

    return () => {
      clearTimeout(taglineTimer)
      clearInterval(chipInterval)
      clearInterval(loadingInterval)
    }
  }, [])

  function animateChipIn() {
    chipTranslateY.setValue(10)
    chipOpacity.setValue(0)

    Animated.parallel([
      Animated.timing(chipOpacity, {
        toValue: 1,
        duration: 320,
        useNativeDriver: true,
      }),
      Animated.spring(chipTranslateY, {
        toValue: 0,
        tension: 90,
        friction: 9,
        useNativeDriver: true,
      }),
    ]).start()
  }

  function animateChipOut(onDone) {
    Animated.parallel([
      Animated.timing(chipOpacity, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(chipTranslateY, {
        toValue: -8,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start(() => onDone?.())
  }

  function runCheck(y, o, delay) {
    const loop = () => {
      y.setValue(14)
      o.setValue(0)

      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(o, {
            toValue: 1,
            duration: 180,
            useNativeDriver: true,
          }),
          Animated.timing(y, {
            toValue: -70,
            duration: 1200,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(o, {
          toValue: 0,
          duration: 350,
          useNativeDriver: true,
        }),
      ]).start(() => loop())
    }

    loop()
  }

  function startFloatingChecks() {
    runCheck(check1Y, check1O, 300)
    runCheck(check2Y, check2O, 700)
    runCheck(check3Y, check3O, 1100)
  }

  const shimmerTranslate = shimmer.interpolate({
    inputRange: [0, 1],
    outputRange: [-140, 140],
  })

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.topGlow} />
      <View style={styles.bottomGlow} />

      <Animated.Text
        style={[
          styles.floatingCheck,
          {
            left: width * 0.34,
            opacity: check1O,
            transform: [{ translateY: check1Y }],
          },
        ]}
      >
        ✓
      </Animated.Text>

      <Animated.Text
        style={[
          styles.floatingCheck,
          {
            left: width * 0.5,
            opacity: check2O,
            transform: [{ translateY: check2Y }],
          },
        ]}
      >
        ✓
      </Animated.Text>

      <Animated.Text
        style={[
          styles.floatingCheck,
          {
            left: width * 0.66,
            opacity: check3O,
            transform: [{ translateY: check3Y }],
          },
        ]}
      >
        ✓
      </Animated.Text>

      <View style={styles.center}>
        <Animated.View
          style={{
            opacity: logoOpacity,
            transform: [{ scale: logoScale }],
            alignItems: 'center',
          }}
        >
          <Text style={styles.logo}>
            Check<Text style={styles.logoOff}>Off</Text>
          </Text>

          <View style={styles.logoDividerWrap}>
            <View style={styles.logoDividerBase} />
            <Animated.View
              style={[
                styles.logoDividerShimmer,
                { transform: [{ translateX: shimmerTranslate }] },
              ]}
            />
          </View>
        </Animated.View>

        <Animated.Text style={[styles.tagline, { opacity: taglineOpacity }]}>
          {tagline}
        </Animated.Text>

        <View style={styles.itemsContainer}>
          <Animated.View
            style={[
              styles.itemChip,
              {
                opacity: chipOpacity,
                transform: [{ translateY: chipTranslateY }],
              },
            ]}
          >
            <Text style={styles.itemChipText} numberOfLines={1}>
              {ITEMS[itemIndex]}
            </Text>
          </Animated.View>
        </View>
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 24 }]}>
        <PulseLoader />
        <Text style={styles.loadingText}>{LOADING_LINES[loadingIndex]}</Text>
      </View>
    </View>
  )
}

function PulseLoader() {
  const scale1 = useRef(new Animated.Value(0.7)).current
  const scale2 = useRef(new Animated.Value(0.7)).current
  const scale3 = useRef(new Animated.Value(0.7)).current
  const fade1 = useRef(new Animated.Value(0.5)).current
  const fade2 = useRef(new Animated.Value(0.5)).current
  const fade3 = useRef(new Animated.Value(0.5)).current

  useEffect(() => {
    const animateDot = (scale, fade, delay) => {
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.parallel([
            Animated.timing(scale, {
              toValue: 1.2,
              duration: 320,
              useNativeDriver: true,
            }),
            Animated.timing(fade, {
              toValue: 1,
              duration: 320,
              useNativeDriver: true,
            }),
          ]),
          Animated.parallel([
            Animated.timing(scale, {
              toValue: 0.7,
              duration: 320,
              useNativeDriver: true,
            }),
            Animated.timing(fade, {
              toValue: 0.45,
              duration: 320,
              useNativeDriver: true,
            }),
          ]),
        ])
      ).start()
    }

    animateDot(scale1, fade1, 0)
    animateDot(scale2, fade2, 140)
    animateDot(scale3, fade3, 280)
  }, [])

  return (
    <View style={styles.pulseRow}>
      <Animated.View style={[styles.pulseDot, { opacity: fade1, transform: [{ scale: scale1 }] }]} />
      <Animated.View style={[styles.pulseDot, { opacity: fade2, transform: [{ scale: scale2 }] }]} />
      <Animated.View style={[styles.pulseDot, { opacity: fade3, transform: [{ scale: scale3 }] }]} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: NAVY,
    justifyContent: 'space-between',
  },

  topGlow: {
    position: 'absolute',
    top: -120,
    alignSelf: 'center',
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: 'rgba(245,166,35,0.14)',
  },

  bottomGlow: {
    position: 'absolute',
    bottom: -90,
    right: -40,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(29,158,117,0.08)',
  },

  floatingCheck: {
    position: 'absolute',
    top: '48%',
    fontSize: 26,
    fontWeight: '800',
    color: AMBER,
  },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },

  logo: {
    fontSize: 58,
    fontWeight: '900',
    color: AMBER,
    letterSpacing: -2,
    lineHeight: 64,
  },

  logoOff: {
    color: WHITE,
  },

  logoDividerWrap: {
    width: 86,
    height: 6,
    marginTop: 10,
    overflow: 'hidden',
    borderRadius: 999,
  },

  logoDividerBase: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(245,166,35,0.35)',
    borderRadius: 999,
  },

  logoDividerShimmer: {
    position: 'absolute',
    width: 26,
    height: '100%',
    backgroundColor: AMBER,
    borderRadius: 999,
    opacity: 0.95,
  },

  tagline: {
    fontSize: 18,
    color: 'rgba(255,255,255,0.74)',
    textAlign: 'center',
    lineHeight: 26,
    fontWeight: '400',
    marginTop: 18,
    marginBottom: 34,
  },

  itemsContainer: {
    height: 56,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },

  itemChip: {
    maxWidth: '94%',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },

  itemChipText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.88)',
    fontWeight: '600',
    textAlign: 'center',
  },

  bottom: {
    alignItems: 'center',
    gap: 12,
  },

  pulseRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },

  pulseDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: AMBER,
  },

  loadingText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.34)',
    letterSpacing: 0.4,
    fontWeight: '500',
  },
})