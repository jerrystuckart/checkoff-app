// Visit Detection Stage 2 (2026-09-23) — "Places you may have visited"
// inbox. Tester-only for now (gated by the caller, ProfileScreen, on
// profile.visit_detection_tester — same gate VisitDetectionDebugPanel
// already uses). Lists a user's own candidate_visits rows that are still
// pending a decision, lets them confirm (creates a real check-in via the
// server-authorized verification_method='historical_visit_confirmed' path —
// see supabase/migrations/20260923_visit_detection_stage2_confirm.sql) or
// dismiss ("Not this time"). Never creates a check-in or awards points
// without an explicit tap here — this screen is the only place that can
// convert a candidate_visits row into a real check-in.

import React, { useCallback, useMemo, useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect } from '@react-navigation/native'
import { supabase } from '../lib/supabase'
import { useTheme } from '../lib/ThemeContext'
import {
  isCandidateVisitSuggestible,
  buildVisitConfirmationPayload,
  buildVisitDismissalPayload,
  formatVisitWhenLabel,
} from '../lib/visitDetection/candidateVisitConfirmation'

function mapRow(row) {
  const it = row.items
  if (!it) return null
  return {
    candidateVisitId: row.id,
    status: row.status,
    expiresAt: row.expires_at,
    departureAt: row.departure_at,
    itemId: it.id,
    itemBody: it.body ?? '',
    neighborhoodName: it.neighborhoods?.name ?? null,
  }
}

