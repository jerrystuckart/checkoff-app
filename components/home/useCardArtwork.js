// Archetype Fallback Artwork V1 (2026-09-17) — the one hook every
// image-capable Home card (EditorialCard.jsx, WhatsTheThingHero.jsx) uses
// to decide what to render. Wraps the pure lib/artworkResolution.js
// decision with the bit of React state that decision needs at the
// component layer: "has the CURRENT candidate url already failed to
// load," reset whenever the item changes so a failure never leaks across
// items.
//
// Returns a photo-shaped `{ url }` regardless of whether the url is a
// real approved photo or resolved archetype artwork — existing render
// branches that used to do `image ? <PhotoMode/> : <NoImageMode/>` keep
// working unchanged; they just also light up for archetype art now. Only
// `isArchetype`/`onError` need to be threaded through so a failed
// archetype load can fall back to the existing no-image treatment
// without an infinite retry loop.
import { useState, useEffect } from 'react'
import { resolveArtworkTier } from '../../lib/artworkResolution'
import { currentRotationContext } from '../../lib/rotationContext'

/**
 * @param {object} item
 * @param {string|null} [userId]
 * @returns {{
 *   url: string|null,
 *   isPhoto: boolean,
 *   isArchetype: boolean,
 *   isGeneric: boolean,
 *   archetypeKey: string|null,
 *   onError: (() => void)|undefined,
 * }}
 */
export function useCardArtwork(item, userId = null) {
  const [failedUrl, setFailedUrl] = useState(null)
  const imageContext = currentRotationContext(userId)

  // Reset the failure flag whenever the item itself changes — otherwise a
  // failure recorded for one item's archetype url would incorrectly
  // suppress a DIFFERENT item's freshly-resolved (but coincidentally
  // matching) tier on re-render.
  useEffect(() => {
    setFailedUrl(null)
  }, [item?.id])

  const provisional = resolveArtworkTier(item, { imageContext, imageFailed: false })
  const imageFailed = provisional.tier === 'archetype' && failedUrl === provisional.url
  const resolved = resolveArtworkTier(item, { imageContext, imageFailed })

  return {
    url: resolved.url,
    isPhoto: resolved.tier === 'photo',
    isArchetype: resolved.tier === 'archetype',
    isGeneric: resolved.tier === 'generic',
    archetypeKey: resolved.archetypeKey,
    onError: resolved.tier === 'archetype' ? () => setFailedUrl(resolved.url) : undefined,
  }
}
