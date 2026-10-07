import React, { useState, useEffect, useRef } from 'react'
import {
  Platform,
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Animated, Linking, ScrollView, Image, Share,
} from 'react-native'
import * as Location from 'expo-location'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import { supabase } from '../lib/supabase'
import { trackEvent } from '../lib/trackEvent'
import { haversineMeters } from '../lib/distance'
import { useSavedItems } from '../lib/SavedItemsContext'
import { useCardArtwork } from '../components/home/useCardArtwork'
import BookmarkIcon from '../components/BookmarkIcon'
import { buildInviteMessage, buildSecretInviteMessage } from '../lib/inviteMessage'
import { itemHasLocation, itemHasWebsite, openItemDirections, openItemWebsite } from '../lib/itemUtilityActions'

const AMBER  = '#F5A623'
const NAVY   = '#1A1A2E'
const PURPLE = '#8B5CF6'
const PURPLE_DIM = 'rgba(139,92,246,0.15)'
const PURPLE_BORDER = 'rgba(139,92,246,0.35)'

const DEFAULT_RADIUS_M = 150

// Code-drawn padlock (no icon library in this app, no new art dependency).
function LockGlyph() {
  return (
    <View style={styles.lockGlyph}>
      <View style={styles.lockShackle} />
      <View style={styles.lockBody}><View style={styles.lockKeyhole} /></View>
    </View>
  )
}

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
  // Same saved-items context + toggle the normal item detail uses; it also
  // owns the guest sign-in prompt, so no auth handling is duplicated here.
  const { isSaved, toggleSaved } = useSavedItems()
  // Only ever rendered heavily blurred + darkened below, never as-is.
  const artwork = useCardArtwork(item, null)

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

  async function openAppSettings() {
    try {
      if (Platform.OS === 'ios') {
        await Linking.openURL('app-settings:')
      } else {
        await Linking.openSettings()
      }
    } catch (e) {
      console.warn('openAppSettings failed:', e?.message ?? e)
    }
  }

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
    const dist = haversineMeters(coords.latitude, coords.longitude, itemLat, itemLng)
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

  // Directions / Website open the exact same links as the normal item detail
  // (lib/itemUtilityActions.js); both stay available while locked.
  const hasLoc = itemHasLocation(item)
  const hasWeb = itemHasWebsite(item)

  function openDirections() {
    if (item?.id) trackEvent('directions_click', { itemId: item.id })
    openItemDirections(item)
  }

  function openWebsite() {
    if (!item?.website_url) return
    trackEvent('url_click', { itemId: item.id })
    openItemWebsite(item)
  }

  // While locked the message names only the venue and the item deep link —
  // never the body/challenge. Once revealed it is the normal invite message.
  async function shareItem() {
    const message = phase === 'revealed'
      ? buildInviteMessage({ itemBody: revealText, itemId: item?.id })
      : buildSecretInviteMessage({ venueName: locationHint, itemId: item?.id })
    try {
      await Share.share({ message, title: 'CheckOff invite' })
    } catch (e) {}
  }

  const saved = !!item?.id && isSaved(item.id)

  function renderUtilityRow() {
    return (
      <View style={styles.utilityRow}>
        {hasLoc && (
          <TouchableOpacity style={styles.utilityBtn} onPress={openDirections} activeOpacity={0.8}
            accessibilityRole="button" accessibilityLabel="Get directions">
            <Text style={styles.utilityBtnIcon}>⌖</Text>
            <Text style={styles.utilityBtnText}>Directions</Text>
          </TouchableOpacity>
        )}
        {hasWeb && (
          <TouchableOpacity style={styles.utilityBtn} onPress={openWebsite} activeOpacity={0.8}
            accessibilityRole="button" accessibilityLabel="Visit website">
            <Text style={styles.utilityBtnIcon}>↗</Text>
            <Text style={styles.utilityBtnText}>Website</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.utilityBtn}
          onPress={() => { if (item?.id) toggleSaved(item.id, navigation) }}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityState={{ selected: saved }}
          accessibilityLabel={saved ? 'Remove from Saved' : 'Save'}
        >
          <BookmarkIcon filled={saved} color={AMBER} size={18} />
          <Text style={styles.utilityBtnText}>{saved ? 'Saved' : 'Save'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.utilityBtn} onPress={shareItem} activeOpacity={0.8}
          accessibilityRole="button" accessibilityLabel="Share">
          <Text style={styles.utilityBtnIcon}>⇪</Text>
          <Text style={styles.utilityBtnText}>Share</Text>
        </TouchableOpacity>
      </View>
    )
  }

  // Shared locked layout for 'checking' and 'tooFar'. Reveals nothing about
  // the secret: no body/challenge text, and the photo (if any) is blurred.
  function renderLocked(statusNode) {
    const radius = requiredRadius
    const venue = locationHint
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: '#0F0F1E' }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.lockedHero, { paddingTop: insets.top + 24 }]}>
          {artwork.isPhoto && artwork.url ? (
            <Image source={{ uri: artwork.url }} blurRadius={45} resizeMode="cover"
              style={StyleSheet.absoluteFill} accessibilityIgnoresInvertColors />
          ) : null}
          <View style={[StyleSheet.absoluteFill, { backgroundColor: artwork.isPhoto ? 'rgba(15,15,30,0.62)' : 'rgba(139,92,246,0.22)' }]} />
          <View style={styles.lockedHeroFade} />
          <Animated.View style={[styles.lockCircle, { transform: [{ scale: pulseAnim }] }]}>
            <LockGlyph />
          </Animated.View>
          <View style={styles.secretPill}><Text style={styles.secretPillText}>SECRET CHECKOFF</Text></View>
        </View>

        <View style={styles.lockedBody}>
          {venue ? <Text style={styles.lockedVenue}>{venue}</Text> : null}
          <Text style={styles.lockedHeadline}>There's something here for you to unlock.</Text>
          <Text style={styles.lockedSub}>
            Get within {radius}m of {venue ?? 'this spot'} and we'll reveal the CheckOff.
          </Text>

          <View style={styles.statusCard}>
            {distance !== null && phase === 'tooFar' ? (
              <Text style={styles.distValue}>
                {distance >= 1000 ? `${(distance / 1000).toFixed(1)} km away` : `${distance}m away`}
              </Text>
            ) : null}
            {statusNode}
          </View>

          {renderUtilityRow()}

          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
            <Text style={styles.backBtnText}>← Back to list</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    )
  }

  // ── Checking ──
  if (phase === 'checking') {
    return renderLocked(
      <View style={styles.trackingBadge}>
        <ActivityIndicator size="small" color="#1D9E75" />
        <Text style={styles.trackingText}>Checking your location…</Text>
      </View>
    )
  }

  // ── Too far ──
  if (phase === 'tooFar') {
    return renderLocked(
      <View style={styles.trackingBadge}>
        <View style={styles.trackingDot} />
        <Text style={styles.trackingText}>Watching for your arrival</Text>
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
          <TouchableOpacity style={styles.directionsBtn} onPress={openAppSettings} activeOpacity={0.88}>
            <Text style={styles.directionsBtnText}>Open Settings</Text>
          </TouchableOpacity>
        )}
        {renderUtilityRow()}
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

          {renderUtilityRow()}

          {/* CTA */}
          <TouchableOpacity style={styles.checkOffBtn} onPress={proceedToCheckIn} activeOpacity={0.88}>
            <Text style={styles.checkOffBtnText}>📷  Check this off with photo</Text>
          </TouchableOpacity>

        </Animated.View>
      </ScrollView>
    </View>
  )
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
  distValue: { fontSize: 30, fontWeight: '800', color: AMBER },
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

  lockedHero: {
    height: 280, alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', backgroundColor: '#1B1433',
  },
  lockedHeroFade: {
    position: 'absolute', left: 0, right: 0, bottom: 0, height: 90,
    backgroundColor: 'rgba(15,15,30,0.55)',
  },
  secretPill: {
    marginTop: 4, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999,
    backgroundColor: 'rgba(139,92,246,0.25)', borderWidth: 1, borderColor: PURPLE_BORDER,
  },
  secretPillText: { fontSize: 11, fontWeight: '800', color: '#D4BBFF', letterSpacing: 1.5 },
  lockedBody: { paddingHorizontal: 24, paddingTop: 22 },
  lockedVenue: {
    fontSize: 30, fontWeight: '900', color: '#fff', letterSpacing: -0.6,
    textAlign: 'center', marginBottom: 8,
  },
  lockedHeadline: {
    fontSize: 17, fontWeight: '700', color: '#D4BBFF', textAlign: 'center', marginBottom: 8,
  },
  lockedSub: {
    fontSize: 14, color: 'rgba(255,255,255,0.6)', textAlign: 'center',
    lineHeight: 21, marginBottom: 18, paddingHorizontal: 8,
  },
  statusCard: {
    alignItems: 'center', gap: 10, paddingVertical: 14, paddingHorizontal: 16,
    borderRadius: 16, marginBottom: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)',
  },
  lockGlyph: { alignItems: 'center' },
  lockShackle: {
    width: 22, height: 18, borderTopLeftRadius: 11, borderTopRightRadius: 11,
    borderWidth: 3.5, borderBottomWidth: 0, borderColor: '#E9DDFF', marginBottom: -2,
  },
  lockBody: {
    width: 34, height: 26, borderRadius: 7, backgroundColor: '#E9DDFF',
    alignItems: 'center', justifyContent: 'center',
  },
  lockKeyhole: { width: 6, height: 9, borderRadius: 3, backgroundColor: '#4B2FA0' },

  utilityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14, width: '100%' },
  utilityBtn: {
    flex: 1, minWidth: 72, alignItems: 'center', gap: 6,
    paddingVertical: 14, paddingHorizontal: 8, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  utilityBtnIcon: { fontSize: 19, color: AMBER },
  utilityBtnText: { fontSize: 12, fontWeight: '800', color: '#fff', textAlign: 'center' },

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
