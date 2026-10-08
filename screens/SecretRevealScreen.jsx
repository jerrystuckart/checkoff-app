import React, { useState, useEffect, useRef, useContext } from 'react'
import { Platform, Linking, Share, AccessibilityInfo, useWindowDimensions } from 'react-native'
import * as Location from 'expo-location'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs'
import * as Haptics from 'expo-haptics'
import { supabase } from '../lib/supabase'
import { trackEvent } from '../lib/trackEvent'
import { haversineMeters } from '../lib/distance'
import { useSavedItems } from '../lib/SavedItemsContext'
import { useSecretPhotoContribution } from '../lib/useSecretPhotoContribution'
import { useLockedSecretPhoto, useUnlockedSecretPhoto } from '../lib/useSecretPhotos'
import CoverCandidateCTA from '../components/CoverCandidateCTA'
import SecretRevealView from '../components/secret/SecretRevealView'
import { buildInviteMessage, buildSecretInviteMessage } from '../lib/inviteMessage'
import { createProximityGate } from '../lib/secretRevealVisit'
import { itemHasLocation, itemHasWebsite, openItemDirections, openItemWebsite } from '../lib/itemUtilityActions'
import {
  resolveSecretVenue, selectHeroPhoto, lockedStatus, planActions,
  pointsLabel, photoRequirementCopy, descriptionParagraphs,
} from '../lib/secretRevealModel'

const DEFAULT_RADIUS_M = 150

/**
 * SecretRevealScreen
 *
 * Shown when a user taps a secret item on ListScreen or NearbyScreen.
 * Checks GPS proximity to the item's coordinates.
 * If close enough -> reveal -> show secret_reveal_text -> navigate to PhotoCheckIn.
 * Unlocking is NOT completing a CheckOff: completion only happens in
 * PhotoCheckIn. Layout/copy live in components/secret/SecretRevealView.jsx and
 * lib/secretRevealModel.js; this file owns location, navigation and side effects.
 */
