import { useState, useEffect } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

const ONBOARDING_KEY = 'checkoff_onboarding_v1'

/**
 * useOnboarding()
 *
 * Returns:
 *   - needsOnboarding: true on first launch, false on all subsequent launches
 *   - completeOnboarding: call this when user finishes or skips onboarding
 *   - checkingOnboarding: true while AsyncStorage is being read
 *
 * Uses a versioned key ('checkoff_onboarding_v1') so that if you need to
 * show onboarding again for a major update, bump the version number.
 */
export function useOnboarding() {
  const [needsOnboarding, setNeedsOnboarding] = useState(false)
  const [checkingOnboarding, setCheckingOnboarding] = useState(true)

  useEffect(() => {
    AsyncStorage.getItem(ONBOARDING_KEY)
      .then(val => {
        setNeedsOnboarding(val === null) // null means never seen
      })
      .catch(() => {
        setNeedsOnboarding(false) // fail open — don't block app on storage error
      })
      .finally(() => {
        setCheckingOnboarding(false)
      })
  }, [])

  async function completeOnboarding() {
    setNeedsOnboarding(false)
    try {
      await AsyncStorage.setItem(ONBOARDING_KEY, 'done')
    } catch (e) {
      // Non-critical — worst case they see onboarding again next launch
      console.warn('useOnboarding: failed to persist completion', e.message)
    }
  }

  return { needsOnboarding, completeOnboarding, checkingOnboarding }
}
