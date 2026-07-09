import React, { useState, useEffect, useRef } from 'react'
import {
  Modal, View, Text, TouchableOpacity, StyleSheet,
  Animated, ScrollView, ActivityIndicator,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import { supabase } from '../lib/supabase'

const AMBER        = '#F5A623'
const NAVY         = '#0F0F1E'
const AMBER_DIM    = 'rgba(245,166,35,0.12)'
const AMBER_BORDER = 'rgba(245,166,35,0.30)'

// ── Particle burst ────────────────────────────────────────────────────────────
const PARTICLE_COLORS = ['#F5A623', '#FFD166', '#FFE599', '#FFFFFF', '#FFC833', '#F5A623']
const PARTICLE_COUNT  = 22

function ParticleBurst() {
  const particles = useRef(null)
  if (!particles.current) {
    particles.current = Array.from({ length: PARTICLE_COUNT }, (_, i) => {
      const angle  = (i / PARTICLE_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.4
      const radius = 60 + Math.random() * 80
      return {
        dx:         Math.cos(angle) * radius,
        dy:         Math.sin(angle) * radius,
        color:      PARTICLE_COLORS[i % PARTICLE_COLORS.length],
        size:       4 + Math.round(Math.random() * 5),
        opacity:    new Animated.Value(0),
        translateX: new Animated.Value(0),
        translateY: new Animated.Value(0),
        scale:      new Animated.Value(0),
      }
    })
  }

  useEffect(() => {
    const ps = particles.current
    Animated.parallel(
      ps.map((p, i) =>
        Animated.sequence([
          Animated.delay(i * 18),
          Animated.parallel([
            Animated.timing(p.scale,      { toValue: 1, duration: 100, useNativeDriver: true }),
            Animated.timing(p.opacity,    { toValue: 1, duration: 80,  useNativeDriver: true }),
            Animated.spring(p.translateX, { toValue: p.dx, tension: 35, friction: 7, useNativeDriver: true }),
            Animated.spring(p.translateY, { toValue: p.dy, tension: 35, friction: 7, useNativeDriver: true }),
          ]),
        ])
      )
    ).start()

    const fadeTimer = setTimeout(() => {
      Animated.parallel(
        ps.map(p =>
          Animated.timing(p.opacity, { toValue: 0, duration: 700, useNativeDriver: true })
        )
      ).start()
    }, 380)

    return () => clearTimeout(fadeTimer)
  }, [])

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}
    >
      {particles.current.map((p, i) => (
        <Animated.View
          key={i}
          style={{
            position:        'absolute',
            width:           p.size,
            height:          p.size,
            borderRadius:    p.size / 2,
            backgroundColor: p.color,
            opacity:         p.opacity,
            transform: [
              { translateX: p.translateX },
              { translateY: p.translateY },
              { scale: p.scale },
            ],
          }}
        />
      ))}
    </View>
  )
}