export default function SecretRevealScreen({ route, navigation }) {
  const { item, listItemId } = route?.params ?? {}
  const insets = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
  // Defined only when this screen sits inside the bottom tab navigator, whose
  // (non-overlay) bar already covers the home-indicator inset.
  const tabBarHeight = useContext(BottomTabBarHeightContext)

  const [phase, setPhase]           = useState('checking')
  const [distance, setDistance]     = useState(null)
  const [permDenied, setPermDenied] = useState(false)
  const [partnerName, setPartnerName] = useState(null)
  const [userId, setUserId] = useState(null)
  const [reduceMotion, setReduceMotion] = useState(false)
  const reduceMotionRef = useRef(false)
  // Same saved-items context + toggle the normal item detail uses; it also
  // owns the guest sign-in prompt, so no auth handling is duplicated here.
  const { isSaved, toggleSaved } = useSavedItems()

  // Support both snake_case (useNearby) and camelCase (useItems) field names
  const itemLat        = item?.maps_lat    ?? item?.mapsLat    ?? null
  const itemLng        = item?.maps_lng    ?? item?.mapsLng    ?? null
  const requiredRadius = item?.geo_radius_m ?? item?.geoRadiusM ?? DEFAULT_RADIUS_M
  const watchRef       = useRef(null)
  // One gate per screen visit (fresh on every opening; never persisted).
  const gateRef        = useRef(createProximityGate())

  // The actual challenge text — check both naming conventions since the item
  // object comes from useNearby (snake_case) or useItems (camelCase)
  const revealText = item?.secret_reveal_text ?? item?.secretRevealText ?? item?.body ?? 'Complete this secret challenge!'

  const isRevealed = phase === 'revealed'
  const venue = resolveSecretVenue({ item, fetchedPartnerName: partnerName })

  // Locked: the dedicated business photo ONLY (normal covers can depict the
  // secret). Revealed: the approved experience photo, fetched only after the
  // unlock. Both refresh their signed URLs. See lib/secretRevealModel.js.
  const { businessPhotoUrl, reportBusinessPhotoError } = useLockedSecretPhoto(item?.id)
  const unlocked = useUnlockedSecretPhoto({ itemId: item?.id, enabled: isRevealed, userId })
  const heroArgs = {
    itemId: item?.id, businessPhotoUrl, pool: unlocked.pool,
    activeCoverUrl: unlocked.activeCoverUrl, imageContext: unlocked.imageContext,
  }
  const lockedPhoto = selectHeroPhoto({ ...heroArgs, phase: 'locked' })
  const unlockedPhoto = isRevealed ? selectHeroPhoto({ ...heroArgs, phase: 'revealed' }) : null
  const onUnlockedPhotoError = () => (
    unlockedPhoto?.source === 'business' ? reportBusinessPhotoError() : unlocked.reportApprovedPhotoError()
  )

  // Existing photo-contribution CTA, under the normal eligibility rules
  // (at the place, signed in, no approved image, no pending submission).
  const showPhotoCTA = useSecretPhotoContribution({ item, refreshKey: phase })

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
    supabase.auth.getSession().then(({ data }) => setUserId(data?.session?.user?.id ?? null)).catch(() => {})
    const onMotion = (v) => { reduceMotionRef.current = !!v; setReduceMotion(!!v) }
    AccessibilityInfo.isReduceMotionEnabled().then(onMotion).catch(() => {})
    const motionSub = AccessibilityInfo.addEventListener('reduceMotionChanged', onMotion)
    return () => {
      if (watchRef.current) watchRef.current.remove()
      motionSub?.remove?.()
    }
  }, [])

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
    setPermDenied(false)
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
    const dist = haversineMeters(coords.latitude, coords.longitude, itemLat, itemLng)
    const result = gateRef.current.update(dist, requiredRadius)
    if (result === 'done') return
    setDistance(Math.round(dist))
    if (result === 'reveal') {
      if (watchRef.current) { watchRef.current.remove(); watchRef.current = null }
      triggerReveal()
    } else {
      setPhase('tooFar')
    }
  }

  function checkProximity() {
    gateRef.current.reset()
    if (watchRef.current) watchRef.current.remove()
    startWatching()
  }

  // Plays once per screen visit, when eligibility is first established (already
  // in range on open, or on entering range). Reduce Motion shows the settled
  // reveal immediately (no motion, no haptic). Animation state never affects
  // eligibility; unlocking never completes the item (that is PhotoCheckIn).
  function triggerReveal() {
    setPhase('revealed')
    if (!reduceMotionRef.current) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
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
    const message = isRevealed
      ? buildInviteMessage({ itemBody: revealText, itemId: item?.id })
      : buildSecretInviteMessage({ venueName: venue.venueName, itemId: item?.id })
    try {
      await Share.share({ message, title: 'CheckOff invite' })
    } catch (e) {}
  }

  const saved = !!item?.id && isSaved(item.id)

  const status = lockedStatus({ phase, permDenied, distance, radius: requiredRadius })
  const plan = planActions({ phase: isRevealed ? 'revealed' : 'locked', status, hasLocation: hasLoc, hasWebsite: hasWeb })

  function handlePrimary(id) {
    if (id === 'checkoff') proceedToCheckIn()
    else if (id === 'directions') openDirections()
    else if (id === 'settings') openAppSettings()
    else if (id === 'retry') checkProximity()
  }

  function handleSecondary(id) {
    if (id === 'directions') openDirections()
    else if (id === 'website') openWebsite()
    else if (id === 'save') { if (item?.id) toggleSaved(item.id, navigation) }
    else if (id === 'share') shareItem()
  }

  const heroHeight = Math.round(Math.min(340, Math.max(220, windowHeight * 0.36)))
  const where = venue.venueName ?? 'the spot'

  return (
    <SecretRevealView
      phase={isRevealed ? 'revealed' : 'locked'}
      venueName={venue.venueName}
      area={venue.area}
      lockedBlurb={`Get within ${Math.round(requiredRadius)} m of ${where} and the secret unlocks.`}
      paragraphs={isRevealed ? descriptionParagraphs(revealText) : []}
      status={status}
      pointsText={pointsLabel(item)}
      requirementText={photoRequirementCopy(item).text}
      lockedPhoto={lockedPhoto}
      unlockedPhoto={unlockedPhoto}
      onLockedPhotoError={reportBusinessPhotoError}
      onUnlockedPhotoError={onUnlockedPhotoError}
      plan={plan}
      saved={saved}
      onBack={() => navigation.goBack()}
      onPrimary={handlePrimary}
      onSecondary={handleSecondary}
      photoCTA={showPhotoCTA ? (
        <CoverCandidateCTA
          item={item}
          navigation={navigation}
          colors={{ TEXT: '#fff', MUTED: 'rgba(255,255,255,0.6)', AMBER: '#F5A623' }}
          compact
        />
      ) : null}
      insets={insets}
      footerBottomPad={tabBarHeight ? 14 : insets.bottom + 14}
      heroHeight={heroHeight}
      reduceMotion={reduceMotion}
    />
  )
}
