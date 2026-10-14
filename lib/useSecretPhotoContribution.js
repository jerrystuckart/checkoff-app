// Photo-contribution CTA eligibility for the Secret CheckOff screen.
//
// This is the SAME rule the normal item detail uses (useCoverCandidateCTA ->
// isCoverCandidateEligible: flag on, signed in, at the place per
// isAtPlace(), no approved image yet, no pending submission). It is just the
// detail screen's own inputs gathered for SecretRevealScreen.
//
// The approved-image lookups below exist ONLY to answer "does this item
// already have an approved photo?" for eligibility. Their URLs are never
// returned, never rendered: the locked screen's background comes exclusively
// from the dedicated business photo (lib/secretBusinessPhoto.js).
import { useEffect, useMemo, useState } from 'react'
import * as Location from 'expo-location'
import { supabase } from './supabase'
import { isAtPlace } from './whatsGoodAtPlace'
import { useCoverCandidateCTA } from './useCoverCandidateCTA'
import { fetchActiveCoverImageUrl, fetchDisplayEligibleImagePool } from './coverCandidates'

/**
 * @param {object} params
 * @param {object|null} params.item
 * @param {any} [params.refreshKey]  re-reads the last known position when it changes (e.g. screen phase)
 * @returns {boolean} show the existing CoverCandidateCTA
 */
export function useSecretPhotoContribution({ item, refreshKey }) {
  const [userId, setUserId] = useState(null)
  const [userLocation, setUserLocation] = useState(null)
  const [pool, setPool] = useState(null)
  const [activeCoverUrl, setActiveCoverUrl] = useState(null)

  useEffect(() => {
    let cancelled = false
    supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setUserId(data?.user?.id ?? null)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Same read the normal detail screen uses for its at-place check.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync()
        if (status !== 'granted') return
        const pos = await Location.getLastKnownPositionAsync({}).catch(() => null)
        if (!cancelled && pos?.coords) {
          setUserLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude })
        }
      } catch {
        // location unavailable — the CTA simply won't show
      }
    })()
    return () => { cancelled = true }
  }, [refreshKey])

  useEffect(() => {
    let cancelled = false
    if (!item?.id) return undefined
    fetchDisplayEligibleImagePool({ itemId: item.id }).then((p) => {
      if (!cancelled && p?.length > 0) setPool(p)
    }).catch(() => {})
    fetchActiveCoverImageUrl({ itemId: item.id }).then((url) => {
      if (!cancelled && url) setActiveCoverUrl(url)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [item?.id])

  // Mirrors ItemDetailScreen's `resolvedItem` merge.
  const eligibilityItem = useMemo(() => (item ? {
    ...item,
    ...(activeCoverUrl ? { activeCoverImageUrl: activeCoverUrl } : null),
    ...(pool ? { displayEligibleImages: pool } : null),
  } : null), [item, activeCoverUrl, pool])

  return useCoverCandidateCTA({ userId, item: eligibilityItem, isAtPlace: isAtPlace(item, userLocation) })
}
