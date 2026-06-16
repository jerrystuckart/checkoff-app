import React, { useState, useEffect, useRef } from 'react'
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Share,
} from 'react-native'

const AMBER = '#F5A623'
const NAVY  = '#1A1A2E'

// Checkpoint badges get enhanced title/body copy and a share button.
// Keys match badge_id values in badge_definitions.
const CHECKPOINT_COPY = {
  points_5:   { title: 'First Checkpoint 🔑',     body: "You're officially on your way. Keep checking off." },
  points_25:  { title: 'Explorer 🧭',              body: 'You know this city better than most.' },
  points_75:  { title: 'Local 🗺️',               body: "You've reached Local status. The city is yours." },
  points_150: { title: 'Insider Checkpoint ⚡',    body: "Halfway to Insider. You're ahead of the crowd." },
  points_300: { title: 'Insider 💎',               body: "Insider Access unlocked. Not everyone gets here." },
  points_500: { title: 'Legend 🌟',               body: "You are a Legend. There's nothing left to prove." },
  streak_4wk: { title: '4 Week Streak 🌊',         body: 'Four weeks straight. Your city knows your name.' },
  streak_8wk: { title: '8 Week Streak 🔥🔥',       body: 'Two months of showing up. Impressive.' },
  streak_12wk:{ title: '12 Week Streak 🏅',        body: "Three months. You don't just check things off. You live it." },
}

function isCheckpointBadge(badgeId) {
  return badgeId?.startsWith('points_') || ['streak_4wk', 'streak_8wk', 'streak_12wk'].includes(badgeId)
}

export default function BadgeCelebrationModal({ badges = [], onDismiss }) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [visible, setVisible]           = useState(badges.length > 0)
  const scaleAnim = useRef(new Animated.Value(0)).current
  const fadeAnim  = useRef(new Animated.Value(0)).current

  const currentBadge  = badges[currentIndex]
  const hasMore       = currentIndex < badges.length - 1
  const isCheckpoint  = isCheckpointBadge(currentBadge?.id)
  const checkpointCopy = isCheckpoint ? CHECKPOINT_COPY[currentBadge.id] : null

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

  async function handleShare() {
    if (!currentBadge) return
    const title = checkpointCopy?.title ?? currentBadge.name
    const msg = `Just hit ${title} on CheckOff.\nStop saying "I don't know what to do."\ngetcheckoff.com`
    try {
      await Share.share({ message: msg })
    } catch { /* user cancelled */ }
  }

  if (!visible || !currentBadge) return null

  const displayName = checkpointCopy?.title ?? currentBadge.name
  const displayDesc = checkpointCopy?.body  ?? currentBadge.description
  const earnedLabel = isCheckpoint ? 'CHECKPOINT REACHED' : 'BADGE UNLOCKED'

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
            isCheckpoint && styles.cardCheckpoint,
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

          <Text style={[styles.earnedLabel, isCheckpoint && styles.earnedLabelCheckpoint]}>
            {earnedLabel}
          </Text>
          <Text style={styles.badgeName}>{displayName}</Text>
          <Text style={styles.badgeDesc}>{displayDesc}</Text>

          <TouchableOpacity
            style={styles.btn}
            onPress={handleNext}
            activeOpacity={0.85}
          >
            <Text style={styles.btnText}>
              {hasMore ? 'Next Badge →' : "Let's go!"}
            </Text>
          </TouchableOpacity>

          {/* Share button — checkpoint badges only, on the last (or only) badge */}
          {isCheckpoint && !hasMore && (
            <TouchableOpacity
              style={styles.shareBtn}
              onPress={handleShare}
              activeOpacity={0.85}
            >
              <Text style={styles.shareBtnText}>Share this milestone ↗</Text>
            </TouchableOpacity>
          )}

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
  cardCheckpoint: {
    borderColor: 'rgba(245,166,35,0.65)',
    borderWidth: 1.5,
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
  earnedLabelCheckpoint: {
    letterSpacing: 2,
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
  shareBtn: {
    marginTop: 12,
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 32,
    alignItems: 'center',
    width: '100%',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.25)',
  },
  shareBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: AMBER,
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
