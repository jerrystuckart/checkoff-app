import React, { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'

// TESTER ONLY — What's Good V1 field-test instrumentation. Mirrors
// VisitDetectionDebugPanel.jsx's style/intent (temporary, no copy polish,
// deleted or promoted once the real field test concludes). Gated by the
// CALLER (HomeScreen.jsx: user?.is_admin && whatsGood.enabled) — since
// only Jerry currently has the whats_good_v1 override, this is Jerry-only
// in practice today, and the is_admin check keeps it that way if the
// flag's scope ever widens to non-admin testers.
//
// Displays ONLY data already computed for the real selection (see
// lib/whatsGoodOrchestrator.js's `debug` field) — no extra queries, and
// deliberately nothing beyond what's already anonymized: candidate
// momentumScore is the single bounded aggregate number
// lib/whatsGoodMomentum.js produces, never a raw contributor list. No
// other user's identity appears anywhere in this panel.
export default function WhatsGoodDebugPanel({ debug, colors }) {
  const { TEXT, MUTED, AMBER } = colors
  const [expanded, setExpanded] = useState(false)

  if (!debug) return null

  if (!expanded) {
    return (
      <TouchableOpacity
        onPress={() => setExpanded(true)}
        style={[styles.collapsedCard, { borderColor: AMBER, backgroundColor: `${AMBER}14` }]}
        activeOpacity={0.75}
      >
        <Text style={[styles.collapsedText, { color: AMBER }]}>Tester Debug ▸</Text>
      </TouchableOpacity>
    )
  }

  return (
    <View style={[styles.card, { borderColor: AMBER, backgroundColor: `${AMBER}14` }]}>
      <TouchableOpacity onPress={() => setExpanded(false)} activeOpacity={0.75}>
        <Text style={[styles.title, { color: AMBER }]}>Tester Debug ▾</Text>
      </TouchableOpacity>

      <Text style={[styles.row, { color: TEXT }]}>
        Coordinates: {debug.userLocation ? `${debug.userLocation.latitude.toFixed(5)}, ${debug.userLocation.longitude.toFixed(5)}` : '(none yet)'}
      </Text>
      <Text style={[styles.row, { color: TEXT }]}>Home Rail 5: {debug.homeRailItemIds.join(', ') || '(none)'}</Text>
      <Text style={[styles.row, { color: TEXT }]}>Selected 3: {debug.selectedItemIds.join(', ') || '(none)'}</Text>
      <Text style={[styles.row, { color: TEXT }]}>{debug.fromCache ? '✓ Served from cached session' : '✓ Freshly regenerated'}</Text>
      <Text style={[styles.row, { color: TEXT }]}>
        At place: {debug.atPlaceItemId ? `YES — ${debug.atPlaceItemId}` : 'no'}
      </Text>
      <Text style={[styles.meta, { color: MUTED }]}>Fingerprint before: {debug.fingerprintBefore ?? '(first run)'}</Text>
      <Text style={[styles.meta, { color: MUTED }]}>Fingerprint after: {debug.fingerprintAfter ?? '(n/a)'}</Text>

      <Text style={[styles.subtitle, { color: TEXT }]}>
        {debug.fromCache ? 'Candidate pool (not recomputed)' : `Candidate pool (${debug.candidatePool.length})`}
      </Text>
      {debug.candidatePool.length === 0 ? (
        <Text style={[styles.meta, { color: MUTED }]}>
          {debug.fromCache
            ? 'Candidate pool not recomputed — cached recommendation set reused.'
            : 'No candidates available this pass.'}
        </Text>
      ) : (
        debug.candidatePool.map((c) => (
          <Text key={c.itemId} style={[styles.meta, { color: debug.selectedItemIds.includes(c.itemId) ? TEXT : MUTED }]}>
            {debug.selectedItemIds.includes(c.itemId) ? '★' : '·'} {c.itemId} — checked:{c.everCheckedOff ? 'Y' : 'N'} — lastShown:
            {c.lastShownAt ? new Date(c.lastShownAt).toLocaleDateString() : 'never'} — class:{c.freshnessClass ?? '?'} — momentum:
            {typeof c.momentumScore === 'number' ? c.momentumScore.toFixed(2) : '?'}
          </Text>
        ))
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  collapsedCard: { marginTop: 16, marginHorizontal: 16, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, alignSelf: 'flex-start' },
  collapsedText: { fontWeight: '700', fontSize: 12 },
  card: { marginTop: 16, marginHorizontal: 16, padding: 12, borderRadius: 10, borderWidth: 1 },
  title: { fontWeight: '700', marginBottom: 8 },
  subtitle: { fontWeight: '600', marginTop: 10, marginBottom: 4 },
  row: { marginBottom: 4, fontSize: 12 },
  meta: { fontSize: 11, opacity: 0.85, marginBottom: 2 },
})
