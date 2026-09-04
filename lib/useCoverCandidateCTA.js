// Community Cover Photos V1 — resolves whether the contribution CTA should
// show for a given at-place item. Wraps the pure
// lib/coverCandidateEligibility.js rule with the async lookups it needs
// (flag state, pending-submission check) — mirrors the existing
// hook-owns-policy / lib-stays-pure split already used by
// useWhatsGood.js + whatsGoodOrchestrator.js and
// useAtPlaceReminder.js + atPlaceReminder.js.

import { useEffect, useState } from 'react'
import { isFlagEnabled } from './featureFlags'
import { hasPendingCoverCandidate } from './coverCandidates'
import { resolvedItemImages } from './whatsGoodImageSource'
import { isCoverCandidateEligible } from './coverCandidateEligibility'

/**
 * @param {object} params
 * @param {string|null} params.userId
 * @param {object|null} params.item  the candidate item — null means "not eligible"
 * @param {boolean} [params.isAtPlace]  defaults to true for callers that
 *   only ever pass the already-confirmed at-place item (e.g.
 *   WhatsTheThingHero's whatsGood.atPlaceItem). Callers that render this
 *   CTA somewhere NOT gated on at-place by construction (e.g.
 *   ItemDetailScreen, which must compute its own live at-place check)
 *   pass this explicitly.
 * @returns {boolean}
 */
export function useCoverCandidateCTA({ userId, item, isAtPlace = true }) {
  const [eligible, setEligible] = useState(false)

  useEffect(() => {
    if (!userId || !item || !isAtPlace) {
      setEligible(false)
      return undefined
    }
    let cancelled = false

    ;(async () => {
      const flagEnabled = await isFlagEnabled(userId, 'community_cover_photos')
      if (!flagEnabled) {
        if (!cancelled) setEligible(false)
        return
      }

      // Multi-Image Rotation (2026-09-03) — "no CTA once an image exists"
      // must mean the whole display-eligible POOL, not just whichever one
      // entry the deterministic resolver happens to pick this render;
      // otherwise a 2nd/3rd approved image would incorrectly still show
      // the "help us find a photo" prompt.
      const hasApprovedImage = resolvedItemImages(item).length > 0
      const isSecret = Boolean(item.is_secret ?? item.isSecret)
      const hasPendingSubmission = await hasPendingCoverCandidate({ userId, itemId: item.id })
      if (cancelled) return

      const result = isCoverCandidateEligible({
        isAtPlace,
        hasApprovedImage,
        isSecret,
        hasPendingSubmission,
        flagEnabled,
      })
      setEligible(result.eligible)
    })()

    return () => {
      cancelled = true
    }
  }, [userId, item?.id, isAtPlace])

  return eligible
}
