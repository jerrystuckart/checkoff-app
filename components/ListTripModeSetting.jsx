import React, { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native'
import { supabase } from '../lib/supabase'
import { useTheme } from '../lib/ThemeContext'
import { tripModeChoiceCopy, buildTripModeUpdate, tripModeOffWarning } from '../lib/listTripModeSetting'

// Owner-only editor for lists.trip_mode_enabled (the caller gates on
// canEditTripMode). The database enforces the same rule: lists UPDATE is
// creator-only via RLS, and the update below also filters on creator_id.
export default function ListTripModeSetting({ listId, userId, enabled, onChanged }) {
  const { colors } = useTheme()
  const { CARD, TEXT, MUTED, BORDER, AMBER } = colors
  const [saving, setSaving] = useState(false)

  async function apply(next) {
    setSaving(true)
    const { error } = await supabase.from('lists').update(buildTripModeUpdate(next)).eq('id', listId).eq('creator_id', userId)
    setSaving(false)
    if (error) { Alert.alert('Could not change this setting', error.message); return }
    onChanged?.(next)
  }

  function choose(next) {
    if (next === !!enabled || saving) return
    if (!next) {
      Alert.alert('Switch to Regular?', tripModeOffWarning(), [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Switch to Regular', style: 'destructive', onPress: () => apply(false) },
      ])
      return
    }
    apply(true)
  }

  const pill = (label, on, next) => (
    <TouchableOpacity
      onPress={() => choose(next)}
      activeOpacity={0.85}
      style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: on ? AMBER : BORDER, backgroundColor: on ? AMBER : CARD }}
    >
      <Text style={{ fontSize: 13, fontWeight: '700', color: on ? '#1A1A2E' : TEXT }}>{label}</Text>
    </TouchableOpacity>
  )

  return (
    <View style={[styles.wrap, { backgroundColor: CARD, borderColor: BORDER }]}>
      <Text style={[styles.title, { color: MUTED }]}>How does checking off work?</Text>
      <View style={styles.row}>
        {pill('Regular', !enabled, false)}
        {pill('Trip Mode', !!enabled, true)}
        {saving && <ActivityIndicator color={AMBER} />}
      </View>
      <Text style={[styles.hint, { color: MUTED }]}>{tripModeChoiceCopy(!!enabled)}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: 20, marginBottom: 12, padding: 14, borderRadius: 16, borderWidth: 1 },
  title: { fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  hint: { fontSize: 12, lineHeight: 17, marginTop: 8 },
})
