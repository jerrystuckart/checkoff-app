import React, { useState, useEffect, useRef } from 'react'
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from 'react-native'

const AMBER = '#F5A623'
const NAVY  = '#1A1A2E'

export default function BadgeCelebrationModal({ badges = [], onDismiss }) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [visible, setVisible]           = useState(badges.length > 0)
  const scaleAnim = useRef(new Animated.Value(0)).current
  const fadeAnim  = useRef(new Animated.Value(0)).current

  const currentBadge = badges[currentIndex]
  const hasMore      = currentIndex < badges.length - 1

  // Reset index and visibility whenever a new batch of badges is passed in
  useEffect(() => {
    if (badges.length > 0) {
      setCurrentIndex(0)
      setVisible(true)
    }
  }, [badges])

  // Entrance animation — fires on mount and whenever the index advances
  useEffect(() => {
    if (visible && currentBadge) {
      scaleAnim.setValue(0)
      fadeAnim.setValue(0)
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue:  1,
          tension:  100,
          friction: 8,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue:  1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start()
    }
  }, [currentIndex, visible]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleNext() {
    if (hasMore) {
      // Animate out, then advance to the next badge
      Animated.timing(scaleAnim, {
        toValue:  0.8,
        duration: 150,
        useNativeDriver: true,
      }).start(() => setCurrentIndex(i => i + 1))
    } else {
      handleDismiss()
    }
  }

  function handleDismiss() {
    setVisible(false)
    onDismiss?.()
  }

  if (!visible || !currentBadge) return null

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={handleDismiss}
    >
      <View style={styles.overlay}>
        <Animated.View
          style={[
            styles.card,
            { opacity: fadeAnim, transform: [{ scale: scaleAnim }] },
          ]}
        >
          {/* Counter — only shown when earning multiple badges at once */}
          {badges.length > 1 && (
            <Text style={styles.counter}>
              {currentIndex + 1} of {badges.length}
            </Text>
          )}

          {/* Badge emoji */}
          <Text style={styles.emoji}>{currentBadge.icon}</Text>

          <Text style={styles.earnedLabel}>BADGE UNLOCKED</Text>
          <Text style={styles.badgeName}>{currentBadge.name}</Text>
          <Text style={styles.badgeDesc}>{currentBadge.description}</Text>

          <TouchableOpacity
            style={styles.btn}
            onPress={handleNext}
            activeOpacity={0.85}
          >
            <Text style={styles.btnText}>
              {hasMore ? 'Next Badge →' : "Let's go!"}
            </Text>
          </TouchableOpacity>

          {badges.length > 1 && (
            <TouchableOpacity onPress={handleDismiss} style={styles.skipBtn}>
              <Text style={styles.skipText}>Skip all</Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  card: {
    backgroundColor: NAVY,
    borderRadius: 24,
    paddingVertical: 40,
    paddingHorizontal: 32,
    alignItems: 'center',
    width: '100%',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.3)',
  },
  counter: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.3)',
    letterSpacing: 1,
    marginBottom: 16,
    textTransform: 'uppercase',
  },
  emoji: {
    fontSize: 72,
    marginBottom: 16,
  },
  earnedLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: AMBER,
    letterSpacing: 3,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  badgeName: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 10,
    letterSpacing: -0.5,
  },
  badgeDesc: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.55)',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  btn: {
    backgroundColor: AMBER,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 40,
    alignItems: 'center',
    width: '100%',
  },
  btnText: {
    fontSize: 16,
    fontWeight: '700',
    color: NAVY,
  },
  skipBtn: {
    marginTop: 14,
    padding: 8,
  },
  skipText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.25)',
  },
})
