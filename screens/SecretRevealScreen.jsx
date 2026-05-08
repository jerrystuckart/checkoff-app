import React, { useState, useEffect, useRef } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Animated, Linking, ScrollView,
} from 'react-native'
import * as Location from 'expo-location'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import { supabase } from '../lib/supabase'

const AMBER  = '#F5A623'
const NAVY   = '#1A1A2E'
const PURPLE = '#8B5CF6'
const PURPLE_DIM = 'rgba(139,92,246,0.15)'
const PURPLE_BORDER = 'rgba(139,92,246,0.35)'

const DEFAULT_RADIUS_M = 150

/**
 * SecretRevealScreen
 *
 * Shown when a user taps a secret item on ListScreen or NearbyScreen.
 * Checks GPS proximity to the item's coordinates.
 * If close enough → reveal animation → show secret_reveal_text → navigate to PhotoCheckIn.
 */
export default function SecretRevealScreen({ route, navigation }) {
  const { item, listItemId } = route?.params ?? {}
  const insets = useSafeAreaInsets()

  const [phase, setPhase]           = useState('checking')
  const [distance, setDistance]     = useState(null)
  const [permDenied, setPermDenied] = useState(false)
  const [partnerName, setPartnerName] = useState(null)

  const glowAnim   = useRef(new Animated.Value(0)).current
  const revealAnim = useRef(new Animated.Value(0)).current
  const pulseAnim  = useRef(new Animated.Value(1)).current
  const scaleAnim  = useRef(new Animated.Value(0.7)).current

  // Support both snake_case (useNearby) and camelCase (useItems) field names
  const itemLat        = item?.maps_lat    ?? item?.mapsLat    ?? null
  const itemLng        = item?.maps_lng    ?? item?.mapsLng    ?? null
  const requiredRadius = item?.geo_radius_m ?? item?.geoRadiusM ?? DEFAULT_RADIUS_M
  const watchRef       = useRef(null)
  const revealedRef    = useRef(false)

  // The actual challenge text — check both naming conventions since the item
  // object comes from useNearby (snake_case) or useItems (camelCase)
  const revealText = item?.secret_reveal_text ?? item?.secretRevealText ?? item?.body ?? 'Complete this secret challenge!'

  // Best available name to show before the reveal — tells the user WHERE to go
  // without exposing the challenge. partnerName loads async; item.partnerName
  // arrives immediately if the item came from useItems/useNearby (after today's changes).
  const locationHint = partnerName ?? item?.partnerName ?? item?.neighborhoodName ?? null

  useEffect(() => {
    startWatching()
    // Fetch partner/business name if item has a partner_id
    if (item?.partner_id) {
      supabase
        .from('partners')
        .select('business_name')
        .eq('id', item.partner_id)
        .single()
        .then(({ data }) => { if (data?.business_name) setPartnerName(data.business_name) })
    }
    return () => {
      if (watchRef.current) watchRef.current.remove()
    }
  }, [])

  useEffect(() => {
    if (phase === 'checking' || phase === 'tooFar') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.08, duration: 900, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1,    duration: 900, useNativeDriver: true }),
        ])
      ).start()
    } else {
      pulseAnim.stopAnimation(() => pulseAnim.setValue(1))
    }
  }, [phase])

  async function startWatching() {
    setPhase('checking')
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') {
        setPermDenied(true)
        setPhase('error')
        return
      }

      if (!itemLat || !itemLng) {
        // No coordinates set for this item — reveal immediately
        triggerReveal()
        return
      }

      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      handlePosition(loc.coords)

      watchRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 10, timeInterval: 3000 },
        (newLoc) => handlePosition(newLoc.coords)
      )
    } catch {
      setPhase('error')
    }
  }

  function handlePosition(coords) {
    if (revealedRef.current) return
    const dist = haversineDistance(coords.latitude, coords.longitude, itemLat, itemLng)
    setDistance(Math.round(dist))
    if (dist <= requiredRadius) {
      revealedRef.current = true
      if (watchRef.current) { watchRef.current.remove(); watchRef.current = null }
      triggerReveal()
    } else {
      setPhase('tooFar')
    }
  }

  function checkProximity() {
    revealedRef.current = false
    if (watchRef.current) watchRef.current.remove()
    startWatching()
  }

  function triggerReveal() {
    setPhase('revealed')
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    Animated.sequence([
      Animated.spring(scaleAnim, { toValue: 1, friction: 5, tension: 60, useNativeDriver: true }),
      Animated.timing(glowAnim,  { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(revealAnim,{ toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start()
  }

  function proceedToCheckIn() {
    navigation.replace('PhotoCheckIn', {
      item: { ...item, body: revealText },
      listItemId,
    })
  }

  function openDirections() {
    if (itemLat && itemLng) {
      const url = `maps://?daddr=${itemLat},${itemLng}&dirflg=d`
      Linking.canOpenURL(url).then(ok =>
        Linking.openURL(ok ? url : `https://www.google.com/maps/dir/?api=1&destination=${itemLat},${itemLng}`).catch(() => {})
      )
    } else if (item?.maps_query) {
      const encoded = encodeURIComponent(item.maps_query)
      Linking.canOpenURL(`maps://?q=${encoded}`).then(ok =>
        Linking.openURL(ok ? `maps://?q=${encoded}` : `https://maps.google.com/?q=${encoded}`).catch(() => {})
      )
    }
  }

  // ── Checking ──
  if (phase === 'checking') {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 40 }]}>
        <Animated.View style={[styles.lockCircle, { transform: [{ scale: pulseAnim }] }]}>
          <Text style={styles.lockIcon}>🔒</Text>
        </Animated.View>
        {locationHint && (
          <Text style={styles.locationHint}>{locationHint}</Text>
        )}
        <Text style={styles.title}>Checking your location</Text>
        <Text style={styles.sub}>Stand by while we confirm you're at the right spot…</Text>
        <ActivityIndicator color={AMBER} style={{ marginTop: 24 }} />
      </View>
    )
  }

  // ── Too far ──
  if (phase === 'tooFar') {
    const distLabel = distance !== null
      ? distance >= 1000 ? `${(distance / 1000).toFixed(1)} km away` : `${distance}m away`
      : 'You need to be closer'

    const canGetDirections = !!(item?.maps_query || (itemLat && itemLng))

    return (
      <View style={[styles.container, { paddingTop: insets.top + 40 }]}>
        <Animated.View style={[styles.lockCircle, { transform: [{ scale: pulseAnim }] }]}>
          <Text style={styles.lockIcon}>🔒</Text>
        </Animated.View>

        {locationHint && (
          <Text style={styles.locationHint}>{locationHint}</Text>
        )}

        <Text style={styles.title}>Get closer to unlock</Text>
        <Text style={styles.sub}>
          Head {locationHint ? `to ${locationHint}` : 'to this location'} — the secret challenge
          reveals automatically when you're within {requiredRadius}m.
        </Text>

        <View style={styles.distCard}>
          <Text style={styles.distValue}>{distLabel}</Text>
          <Text style={styles.distMeta}>
            {locationHint ? `from ${locationHint}` : 'from this location'}
          </Text>
        </View>

        {canGetDirections && (
          <TouchableOpacity style={styles.directionsBtn} onPress={openDirections} activeOpacity={0.88}>
            <Text style={styles.directionsBtnText}>
              ⌖  Get directions{locationHint ? ` to ${locationHint}` : ''}
            </Text>
          </TouchableOpacity>
        )}

        <View style={styles.trackingBadge}>
          <View style={styles.trackingDot} />
          <Text style={styles.trackingText}>Tracking your location live</Text>
        </View>

        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
          <Text style={styles.backBtnText}>← Back to list</Text>
        </TouchableOpacity>
      </View>
    )
  }

  // ── Error / permission denied ──
  if (phase === 'error') {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 40 }]}>
        <View style={styles.lockCircle}>
          <Text style={styles.lockIcon}>📍</Text>
        </View>
        <Text style={styles.title}>{permDenied ? 'Location access needed' : 'Location unavailable'}</Text>
        <Text style={styles.sub}>
          {permDenied
            ? 'CheckOff needs location access to verify you\'re at the right spot.'
            : 'We couldn\'t get your location. Make sure location services are on.'}
        </Text>
        {permDenied && (
          <TouchableOpacity style={styles.directionsBtn} onPress={() => Linking.openURL('app-settings:')} activeOpacity={0.88}>
            <Text style={styles.directionsBtnText}>Open Settings</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.retryBtn} onPress={checkProximity} activeOpacity={0.88}>
          <Text style={styles.retryBtnText}>Try again</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
          <Text style={styles.backBtnText}>← Back to list</Text>
        </TouchableOpacity>
      </View>
    )
  }

  // ── Revealed ──
  return (
    <View style={styles.revealContainer}>
      {/* Purple glow fills the whole background */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.revealBg, { opacity: glowAnim }]} pointerEvents="none" />

      <ScrollView
        contentContainerStyle={[styles.revealScroll, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: revealAnim, transform: [{ scale: scaleAnim }], alignSelf: 'stretch' }}>

          {/* Top nav: back button left, badge centered */}
          <View style={styles.topNavRow}>
            <TouchableOpacity style={styles.topBackBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
              <Text style={styles.topBackBtnText}>← Back</Text>
            </TouchableOpacity>
            <View style={styles.unlockedBadge}>
              <Text style={styles.unlockedBadgeText}>🔓  Secret unlocked</Text>
            </View>
            <View style={{ flex: 1 }} />
          </View>

          {/* Big unlock icon */}
          <View style={styles.unlockIconWrap}>
            <Text style={styles.unlockEmoji}>⭐</Text>
          </View>

          {/* Business name */}
          {partnerName && (
            <Text style={styles.businessName}>{partnerName}</Text>
          )}

          {/* Location / neighborhood */}
          {(item?.neighborhoodName || item?.maps_query) && (
            <Text style={styles.locationLine}>
              📍 {item.maps_query ?? item.neighborhoodName}
            </Text>
          )}

          {/* Divider */}
          <View style={styles.divider} />

          {/* The actual challenge */}
          <Text style={styles.challengeLabel}>Your secret challenge</Text>
          <Text style={styles.challengeText}>{revealText}</Text>

          {/* Points */}
          <View style={styles.pointsRow}>
            <View style={styles.pointsBadge}>
              <Text style={styles.pointsNum}>{item?.difficulty ?? 25}</Text>
              <Text style={styles.pointsPts}>pts</Text>
            </View>
            <Text style={styles.pointsDesc}>Photo proof required to claim your points</Text>
          </View>

          {/* Directions if available */}
          {item?.maps_query && (
            <TouchableOpacity style={styles.directionsCard} onPress={openDirections} activeOpacity={0.88}>
              <Text style={styles.directionsCardText}>⌖  Get directions to {partnerName ?? item.maps_query}</Text>
            </TouchableOpacity>
          )}

          {/* CTA */}
          <TouchableOpacity style={styles.checkOffBtn} onPress={proceedToCheckIn} activeOpacity={0.88}>
            <Text style={styles.checkOffBtnText}>📷  Check this off with photo</Text>
          </TouchableOpacity>

        </Animated.View>
      </ScrollView>
    </View>
  )
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R    = 6371000
  const phi1 = lat1 * Math.PI / 180
  const phi2 = lat2 * Math.PI / 180
  const dPhi = (lat2 - lat1) * Math.PI / 180
  const dLam = (lon2 - lon1) * Math.PI / 180
  const a    = Math.sin(dPhi/2)**2 + Math.cos(phi1)*Math.cos(phi2)*Math.sin(dLam/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0F1E',
    alignItems: 'center',
    padding: 24,
  },

  // ── Pre-reveal states ──
  lockCircle: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: PURPLE_DIM,
    borderWidth: 1, borderColor: PURPLE_BORDER,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 24,
  },
  lockIcon: { fontSize: 40 },

  locationHint: {
    fontSize: 22, fontWeight: '800', color: '#fff',
    textAlign: 'center', marginBottom: 10, letterSpacing: -0.3,
  },

  title: { fontSize: 24, fontWeight: '800', color: '#fff', textAlign: 'center', marginBottom: 12 },
  sub:   { fontSize: 14, color: 'rgba(255,255,255,0.5)', textAlign: 'center', lineHeight: 21, marginBottom: 24, paddingHorizontal: 16 },

  distCard: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16, padding: 20,
    alignItems: 'center', marginBottom: 20,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', width: '100%',
  },
  distValue: { fontSize: 32, fontWeight: '800', color: AMBER },
  distMeta:  { fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 4, fontWeight: '600' },

  directionsBtn: {
    backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 14,
    paddingVertical: 16, paddingHorizontal: 24,
    alignItems: 'center', marginBottom: 10, width: '100%',
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.12)',
  },
  directionsBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },

  retryBtn:     { backgroundColor: AMBER, borderRadius: 14, paddingVertical: 16, alignItems: 'center', width: '100%', marginBottom: 10 },
  retryBtnText: { fontSize: 15, fontWeight: '800', color: NAVY },

  backBtn:     { paddingVertical: 14, alignItems: 'center', width: '100%' },
  backBtnText: { fontSize: 14, color: 'rgba(255,255,255,0.35)', fontWeight: '600' },

  trackingBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 999, backgroundColor: 'rgba(29,158,117,0.15)', borderWidth: 1, borderColor: 'rgba(29,158,117,0.3)' },
  trackingDot:   { width: 7, height: 7, borderRadius: 4, backgroundColor: '#1D9E75' },
  trackingText:  { fontSize: 12, color: '#1D9E75', fontWeight: '700' },

  // ── Revealed state ──
  revealContainer: { flex: 1, backgroundColor: '#0F0F1E' },

  revealBg: { backgroundColor: PURPLE, opacity: 0 },

  revealScroll: {
    alignItems: 'center',
    paddingHorizontal: 24,
  },

  topNavRow: {
    flexDirection: 'row', alignItems: 'center',
    width: '100%', marginBottom: 24,
  },
  topBackBtn: { flex: 1, paddingVertical: 6 },
  topBackBtnText: { fontSize: 15, color: 'rgba(255,255,255,0.55)', fontWeight: '700' },

  unlockedBadge: {
    backgroundColor: 'rgba(139,92,246,0.2)',
    borderRadius: 999, paddingHorizontal: 20, paddingVertical: 9,
    borderWidth: 1, borderColor: PURPLE_BORDER,
  },
  unlockedBadgeText: { fontSize: 16, fontWeight: '800', color: '#D4BBFF', letterSpacing: 0.3 },

  unlockIconWrap: {
    width: 110, height: 110, borderRadius: 55,
    backgroundColor: 'rgba(139,92,246,0.2)',
    borderWidth: 2, borderColor: 'rgba(139,92,246,0.5)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 20,
    shadowColor: PURPLE, shadowOpacity: 0.6, shadowRadius: 30, shadowOffset: { width: 0, height: 0 },
  },
  unlockEmoji: { fontSize: 52 },

  businessName: {
    fontSize: 28, fontWeight: '900', color: '#fff',
    textAlign: 'center', letterSpacing: -0.5,
    marginBottom: 6,
  },

  locationLine: {
    fontSize: 17, color: 'rgba(255,255,255,0.7)',
    textAlign: 'center', fontWeight: '600', marginBottom: 24,
  },

  divider: {
    width: '100%', height: 1,
    backgroundColor: 'rgba(139,92,246,0.25)',
    marginBottom: 24,
  },

  challengeLabel: {
    fontSize: 11, fontWeight: '800',
    color: 'rgba(139,92,246,0.8)',
    textTransform: 'uppercase', letterSpacing: 1.5,
    textAlign: 'center', marginBottom: 14,
  },

  challengeText: {
    fontSize: 26, fontWeight: '800', color: '#fff',
    textAlign: 'center', lineHeight: 34,
    marginBottom: 28, paddingHorizontal: 4,
  },

  pointsRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginBottom: 24, width: '100%',
    backgroundColor: 'rgba(139,92,246,0.1)',
    borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: PURPLE_BORDER,
  },
  pointsBadge: {
    flexDirection: 'row', alignItems: 'baseline', gap: 2,
    backgroundColor: 'rgba(139,92,246,0.2)',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: PURPLE_BORDER,
  },
  pointsNum:  { fontSize: 24, fontWeight: '900', color: '#D4BBFF' },
  pointsPts:  { fontSize: 12, fontWeight: '700', color: '#D4BBFF' },
  pointsDesc: { fontSize: 15, color: 'rgba(255,255,255,0.7)', flex: 1, fontWeight: '600', lineHeight: 22 },

  directionsCard: {
    width: '100%', backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 14, paddingVertical: 15, paddingHorizontal: 20,
    alignItems: 'center', marginBottom: 14,
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.12)',
  },
  directionsCardText: { fontSize: 14, fontWeight: '700', color: 'rgba(255,255,255,0.75)' },

  checkOffBtn: {
    width: '100%', backgroundColor: AMBER,
    borderRadius: 16, paddingVertical: 19,
    alignItems: 'center', marginBottom: 12,
    shadowColor: AMBER, shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 4 },
  },
  checkOffBtnText: { fontSize: 17, fontWeight: '800', color: NAVY, paddingHorizontal: 16 },
})