// ── Main modal ────────────────────────────────────────────────────────────────
export default function TierUpgradeCelebrationModal({
  tier,             // row from checkoff_status_tiers: { tier_name, badge_label, description, min_points }
  newPoints,        // user's new lifetime total (number)
  onDismiss,        // () => void — called on "Keep Going"
  onExploreInsider, // () => void — called on "Explore Insider Access"
}) {
  const scaleAnim = useRef(new Animated.Value(0.7)).current
  const fadeAnim  = useRef(new Animated.Value(0)).current

  const [nextTier,     setNextTier]     = useState(null)
  const [drops,        setDrops]        = useState(null)   // null = loading
  const [loadingDrops, setLoadingDrops] = useState(true)

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, tension: 100, friction: 8, useNativeDriver: true }),
      Animated.timing(fadeAnim,  { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start()
  }, [])

  useEffect(() => {
    if (!tier) return
    setLoadingDrops(true)
    Promise.all([
      supabase
        .from('checkoff_status_tiers')
        .select('tier_name, min_points, badge_label')
        .gt('min_points', Number(tier.min_points))
        .order('min_points')
        .limit(1),
      supabase
        .from('items')
        .select('id, body, insider_drop_teaser_text')
        .eq('is_insider_drop', true)
        .eq('is_active', true)
        .lte('insider_drop_requires_points', newPoints)
        .limit(3),
    ]).then(([tierRes, dropsRes]) => {
      setNextTier(tierRes.data?.[0] ?? null)
      setDrops(dropsRes.data ?? [])
    }).catch(() => {
      setNextTier(null)
      setDrops([])
    }).finally(() => setLoadingDrops(false))
  }, [tier, newPoints])

  if (!tier) return null

  const tierName   = tier.tier_name   ?? ''
  const badgeLabel = tier.badge_label ?? tierName
  const desc       = tier.description ?? ''

  return (
    <Modal
      transparent
      visible
      animationType="fade"
      onRequestClose={onDismiss}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <View style={styles.glow} pointerEvents="none" />

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Animated.View style={[styles.card, { opacity: fadeAnim, transform: [{ scale: scaleAnim }] }]}>

            <Text style={styles.eyebrow}>YOU REACHED</Text>

            <Text style={styles.tierName}>{tierName.toUpperCase()}</Text>

            <View style={styles.badgePill}>
              <Text style={styles.badgePillText}>{badgeLabel}</Text>
            </View>

            <Text style={styles.desc}>{desc}</Text>

            <View style={styles.divider} />

            {loadingDrops ? (
              <ActivityIndicator color={AMBER} style={{ marginVertical: 16 }} />
            ) : drops && drops.length > 0 ? (
              <View style={styles.unlocksSection}>
                <Text style={styles.unlocksLabel}>
                  {drops.length === 1
                    ? "YOU'VE UNLOCKED 1 INSIDER DROP"
                    : `YOU'VE UNLOCKED ${drops.length} INSIDER DROPS`}
                </Text>
                {drops.map(drop => (
                  <View key={drop.id} style={styles.dropRow}>
                    <View style={styles.dropDot} />
                    <Text style={styles.dropText} numberOfLines={2}>
                      {drop.insider_drop_teaser_text ?? drop.body}
                    </Text>
                  </View>
                ))}
              </View>
            ) : nextTier ? (
              <View style={styles.nextTierRow}>
                <Text style={styles.nextTierLabel}>NEXT UP</Text>
                <Text style={styles.nextTierName}>{nextTier.tier_name}</Text>
                <Text style={styles.nextTierPts}>{Number(nextTier.min_points).toLocaleString()} pts</Text>
              </View>
            ) : (
              <Text style={styles.legendCopy}>You've reached the top tier. The city is yours.</Text>
            )}

            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={onExploreInsider}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>Explore Insider Access</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={onDismiss}
              activeOpacity={0.85}
            >
              <Text style={styles.secondaryBtnText}>Keep Going</Text>
            </TouchableOpacity>

          </Animated.View>
        </ScrollView>

        {/* Particles render on top of the card */}
        <ParticleBurst />
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.90)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position:        'absolute',
    width:           340,
    height:          340,
    borderRadius:    170,
    backgroundColor: 'rgba(245,166,35,0.07)',
    top:             '50%',
    left:            '50%',
    marginTop:       -170,
    marginLeft:      -170,
  },
  scrollContent: {
    flexGrow:           1,
    alignItems:         'center',
    justifyContent:     'center',
    paddingHorizontal:  28,
    paddingVertical:    48,
  },
  card: {
    backgroundColor: NAVY,
    borderRadius:    28,
    paddingVertical: 40,
    paddingHorizontal: 28,
    alignItems:      'center',
    width:           '100%',
    borderWidth:     1.5,
    borderColor:     AMBER_BORDER,
    shadowColor:     AMBER,
    shadowOpacity:   0.25,
    shadowRadius:    40,
    shadowOffset:    { width: 0, height: 0 },
  },
  eyebrow: {
    fontSize:      11,
    fontWeight:    '700',
    color:         'rgba(255,255,255,0.35)',
    letterSpacing: 3,
    marginBottom:  12,
  },
  tierName: {
    fontSize:         54,
    fontWeight:       '900',
    color:            AMBER,
    letterSpacing:    -1,
    textAlign:        'center',
    marginBottom:     14,
    lineHeight:       58,
    textShadowColor:  'rgba(245,166,35,0.45)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
  },
  badgePill: {
    backgroundColor:  AMBER_DIM,
    borderRadius:     999,
    paddingHorizontal: 18,
    paddingVertical:  8,
    borderWidth:      1,
    borderColor:      AMBER_BORDER,
    marginBottom:     16,
  },
  badgePillText: {
    fontSize:      13,
    fontWeight:    '700',
    color:         AMBER,
    letterSpacing: 0.5,
  },
  desc: {
    fontSize:     15,
    color:        'rgba(255,255,255,0.55)',
    textAlign:    'center',
    lineHeight:   22,
    marginBottom: 24,
    fontStyle:    'italic',
  },
  divider: {
    width:           '100%',
    height:          1,
    backgroundColor: 'rgba(245,166,35,0.18)',
    marginBottom:    24,
  },
  unlocksSection: {
    width:        '100%',
    marginBottom: 24,
  },
  unlocksLabel: {
    fontSize:      10,
    fontWeight:    '800',
    color:         AMBER,
    letterSpacing: 2,
    marginBottom:  14,
    textAlign:     'center',
  },
  dropRow: {
    flexDirection:   'row',
    alignItems:      'flex-start',
    gap:             10,
    marginBottom:    8,
    backgroundColor: AMBER_DIM,
    borderRadius:    12,
    padding:         12,
    borderWidth:     1,
    borderColor:     'rgba(245,166,35,0.15)',
  },
  dropDot: {
    width:           6,
    height:          6,
    borderRadius:    3,
    backgroundColor: AMBER,
    marginTop:       6,
    flexShrink:      0,
  },
  dropText: {
    flex:       1,
    fontSize:   14,
    color:      'rgba(255,255,255,0.75)',
    lineHeight: 20,
  },
  nextTierRow: {
    alignItems:      'center',
    marginBottom:    24,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius:    16,
    padding:         18,
    width:           '100%',
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.08)',
  },
  nextTierLabel: {
    fontSize:      10,
    fontWeight:    '700',
    color:         'rgba(255,255,255,0.28)',
    letterSpacing: 2,
    marginBottom:  6,
  },
  nextTierName: {
    fontSize:     22,
    fontWeight:   '800',
    color:        '#fff',
    marginBottom: 4,
  },
  nextTierPts: {
    fontSize:   13,
    color:      AMBER,
    fontWeight: '600',
  },
  legendCopy: {
    fontSize:     15,
    color:        'rgba(255,255,255,0.45)',
    textAlign:    'center',
    fontStyle:    'italic',
    marginBottom: 24,
    lineHeight:   22,
  },
  primaryBtn: {
    width:            '100%',
    backgroundColor:  AMBER,
    borderRadius:     16,
    paddingVertical:  17,
    alignItems:       'center',
    marginBottom:     10,
    shadowColor:      AMBER,
    shadowOpacity:    0.35,
    shadowRadius:     16,
    shadowOffset:     { width: 0, height: 4 },
  },
  primaryBtnText: {
    fontSize:   16,
    fontWeight: '800',
    color:      NAVY,
  },
  secondaryBtn: {
    paddingVertical:   13,
    paddingHorizontal: 24,
    alignItems:        'center',
  },
  secondaryBtnText: {
    fontSize:   15,
    fontWeight: '600',
    color:      'rgba(255,255,255,0.30)',
  },
})
