// Home 2026 — the one reusable "physical" press control for the redesign.
// Real depth (elevation shadow that compresses on press) + a small
// scale/translate response + a quick spring release, instead of the old
// flat opacity-fade TouchableOpacity everywhere. No looping/idle
// animation — it only ever reacts to an actual press.
//
// Two intensities:
//   'hero'    — bigger travel (translateY 3px, scale 0.98), Medium haptic.
//               For the What's Good primary card, at-place hero CTAs.
//   'utility' — smaller/faster (translateY 1.5px, scale 0.99), Light
//               haptic. For Near You rows, secondary cards — "fast and
//               restrained" per product guidance, not competing with hero.
//
// Renders a plain View, not react-native-reanimated (not a dependency
// here) — Animated.spring on the RN Animated API is enough for this and
// keeps the diff small.

import React, { useRef } from 'react'
import { Animated, Pressable, Platform } from 'react-native'
import * as Haptics from 'expo-haptics'

const INTENSITY = {
  hero:    { translateY: 3, scale: 0.98, haptic: Haptics.ImpactFeedbackStyle.Medium, shadowRestOpacity: 0.28, shadowPressOpacity: 0.1, shadowRestRadius: 14, shadowRestOffset: 8 },
  utility: { translateY: 1.5, scale: 0.99, haptic: Haptics.ImpactFeedbackStyle.Light, shadowRestOpacity: 0.16, shadowPressOpacity: 0.06, shadowRestRadius: 8, shadowRestOffset: 4 },
}

export default function PressableTactile({ children, onPress, intensity = 'utility', style, shadowColor = 'rgba(0,0,0,0.3)', disabled = false, hitSlop, accessibilityLabel }) {
  const cfg = INTENSITY[intensity] ?? INTENSITY.utility
  const anim = useRef(new Animated.Value(0)).current // 0 = rest, 1 = pressed

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [0, cfg.translateY] })
  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [1, cfg.scale] })
  const shadowOpacity = anim.interpolate({ inputRange: [0, 1], outputRange: [cfg.shadowRestOpacity, cfg.shadowPressOpacity] })
  const shadowRadius = anim.interpolate({ inputRange: [0, 1], outputRange: [cfg.shadowRestRadius, cfg.shadowRestRadius * 0.5] })

  function onPressIn() {
    Animated.timing(anim, { toValue: 1, duration: 90, useNativeDriver: false }).start()
  }
  function onPressOut() {
    Animated.spring(anim, { toValue: 0, useNativeDriver: false, speed: 20, bounciness: 6 }).start()
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      Haptics.impactAsync(cfg.haptic).catch(() => {})
    }
  }

  return (
    <Pressable onPress={disabled ? undefined : onPress} onPressIn={disabled ? undefined : onPressIn} onPressOut={disabled ? undefined : onPressOut} disabled={disabled} hitSlop={hitSlop} accessibilityLabel={accessibilityLabel}>
      <Animated.View
        style={[
          style,
          {
            transform: [{ translateY }, { scale }],
            shadowColor,
            shadowOpacity,
            shadowRadius,
            shadowOffset: { width: 0, height: cfg.shadowRestOffset },
            elevation: intensity === 'hero' ? 10 : 5,
          },
        ]}
      >
        {children}
      </Animated.View>
    </Pressable>
  )
}
