import { useState, useEffect, useCallback } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { shouldAutoShowExplainer } from './rightHereHeroLogic'

// Right Here Hero redesign (Phase 2/5, 2026-09-22) — one-time explainer for
// the Right Here ("YOU'RE HERE" / "HERE'S THE THING") card. Mirrors
// lib/useOnboarding.js's exact convention: a versioned AsyncStorage key,
// null means never seen, fail open on any storage error (never blocks the
// card from rendering or nags a user who's already dismissed it).
const RIGHT_HERE_EXPLAINER_KEY = 'checkoff_right_here_explainer_v1'

/**
 * useRightHereExplainer()
 *
 * Returns:
 *   - hasSeenExplainer: false only on the very first Right Here render ever
 *     seen by this device; true afterward (and while still loading, so the
 *     explainer never flashes on before the AsyncStorage read resolves).
 *   - dismissExplainer: call when the user dismisses the explainer; persists
 *     so it won't auto-show again.
 *   - checkingExplainer: true while AsyncStorage is being read.
 */
export function useRightHereExplainer() {
  const [hasSeenExplainer, setHasSeenExplainer] = useState(true)
  const [checkingExplainer, setCheckingExplainer] = useState(true)

  useEffect(() => {
    AsyncStorage.getItem(RIGHT_HERE_EXPLAINER_KEY)
      .then(val => {
        setHasSeenExplainer(!shouldAutoShowExplainer(val))
      })
      .catch(() => {
        setHasSeenExplainer(true) // fail open — don't nag on storage error
      })
      .finally(() => {
        setCheckingExplainer(false)
      })
  }, [])

  const dismissExplainer = useCallback(async () => {
    setHasSeenExplainer(true)
    try {
      await AsyncStorage.setItem(RIGHT_HERE_EXPLAINER_KEY, 'done')
    } catch (e) {
      // Non-critical — worst case they see the explainer again next launch
      console.warn('useRightHereExplainer: failed to persist dismissal', e?.message)
    }
  }, [])

  return { hasSeenExplainer, dismissExplainer, checkingExplainer }
}
