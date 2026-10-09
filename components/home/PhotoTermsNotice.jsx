// One time notice on Home for accounts created before the updated photo terms take effect. Closing it is stored on this device only; it records
// nothing on the server and is never treated as acceptance (lib/photoConsentVersion.js, docs/release/PHOTO_TERMS_PROPOSAL.md).
import React, { useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { PHOTO_TERMS_NOTICE, TERMS_URL, SUPPORT_EMAIL } from '../../lib/photoConsentCopy'
import { PHOTO_TERMS_EFFECTIVE_DATE, shouldShowPhotoTermsNotice } from '../../lib/photoConsentVersion'

const keyFor = (userId) => `photoTermsNoticeClosed_v1:${userId}`

export function formatEffectiveDate(iso = PHOTO_TERMS_EFFECTIVE_DATE) {
  const d = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

export default function PhotoTermsNotice({ user, colors }) {
  const { CARD, TEXT, MUTED, BORDER, AMBER } = colors
  const [state, setState] = useState({ loaded: false, closed: false })

  useEffect(() => {
    let cancelled = false
    if (!user?.id) return undefined
    AsyncStorage.getItem(keyFor(user.id))
      .then((v) => { if (!cancelled) setState({ loaded: true, closed: v === '1' }) })
      .catch(() => { if (!cancelled) setState({ loaded: true, closed: false }) })
    return () => { cancelled = true }
  }, [user?.id])

  if (!user?.id || !state.loaded) return null
  if (!shouldShowPhotoTermsNotice({ accountCreatedAt: user.created_at, dismissed: state.closed })) return null

  const close = () => {
    setState({ loaded: true, closed: true })
    AsyncStorage.setItem(keyFor(user.id), '1').catch(() => {})
  }

  return (
    <View style={[styles.card, { backgroundColor: CARD, borderColor: BORDER }]}>
      <Text style={[styles.title, { color: TEXT }]}>{PHOTO_TERMS_NOTICE.title}</Text>
      <Text style={[styles.body, { color: MUTED }]}>{PHOTO_TERMS_NOTICE.body}</Text>
      <Text style={[styles.body, { color: MUTED }]}>{PHOTO_TERMS_NOTICE.removal}</Text>
      <Text style={[styles.effective, { color: TEXT }]}>{PHOTO_TERMS_NOTICE.effectivePrefix}: {formatEffectiveDate()}</Text>
      <View style={styles.row}>
        <TouchableOpacity onPress={() => Linking.openURL(TERMS_URL).catch(() => {})} accessibilityRole="link">
          <Text style={[styles.link, { color: AMBER }]}>{PHOTO_TERMS_NOTICE.readTerms}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=Photo%20removal%20request`).catch(() => {})} accessibilityRole="link">
          <Text style={[styles.link, { color: AMBER }]}>{PHOTO_TERMS_NOTICE.emailSupport}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={close} accessibilityRole="button">
          <Text style={[styles.link, { color: MUTED }]}>{PHOTO_TERMS_NOTICE.dismiss}</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, padding: 14, marginHorizontal: 16, marginBottom: 12 },
  title: { fontSize: 15, fontWeight: '800', marginBottom: 6 },
  body: { fontSize: 13, lineHeight: 18, marginBottom: 6 },
  effective: { fontSize: 13, fontWeight: '700', marginBottom: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  link: { fontSize: 14, fontWeight: '700' },
})
