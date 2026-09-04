import React, { useCallback, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { supabase } from '../lib/supabase'
import { isFlagEnabled } from '../lib/featureFlags'
import { useTheme } from '../lib/ThemeContext'
import {
  requestBackgroundLocationPermission,
  hasBackgroundLocationPermission,
  BACKGROUND_LOCATION_COPY,
} from '../lib/visitDetection/permissions'
import { forceRefreshGeofences } from '../lib/visitDetection/candidateVisitTracker'

// TEMPORARY — Phase 1 pilot only. Visible exclusively to
// users.visit_detection_tester accounts (gated by the caller, ProfileScreen).
// Not a real settings screen: no copy polish, no design-system styling.
// Meant to be deleted once background-permission granting and geofence
// refresh get a real UI (or once the pilot concludes and this rolls into
// the recovery-flow settings section).
export default function VisitDetectionDebugPanel({ userId }) {
  const { colors } = useTheme()
  const { TEXT, MUTED, AMBER } = colors
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState(null)
  const [lastLog, setLastLog] = useState(null)
  const [monitoredRows, setMonitoredRows] = useState([])

  const refreshStatus = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    try {
      const [hasBgPermission, detectionEnabled] = await Promise.all([
        hasBackgroundLocationPermission(),
        isFlagEnabled(userId, 'candidate_visit_detection'),
      ])

      const { data: log } = await supabase
        .from('geofence_registration_log')
        .select('refreshed_at, geofencing_started, error_message, monitored_items, excluded_items')
        .eq('user_id', userId)
        .order('refreshed_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      const { data: monitored } = await supabase
        .from('current_monitored_geofences')
        .select('item_id, item_name, distance_m, state')
        .eq('user_id', userId)
        .order('distance_m', { ascending: true })

      setStatus({ hasBgPermission, detectionEnabled })
      setLastLog(log ?? null)
      setMonitoredRows(monitored ?? [])
    } catch (e) {
      console.warn('VisitDetectionDebugPanel refresh failed:', e?.message ?? e)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useFocusEffect(useCallback(() => { refreshStatus() }, [refreshStatus]))

  const handleGrantPermission = async () => {
    setLoading(true)
    try {
      await requestBackgroundLocationPermission()
    } finally {
      await refreshStatus()
    }
  }

  const handleForceRefresh = async () => {
    setLoading(true)
    try {
      await forceRefreshGeofences(userId)
    } finally {
      await refreshStatus()
    }
  }

  return (
    <View style={[styles.card, { borderColor: AMBER, backgroundColor: `${AMBER}14` }]}>
      <Text style={[styles.title, { color: AMBER }]}>Visit detection debug (tester only)</Text>

      <Row label="Background location permission" ok={status?.hasBgPermission} color={TEXT} />
      <Row label="candidate_visit_detection flag" ok={status?.detectionEnabled} color={TEXT} />
      <Row label="Last geofence registration succeeded" ok={lastLog?.geofencing_started} color={TEXT} />

      {lastLog && (
        <Text style={[styles.meta, { color: MUTED }]}>
          Last refresh: {new Date(lastLog.refreshed_at).toLocaleString()} ·{' '}
          {lastLog.monitored_items?.length ?? 0} monitored, {lastLog.excluded_items?.length ?? 0} excluded
          {lastLog.error_message ? ` · error: ${lastLog.error_message}` : ''}
        </Text>
      )}

      <Text style={[styles.subtitle, { color: TEXT }]}>Currently monitored / excluded set</Text>
      {monitoredRows.length === 0 ? (
        <Text style={[styles.meta, { color: MUTED }]}>No registration log yet — grant permission and refresh.</Text>
      ) : (
        monitoredRows.map(row => (
          <Text key={row.item_id} style={[styles.meta, { color: MUTED }]}>
            {row.state === 'monitored' ? '✓' : '✗'} {row.item_name} — {row.distance_m}m — {row.state}
          </Text>
        ))
      )}

      <View style={styles.buttonRow}>
        <TouchableOpacity style={[styles.button, { backgroundColor: AMBER }]} onPress={handleGrantPermission} disabled={loading}>
          <Text style={styles.buttonText}>Grant background location</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, { backgroundColor: AMBER }]} onPress={handleForceRefresh} disabled={loading}>
          <Text style={styles.buttonText}>Refresh geofences now</Text>
        </TouchableOpacity>
      </View>
      {loading && <ActivityIndicator style={{ marginTop: 8 }} />}

      <Text style={[styles.copy, { color: MUTED }]}>{BACKGROUND_LOCATION_COPY.title}: {BACKGROUND_LOCATION_COPY.body}</Text>
    </View>
  )
}

function Row({ label, ok, color }) {
  return (
    <Text style={[styles.row, { color }]}>
      {ok ? '✓' : '✗'} {label}
    </Text>
  )
}

const styles = StyleSheet.create({
  card: { marginTop: 16, padding: 12, borderRadius: 10, borderWidth: 1 },
  title: { fontWeight: '700', marginBottom: 8 },
  subtitle: { fontWeight: '600', marginTop: 10, marginBottom: 4 },
  row: { marginBottom: 4 },
  meta: { fontSize: 12, opacity: 0.8, marginBottom: 2 },
  buttonRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  button: { flex: 1, padding: 8, borderRadius: 8, alignItems: 'center' },
  buttonText: { color: '#0F0F1E', fontWeight: '700', fontSize: 12 },
  copy: { fontSize: 11, opacity: 0.6, marginTop: 10, fontStyle: 'italic' },
})
