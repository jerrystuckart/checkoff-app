import React from 'react'
import { View, StyleSheet } from 'react-native'

/**
 * OnboardingDeviceFrame
 *
 * Dark phone-style bezel used to frame real CheckOff UI inside the
 * onboarding slides. Sizes itself from the flex space its parent
 * gives it (never a fixed px height) so it scales down cleanly on
 * small devices like iPhone SE without clipping.
 */
export default function OnboardingDeviceFrame({ accent, children }) {
  return (
    <View style={styles.wrap}>
      <View style={[styles.glow, { backgroundColor: accent, shadowColor: accent }]} />
      <View style={styles.bezel}>
        <View style={styles.notch} />
        <View style={styles.screen}>
          {children}
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: '68%',
    height: '68%',
    borderRadius: 999,
    opacity: 0.32,
    shadowOffset: { width: 0, height: 24 },
    shadowOpacity: 0.7,
    shadowRadius: 48,
  },
  bezel: {
    flex: 1,
    aspectRatio: 0.5,
    alignSelf: 'center',
    maxHeight: '100%',
    backgroundColor: '#050508',
    borderRadius: 36,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  notch: {
    alignSelf: 'center',
    width: 56,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginBottom: 6,
  },
  screen: {
    flex: 1,
    backgroundColor: '#0B0B18',
    borderRadius: 28,
    padding: 14,
    overflow: 'hidden',
  },
})
