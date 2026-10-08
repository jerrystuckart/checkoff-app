// Shared loader for the Home card and the Profile section: reads the facts the resolver needs and refreshes them on
// focus, on a recovery / candidate change, and (the Settings round trip) every time the app returns to the foreground.
import { useCallback, useEffect, useState } from 'react'
import { AppState, Platform, Linking, Alert } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useFocusEffect } from '@react-navigation/native'
import { isVisitRecoveryOffered } from '../featureFlags'
import { readLocationPermissionSnapshot, requestBackgroundLocationPermission, runAndroidPermissionFlow } from './permissions'
import { fetchOptIn, countPendingSuggestions, subscribeRecoveryChange, subscribeCandidatesChange, enableVisitRecovery } from './recoverySettings'
import { RECOVERY_COPY } from './recoveryPolicy'
import { recordRecoveryGate } from './recoveryGateDiagnostics'
import { resolveVisitRecoveryState, RECOVERY_STATE_COPY } from './recoveryState'
import { ANDROID_DISCLOSURE } from './androidDisclosure'
import { deviceSupportsVisitRecovery, currentRuntimeVersion } from './deviceCapability'
import { readGeofenceRegistrationState } from './candidateVisitTracker'

const NO_PERMISSION = { servicesEnabled: true, foreground: 'undetermined', background: 'undetermined' }
// Written when the user taps "Not now" on the Android disclosure. The disclosure is only ever shown from an explicit tap
// (never automatically), so this exists for diagnostics and to keep any future automatic surface from nagging.
export const ANDROID_NOT_NOW_KEY = 'androidRecoveryDisclosureNotNowAt'

export async function openAppLocationSettings() {
  try {
    if (Platform.OS === 'ios') await Linking.openURL('app-settings:')
    else await Linking.openSettings()
  } catch {
    Alert.alert('Open Settings', 'Open Settings, then CheckOff, then Location.')
  }
}

/** Android: the settings-step explanation resolves once the user taps OK, so the system page never appears unexplained. */
function confirmSettingsStep() {
  return new Promise((resolve) => {
    Alert.alert(ANDROID_DISCLOSURE.settingsTitle, ANDROID_DISCLOSURE.settingsBody, [{ text: 'OK', onPress: () => resolve() }], { onDismiss: resolve })
  })
}

/** The platform's background-permission runner passed to enableVisitRecovery / the CTA. */
export function backgroundPermissionRunner() {
  return Platform.OS === 'android'
    ? () => runAndroidPermissionFlow({ confirmSettingsStep })
    : requestBackgroundLocationPermission
}

/** Android prominent disclosure on its own modal, shown before ANY permission request. onContinue runs only after Continue. */
export function showAndroidDisclosure({ onContinue }) {
  Alert.alert(ANDROID_DISCLOSURE.title, ANDROID_DISCLOSURE.body, [
    { text: ANDROID_DISCLOSURE.notNow, style: 'cancel', onPress: () => { AsyncStorage.setItem(ANDROID_NOT_NOW_KEY, String(Date.now())).catch(() => {}) } },
    { text: ANDROID_DISCLOSURE.continue, onPress: onContinue },
  ], { cancelable: true })
}

export function useVisitRecovery(userId) {
  const supported = deviceSupportsVisitRecovery()
  const [loaded, setLoaded] = useState(false)
  const [enabling, setEnabling] = useState(false)
  const [facts, setFacts] = useState({ flagEnabled: false, optedIn: false, permission: NO_PERMISSION, registration: null, suggestionCount: 0 })

  const load = useCallback(async () => {
    if (!supported || !userId) { recordRecoveryGate({ supported, runtime: currentRuntimeVersion(), error: !userId ? 'no signed-in user' : null }); return }
    try {
      const [flagEnabled, optedIn, permission, suggestionCount, registration] = await Promise.all([
        isVisitRecoveryOffered(userId, Platform.OS),
        fetchOptIn(userId),
        readLocationPermissionSnapshot(),
        countPendingSuggestions(userId),
        Platform.OS === 'android' ? readGeofenceRegistrationState() : Promise.resolve(null),
      ])
      setFacts({ flagEnabled, optedIn, permission, suggestionCount, registration })
      recordRecoveryGate({ supported, runtime: currentRuntimeVersion(), flagEnabled, optedIn, error: null })
    } catch (e) {
      recordRecoveryGate({ supported, runtime: currentRuntimeVersion(), error: String(e?.message ?? e).slice(0, 120) })
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

  const resolved = resolveVisitRecoveryState({ platformOS: Platform.OS, runtimeVersion: currentRuntimeVersion(), ...facts })
  useEffect(() => { if (loaded) recordRecoveryGate({ state: resolved.state }) }, [loaded, resolved.state])

  const openSettings = openAppLocationSettings

  async function askBackground() {
    try {
      const result = await backgroundPermissionRunner()()
      if (result !== 'granted') await openSettings()
    } finally {
      load()
    }
  }

  /** The CTA: explain first, then ask (or go to Settings when the system will not ask again). Re-reads the state after. */
  function runCta() {
    if (!resolved.cta) return
    if (resolved.cta.action === 'settings') { openSettings(); return }
    if (Platform.OS === 'android') { showAndroidDisclosure({ onContinue: askBackground }); return }
    Alert.alert(RECOVERY_STATE_COPY.cta.always, RECOVERY_STATE_COPY.explain, [
      { text: 'Not now', style: 'cancel' },
      { text: 'Continue', onPress: askBackground },
    ])
  }

  // Opt in (Home and Profile share this): the disclosure / explanation first, then the user-initiated permission flow. Never automatic.
  async function doEnable() {
    setEnabling(true)
    try {
      const { permission } = await enableVisitRecovery(userId, backgroundPermissionRunner())
      if (permission !== 'granted') Alert.alert('One more step', Platform.OS === 'android' ? RECOVERY_COPY.permissionDeniedHintAndroid : RECOVERY_COPY.permissionDeniedHint, [
        { text: 'Later', style: 'cancel' },
        { text: 'Open Settings', onPress: openSettings },
      ])
    } catch (e) {
      Alert.alert('Could not turn on', e?.message ?? 'Please try again.')
    } finally {
      setEnabling(false)
      load()
    }
  }

  function turnOn() {
    if (Platform.OS === 'android') { showAndroidDisclosure({ onContinue: doEnable }); return }
    Alert.alert(RECOVERY_COPY.title, `${RECOVERY_COPY.intro}\n\n${RECOVERY_COPY.how}\n\n${RECOVERY_COPY.privacy}`, [
      { text: 'Not now', style: 'cancel' },
      { text: 'Turn on', onPress: doEnable },
    ])
  }

  return { supported, loaded, resolved, reload: load, runCta, openSettings, optedIn: facts.optedIn, turnOn, enabling }
}
