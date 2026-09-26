import React, { useCallback, useMemo, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Linking, Platform } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { useTheme } from '../lib/ThemeContext'
import { isFlagEnabled } from '../lib/featureFlags'
import { hasBackgroundLocationPermission } from '../lib/visitDetection/permissions'
import { fetchOptIn, enableVisitRecovery, turnOffVisitRecovery, countPendingSuggestions } from '../lib/visitDetection/recoverySettings'
import { recoveryCardState, shouldShowInboxEntry, RECOVERY_COPY } from '../lib/visitDetection/recoveryPolicy'
import { openVisitInbox } from '../lib/visitDetection/inboxNavigation'

// Profile section for seven-day visit recovery: the plain-language permission
// explanation, the on/off control (off deletes saved visits), and the entry to
// "Places you may have visited" — shown to anyone with a valid suggestion, not
// only people who have the feature switched on.
export default function VisitRecoverySection({ userId, navigation }) {
  const { colors } = useTheme()
  const { CARD, TEXT, MUTED, BORDER, AMBER } = colors
  const s = useMemo(() => makeStyles({ CARD, TEXT, MUTED, BORDER, AMBER }), [CARD, TEXT, MUTED, BORDER, AMBER])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [st, setSt] = useState({ flagEnabled: false, optedIn: false, backgroundGranted: false, suggestionCount: 0 })

  const load = useCallback(async () => {
    if (!userId) return
    try {
      const [flagEnabled, optedIn, backgroundGranted, suggestionCount] = await Promise.all([
        isFlagEnabled(userId, 'candidate_visit_detection'),
        fetchOptIn(userId),
        hasBackgroundLocationPermission().catch(() => false),
        countPendingSuggestions(userId),
      ])
      setSt({ flagEnabled, optedIn, backgroundGranted, suggestionCount })
    } catch (e) {
      console.warn('VisitRecoverySection load failed:', e?.message ?? e)
    } finally {
      setLoaded(true)
    }
  }, [userId])

  useFocusEffect(useCallback(() => { load() }, [load]))

  if (!loaded) return null

  const cardState = recoveryCardState({ ...st, platformOS: Platform.OS })
  const showInbox = shouldShowInboxEntry({ suggestionCount: st.suggestionCount, optedIn: st.optedIn })

  async function openSettings() {
    try { await Linking.openURL('app-settings:') } catch { Alert.alert('Open Settings', RECOVERY_COPY.permissionDeniedHint) }
  }

  function turnOn() {
    Alert.alert(RECOVERY_COPY.title, `${RECOVERY_COPY.intro}\n\n${RECOVERY_COPY.how}\n\n${RECOVERY_COPY.privacy}`, [
      { text: 'Not now', style: 'cancel' },
      {
        text: 'Turn on',
        onPress: async () => {
          setBusy(true)
          try {
            const { permission } = await enableVisitRecovery(userId)
            if (permission !== 'granted') Alert.alert('One more step', RECOVERY_COPY.permissionDeniedHint, [
              { text: 'Later', style: 'cancel' },
              { text: 'Open Settings', onPress: openSettings },
            ])
          } catch (e) {
            Alert.alert('Could not turn on', e?.message ?? 'Please try again.')
          } finally {
            setBusy(false)
            load()
          }
        },
      },
    ])
  }

  function turnOff() {
    Alert.alert(RECOVERY_COPY.turnOffTitle, RECOVERY_COPY.turnOffBody, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Turn off and delete',
        style: 'destructive',
        onPress: async () => {
          setBusy(true)
          try { await turnOffVisitRecovery() } catch (e) { Alert.alert('Could not turn off', e?.message ?? 'Please try again.') }
          setBusy(false)
          load()
        },
      },
    ])
  }

  if (cardState === 'hidden' && !showInbox) return null

  return (
    <View style={s.wrap}>
      {showInbox && (
        <TouchableOpacity style={s.inboxRow} onPress={() => openVisitInbox(navigation.getParent())} accessibilityRole="button" activeOpacity={0.85}>
          <Text style={s.inboxText}>📍 Places you may have visited</Text>
          {st.suggestionCount > 0 && <Text style={s.badge}>{st.suggestionCount}</Text>}
        </TouchableOpacity>
      )}

      {cardState !== 'hidden' && (
        <View style={s.card}>
          <Text style={s.title}>{RECOVERY_COPY.title}</Text>
          {cardState === 'unsupported_platform' && <Text style={s.body}>{RECOVERY_COPY.androidNote}</Text>}
          {cardState === 'off' && (
            <>
              <Text style={s.body}>{RECOVERY_COPY.intro}</Text>
              <Text style={s.small}>{RECOVERY_COPY.how}</Text>
              <TouchableOpacity style={s.primary} onPress={turnOn} disabled={busy} activeOpacity={0.85}>
                {busy ? <ActivityIndicator color="#1A1A2E" /> : <Text style={s.primaryText}>Turn on</Text>}
              </TouchableOpacity>
            </>
          )}
          {cardState === 'needs_permission' && (
            <>
              <Text style={s.body}>{RECOVERY_COPY.needsPermission}</Text>
              <TouchableOpacity style={s.primary} onPress={openSettings} activeOpacity={0.85}><Text style={s.primaryText}>Open Settings</Text></TouchableOpacity>
              <TouchableOpacity onPress={turnOff} disabled={busy}><Text style={s.link}>Turn off and delete visits</Text></TouchableOpacity>
            </>
          )}
          {cardState === 'paused' && (
            <>
              <Text style={s.body}>{RECOVERY_COPY.paused}</Text>
              <TouchableOpacity onPress={turnOff} disabled={busy}><Text style={s.link}>Turn off and delete visits</Text></TouchableOpacity>
            </>
          )}
          {cardState === 'on' && (
            <>
              <Text style={s.body}>On — we’ll note when you spend time at CheckOff places. {RECOVERY_COPY.privacy}</Text>
              <TouchableOpacity onPress={turnOff} disabled={busy}>{busy ? <ActivityIndicator color={AMBER} /> : <Text style={s.link}>Turn off and delete visits</Text>}</TouchableOpacity>
            </>
          )}
        </View>
      )}
    </View>
  )
}

function makeStyles({ CARD, TEXT, MUTED, BORDER, AMBER }) {
  return StyleSheet.create({
    wrap: { marginTop: 16, alignSelf: 'stretch' },
    inboxRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, paddingVertical: 14, paddingHorizontal: 16, marginBottom: 10 },
    inboxText: { color: TEXT, fontWeight: '700', fontSize: 15 },
    badge: { backgroundColor: AMBER, color: '#1A1A2E', fontWeight: '800', fontSize: 12, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, overflow: 'hidden' },
    card: { backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, padding: 16 },
    title: { color: TEXT, fontWeight: '800', fontSize: 15, marginBottom: 6 },
    body: { color: TEXT, fontSize: 13, lineHeight: 19 },
    small: { color: MUTED, fontSize: 12, lineHeight: 17, marginTop: 8 },
    primary: { backgroundColor: AMBER, borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 12 },
    primaryText: { color: '#1A1A2E', fontWeight: '800', fontSize: 14 },
    link: { color: MUTED, fontWeight: '700', fontSize: 13, marginTop: 12, textDecorationLine: 'underline' },
  })
}
