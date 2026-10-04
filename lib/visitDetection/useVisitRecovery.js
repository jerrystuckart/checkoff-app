// Shared loader for the Home card and the Profile section: reads the facts the resolver needs and refreshes them on
// focus, on a recovery / candidate change, and (the Settings round trip) every time the app returns to the foreground.
import { useCallback, useEffect, useState } from 'react'
import { AppState, Platform, Linking, Alert } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { isFlagEnabled } from '../featureFlags'
import { readLocationPermissionSnapshot, requestBackgroundLocationPermission } from './permissions'
import { fetchOptIn, countPendingSuggestions, subscribeRecoveryChange, subscribeCandidatesChange } from './recoverySettings'
import { resolveVisitRecoveryState, RECOVERY_STATE_COPY } from './recoveryState'
import { supportsVisitRecovery } from './recoveryPolicy'

const NO_PERMISSION = { servicesEnabled: true, foreground: 'undetermined', background: 'undetermined' }

export function useVisitRecovery(userId) {
  const supported = supportsVisitRecovery(Platform.OS)
  const [loaded, setLoaded] = useState(false)
  const [facts, setFacts] = useState({ flagEnabled: false, optedIn: false, permission: NO_PERMISSION, suggestionCount: 0 })

  const load = useCallback(async () => {
    if (!supported || !userId) return
    try {
      const [flagEnabled, optedIn, permission, suggestionCount] = await Promise.all([
        isFlagEnabled(userId, 'candidate_visit_detection'),
        fetchOptIn(userId),
        readLocationPermissionSnapshot(),
        countPendingSuggestions(userId),
      ])
      setFacts({ flagEnabled, optedIn, permission, suggestionCount })
    } catch (e) {
      console.warn('useVisitRecovery load failed:', e?.message ?? e)
    } finally {
      setLoaded(true)
    }
  }, [supported, userId])

  useFocusEffect(useCallback(() => { load() }, [load]))
  useEffect(() => {
    if (!supported) return undefined
    const offA = subscribeRecoveryChange(load)
    const offB = subscribeCandidatesChange(load)
    // Back from Settings (or any permission change made outside the app): re-read immediately.
    const sub = AppState.addEventListener('change', (next) => { if (next === 'active') load() })
    return () => { offA(); offB(); sub.remove() }
  }, [supported, load])

  const resolved = resolveVisitRecoveryState({ platformOS: Platform.OS, ...facts })

  async function openSettings() {
    try { await Linking.openURL('app-settings:') } catch { Alert.alert('Open Settings', 'Open Settings, then CheckOff, then Location.') }
  }

  /** The CTA: explain first, then ask (or go to Settings when iOS will not ask again). Re-reads the state after. */
  function runCta() {
    if (!resolved.cta) return
    if (resolved.cta.action === 'settings') { openSettings(); return }
    Alert.alert(RECOVERY_STATE_COPY.cta.always, RECOVERY_STATE_COPY.explain, [
      { text: 'Not now', style: 'cancel' },
      {
        text: 'Continue',
        onPress: async () => {
          try {
            const result = await requestBackgroundLocationPermission()
            if (result !== 'granted') await openSettings()
          } finally {
            load()
          }
        },
      },
    ])
  }

  return { supported, loaded, resolved, reload: load, runCta, openSettings, optedIn: facts.optedIn }
}
