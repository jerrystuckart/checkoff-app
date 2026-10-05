// Compact, collapsed-by-default "Diagnostics" disclosure on Profile. Rendered ONLY for the existing admin gate
// (users.is_admin === true via shouldShowDiagnostics); ordinary users and guests get null. Holds what used to be
// scattered on Home/Profile: the What's Good runtime diagnostics rows + "Refresh What's Good" action, and (iOS testers)
// the visit-detection debug panel. Display-only: it adds no logging, tracking or detection behavior of its own.
import React, { useState, useEffect } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import VisitDetectionDebugPanel from '../VisitDetectionDebugPanel'
import { shouldShowDiagnostics, buildDiagnosticsRows } from '../../lib/whatsGoodDiagnosticsPanel'
import { getWhatsGoodDiagnostics, subscribeWhatsGoodDiagnostics } from '../../lib/whatsGoodDiagnosticsStore'

export default function AdminDiagnosticsSection({ isAdmin, userId, showVisitDebug, colors }) {
  const [expanded, setExpanded] = useState(false)
  const [diag, setDiag] = useState(getWhatsGoodDiagnostics())
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => subscribeWhatsGoodDiagnostics(setDiag), [])

  if (!shouldShowDiagnostics(isAdmin)) return null
  const { TEXT, MUTED, CARD, BORDER, AMBER } = colors

  const refresh = async () => {
    if (!diag.refresh || refreshing) return
    setRefreshing(true)
    try { await diag.refresh() } finally { setRefreshing(false) }
  }

  return (
    <View style={[styles.wrap, { backgroundColor: CARD, borderColor: BORDER }]}>
      <TouchableOpacity
        onPress={() => setExpanded(v => !v)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={expanded ? 'Hide diagnostics' : 'Show diagnostics'}
        style={styles.header}
      >
        <Text style={[styles.title, { color: TEXT }]}>Diagnostics</Text>
        <Text style={[styles.chevron, { color: MUTED }]}>{expanded ? '▾' : '▸'}</Text>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.body}>
          <Text style={[styles.sectionLabel, { color: MUTED }]}>What's Good (admin only)</Text>
          {diag.payload ? (
            buildDiagnosticsRows(diag.payload).map(row => (
              <View key={row.label} style={styles.row}>
                <Text style={[styles.rowLabel, { color: MUTED }]}>{row.label}</Text>
                <Text style={[styles.rowValue, { color: TEXT }]}>{row.value}</Text>
              </View>
            ))
          ) : (
            <Text style={[styles.empty, { color: MUTED }]}>Open the Home tab once to collect What's Good diagnostics.</Text>
          )}
          <TouchableOpacity
            onPress={refresh}
            disabled={!diag.refresh || refreshing}
            style={[styles.refresh, { borderColor: BORDER }]}
          >
            <Text style={[styles.refreshText, { color: AMBER }]}>{refreshing ? 'Refreshing…' : "Refresh What's Good"}</Text>
          </TouchableOpacity>

          {showVisitDebug && (
            <View style={styles.visit}>
              <VisitDetectionDebugPanel userId={userId} />
            </View>
          )}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { marginTop: 14, alignSelf: 'stretch', borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, minHeight: 44 },
  title: { fontSize: 14, fontWeight: '800' },
  chevron: { fontSize: 14, fontWeight: '800' },
  body: { paddingHorizontal: 14, paddingBottom: 12 },
  sectionLabel: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, gap: 8 },
  rowLabel: { fontSize: 12, flexShrink: 0 },
  rowValue: { fontSize: 12, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  empty: { fontSize: 12, lineHeight: 17 },
  refresh: { marginTop: 10, paddingVertical: 10, borderTopWidth: 1, alignItems: 'center' },
  refreshText: { fontSize: 14, fontWeight: '700' },
  visit: { marginTop: 10 },
})
