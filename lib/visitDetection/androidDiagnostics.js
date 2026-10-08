// Android field-test diagnostics (tester / admin panel only, see components/VisitDetectionDebugPanel.jsx). Everything here is a
// status fact about THIS phone's setup. No coordinates, no location history: counts, flags and timestamps only.
import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Updates from 'expo-updates'
import { supabase } from '../supabase'
import { isFlagEnabled, isVisitRecoveryOffered } from '../featureFlags'
import { ANDROID_RECOVERY_FLAG } from './offering'
import { readLocationPermissionSnapshot } from './permissions'
import { fetchOptIn } from './recoverySettings'
import { readGeofenceRegistrationState } from './candidateVisitTracker'
import { PENDING_KEY, OPEN_KEY } from './trackerKeys'

async function jsonLength(key, kind) {
  try {
    const raw = await AsyncStorage.getItem(key)
    if (!raw) return 0
    const v = JSON.parse(raw)
    return kind === 'array' ? (Array.isArray(v) ? v.length : 0) : Object.keys(v ?? {}).length
  } catch { return 0 }
}

/** @returns {Promise<Array<[string, string]>>} label/value rows */
export async function loadAndroidDiagnosticRows(userId) {
  if (Platform.OS !== 'android' || !userId) return []
  const [perm, optedIn, offered, androidFlag, reg, pendingEvents, openSessions, lastEvent, lastCandidate] = await Promise.all([
    readLocationPermissionSnapshot(),
    fetchOptIn(userId),
    isVisitRecoveryOffered(userId, 'android'),
    isFlagEnabled(userId, ANDROID_RECOVERY_FLAG),
    readGeofenceRegistrationState(),
    jsonLength(PENDING_KEY, 'array'),
    jsonLength(OPEN_KEY, 'object'),
    supabase.from('geofence_debug_events').select('event_type, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle().then((r) => r.data).catch(() => null),
    supabase.from('candidate_visits').select('created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle().then((r) => r.data).catch(() => null),
  ])
  const t = (v) => (v ? new Date(v).toLocaleString() : '—')
  return [
    ['Android API level', String(Platform.Version)],
    ['Runtime', String(Updates.runtimeVersion ?? '—')],
    ['OTA update', Updates.isEmbeddedLaunch ? 'embedded (none applied)' : String(Updates.updateId ?? '—')],
    ['Foreground location', perm.foreground],
    ['Background location', perm.background === 'always' ? 'Allow all the time' : perm.background],
    ['Precision', perm.precision ?? '—'],
    ['Location services', perm.servicesEnabled ? 'on' : 'OFF'],
    ['Recovery preference', optedIn ? 'on' : 'off'],
    ['Offered to this user', offered ? 'yes' : 'no'],
    ['android_visit_recovery flag (legacy, not a gate)', androidFlag ? 'on' : 'off'],
    ['Geofencing task registered', reg.started ? 'yes' : 'no'],
    ['Last registration', t(reg.registeredAt)],
    ['Last registration error', reg.error ?? 'none'],
    ['Open local sessions', String(openSessions)],
    ['Pending local events', String(pendingEvents)],
    ['Last background event', lastEvent ? `${lastEvent.event_type} · ${t(lastEvent.created_at)}` : '—'],
    ['Last candidate submitted', lastCandidate ? t(lastCandidate.created_at) : '—'],
  ]
}
