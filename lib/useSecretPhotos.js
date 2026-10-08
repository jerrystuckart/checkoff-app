// Photos for the Secret CheckOff screens, one hook per state so the two
// sources can never be mixed up:
//   useLockedSecretPhoto   -> the dedicated business photo ONLY.
//   useUnlockedSecretPhoto -> the optional admin reveal image, else the approved experience photo pool / selected
//                             cover (display_eligible / status 'selected'
//                             only — pending and rejected submissions are
//                             not readable through these fetchers), fetched
//                             only once the secret is unlocked.
// Both sign fresh URLs and refresh them (lib/useRefreshingPhoto.js).
import { useCallback, useEffect, useState } from 'react'
import { fetchSecretBusinessPhotoUrl } from './secretBusinessPhoto'
import { fetchSecretRevealImage } from './secretRevealImage'
import { fetchActiveCoverImageUrl, fetchDisplayEligibleImagePool } from './coverCandidates'
import { currentRotationContext } from './rotationContext'
import { usePhotoVersion } from './photoRefresh'
import { useRefreshingPhoto } from './useRefreshingPhoto'

export function useLockedSecretPhoto(itemId) {
  const fetcher = useCallback(() => fetchSecretBusinessPhotoUrl({ itemId }), [itemId])
  const { value, reportError } = useRefreshingPhoto(fetcher, { enabled: !!itemId, resetKey: itemId })
  return { businessPhotoUrl: value, reportBusinessPhotoError: reportError }
}

export function useUnlockedSecretPhoto({ itemId, enabled, userId = null }) {
  const photoVersion = usePhotoVersion()
  const fetcher = useCallback(async () => {
    const [pool, activeCoverUrl, revealImage] = await Promise.all([
      fetchDisplayEligibleImagePool({ itemId }).catch(() => []),
      fetchActiveCoverImageUrl({ itemId }).catch(() => null),
      fetchSecretRevealImage({ itemId }),
    ])
    return { pool, activeCoverUrl, revealImageUrl: revealImage?.url ?? null, revealFocus: revealImage?.focus ?? null }
  }, [itemId])
  const { value, reportError } = useRefreshingPhoto(fetcher, {
    enabled: !!itemId && !!enabled,
    resetKey: `${itemId}:${photoVersion}`,
  })
  const [imageContext, setImageContext] = useState(() => currentRotationContext(userId))
  useEffect(() => { setImageContext(currentRotationContext(userId)) }, [userId])
  return {
    pool: value?.pool ?? null,
    activeCoverUrl: value?.activeCoverUrl ?? null,
    revealImageUrl: value?.revealImageUrl ?? null,
    revealFocus: value?.revealFocus ?? null,
    imageContext,
    reportApprovedPhotoError: reportError,
  }
}