export default function VisitInboxScreen({ navigation, route }) {
  // Deep-linked from a tapped candidate_visit_high_confidence push (see
  // lib/useNotifications.js's navigateToVisitInbox) — when present, that
  // specific suggestion is sorted to the top rather than shown alone, so a
  // suggestion that expired/got confirmed elsewhere between the push firing
  // and the tap still degrades gracefully to the normal full list.
  const highlightId = route?.params?.candidateVisitId ?? null
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const { BG, CARD, TEXT, MUTED, BORDER, AMBER } = colors
  const styles = useMemo(() => createStyles({ BG, CARD, TEXT, MUTED, BORDER, AMBER }), [BG, CARD, TEXT, MUTED, BORDER, AMBER])

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setRows([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('candidate_visits')
        .select(`
          id, status, expires_at, departure_at, confirmed_at, rejected_at,
          items ( id, body, neighborhoods!items_neighborhood_id_fkey ( name ) )
        `)
        .eq('user_id', user.id)
        .in('status', ['candidate', 'medium_confidence', 'high_confidence'])
        .order('departure_at', { ascending: false })

      if (error) throw error

      const mapped = (data ?? [])
        .filter(row => isCandidateVisitSuggestible({
          status: row.status,
          expiresAt: row.expires_at,
          confirmedAt: row.confirmed_at,
          rejectedAt: row.rejected_at,
        }))
        .map(mapRow)
        .filter(Boolean)

      // Hide any suggestion for an item the user has ALREADY checked off,
      // through any path -- including one completed after this candidate
      // visit was created (e.g. checked off live at the venue while this
      // was still sitting unconfirmed). Matches the server-side guard in
      // supabase/migrations/20260924_visit_detection_duplicate_guard.sql,
      // which is the real authorization boundary -- this is a display-only
      // mirror so the inbox doesn't offer something confirm would reject.
      const itemIds = [...new Set(mapped.map(r => r.itemId))]
      let alreadyCheckedOffItemIds = new Set()
      if (itemIds.length > 0) {
        const { data: existing } = await supabase
          .from('check_ins')
          .select('item_id')
          .eq('user_id', user.id)
          .in('item_id', itemIds)
        alreadyCheckedOffItemIds = new Set((existing ?? []).map(r => r.item_id))
      }
      const withoutAlreadyDone = mapped.filter(r => !alreadyCheckedOffItemIds.has(r.itemId))

      const sorted = highlightId
        ? [...withoutAlreadyDone].sort((a, b) => (a.candidateVisitId === highlightId ? -1 : b.candidateVisitId === highlightId ? 1 : 0))
        : withoutAlreadyDone
      setRows(sorted)
    } catch (e) {
      console.warn('VisitInboxScreen load error:', e?.message ?? e)
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [highlightId])

  useFocusEffect(useCallback(() => { load() }, [load]))

  async function handleConfirm(row) {
    setBusyId(row.candidateVisitId)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const payload = buildVisitConfirmationPayload({
        userId: user.id,
        itemId: row.itemId,
        candidateVisitId: row.candidateVisitId,
      })
      const { error } = await supabase.from('check_ins').insert(payload)
      if (error) throw error

      setRows(prev => prev.filter(r => r.candidateVisitId !== row.candidateVisitId))
      Alert.alert('Checked off!', `${row.itemBody} — added to your memory.`)
    } catch (e) {
      Alert.alert('Could not confirm this visit', e?.message ?? 'Please try again.')
    } finally {
      setBusyId(null)
    }
  }

  async function handleDismiss(row) {
    setBusyId(row.candidateVisitId)
    try {
      const { error } = await supabase
        .from('candidate_visits')
        .update(buildVisitDismissalPayload())
        .eq('id', row.candidateVisitId)
      if (error) throw error

      setRows(prev => prev.filter(r => r.candidateVisitId !== row.candidateVisitId))
    } catch (e) {
      Alert.alert('Could not dismiss this suggestion', e?.message ?? 'Please try again.')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={AMBER} />
      </View>
    )
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 20, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.screenTitle}>Places you may have visited</Text>
      <Text style={styles.screenSubtitle}>
        Based on time spent nearby — private to you, and never checked off automatically. Confirm what's right, dismiss what isn't.
      </Text>

      {rows.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>Nothing to review right now</Text>
          <Text style={styles.emptyBody}>When we notice you spent real time somewhere on your list, it'll show up here.</Text>
        </View>
      ) : (
        rows.map(row => (
          <View
            key={row.candidateVisitId}
            style={[styles.card, row.candidateVisitId === highlightId && { borderColor: AMBER, borderWidth: 2 }]}
          >
            <TouchableOpacity onPress={() => navigation.navigate('ItemDetail', { item: { id: row.itemId, body: row.itemBody } })}>
              <Text style={styles.itemBody}>{row.itemBody}</Text>
              {row.neighborhoodName ? <Text style={styles.itemMeta}>{row.neighborhoodName}</Text> : null}
              {row.departureAt ? <Text style={styles.itemMeta}>{formatVisitWhenLabel(row.departureAt)}</Text> : null}
            </TouchableOpacity>

            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.button, styles.dismissButton]}
                onPress={() => handleDismiss(row)}
                disabled={busyId === row.candidateVisitId}
              >
                <Text style={styles.dismissButtonText}>Not this time</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, { backgroundColor: AMBER }]}
                onPress={() => handleConfirm(row)}
                disabled={busyId === row.candidateVisitId}
              >
                {busyId === row.candidateVisitId ? (
                  <ActivityIndicator color="#0F0F1E" size="small" />
                ) : (
                  <Text style={styles.confirmButtonText}>Check it off</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  )
}

function createStyles({ BG, CARD, TEXT, MUTED, BORDER, AMBER }) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: BG },
    center: { alignItems: 'center', justifyContent: 'center' },
    screenTitle: { fontSize: 22, fontWeight: '800', color: TEXT, marginBottom: 8 },
    screenSubtitle: { fontSize: 13, color: MUTED, lineHeight: 18, marginBottom: 20 },
    card: {
      backgroundColor: CARD,
      borderRadius: 18,
      padding: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: BORDER,
    },
    itemBody: { fontSize: 16, color: TEXT, fontWeight: '700' },
    itemMeta: { fontSize: 12, color: MUTED, marginTop: 4, fontWeight: '600' },
    buttonRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
    button: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    dismissButton: { backgroundColor: 'transparent', borderWidth: 1, borderColor: BORDER },
    dismissButtonText: { color: MUTED, fontWeight: '700', fontSize: 13 },
    confirmButtonText: { color: '#0F0F1E', fontWeight: '700', fontSize: 13 },
    emptyWrap: { alignItems: 'center', paddingTop: 40, paddingHorizontal: 24 },
    emptyTitle: { fontSize: 17, fontWeight: '800', color: TEXT, marginBottom: 8, textAlign: 'center' },
    emptyBody: { fontSize: 14, color: MUTED, textAlign: 'center', lineHeight: 20 },
  })
}
