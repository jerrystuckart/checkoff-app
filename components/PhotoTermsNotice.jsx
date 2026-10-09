// Compact photo terms card on PROFILE (below the main account controls, not on Home) for accounts created before the updated terms (lib/photoConsentVersion.js). "Read details" opens the full explanation
// in a scrollable sheet. Dismissing or reading records nothing on the server and is never acceptance (lib/photoTermsNoticeState.js).
import React, { useEffect, useReducer } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Linking, Modal, ScrollView, Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { PHOTO_TERMS_NOTICE, PHOTO_TERMS_NOTICE_CARD, TERMS_URL, SUPPORT_EMAIL } from '../lib/photoConsentCopy'
import { PHOTO_TERMS_EFFECTIVE_DATE } from '../lib/photoConsentVersion'
import { initialNoticeState, noticeReducer, loadNoticeClosed, saveNoticeClosed, shouldRenderNotice } from '../lib/photoTermsNoticeState'
import { useBadgeCelebrationHold } from '../lib/badgeCelebrationStore'

export function formatEffectiveDate(iso = PHOTO_TERMS_EFFECTIVE_DATE) {
  const d = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

// Text in the card scales with the user's text size but is capped, and every row can wrap, so nothing clips at the largest sizes.
const MAX_SCALE = 1.35

export default function PhotoTermsNotice({ user, colors, style }) {
  const { CARD, TEXT, MUTED, BORDER, AMBER, BG } = colors
  const insets = useSafeAreaInsets()
  const [state, dispatch] = useReducer(noticeReducer, initialNoticeState)
  const userId = user?.id ?? null

  useEffect(() => {
    dispatch({ type: 'user_changed', userId })
    if (!userId) return undefined
    let cancelled = false
    loadNoticeClosed(AsyncStorage, userId).then((closed) => { if (!cancelled) dispatch({ type: 'loaded', userId, closed }) })
    return () => { cancelled = true }
  }, [userId])

  // No badge celebration may be presented over (or right after) the details sheet: use the existing hold mechanism.
  useBadgeCelebrationHold(state.detailsOpen)

  if (!shouldRenderNotice(state, user)) return null

  const dismiss = () => { dispatch({ type: 'dismiss' }); saveNoticeClosed(AsyncStorage, userId) }

  return (
    <View style={[styles.card, { backgroundColor: CARD, borderColor: BORDER }, style]}>
      <Text style={[styles.title, { color: TEXT }]} maxFontSizeMultiplier={MAX_SCALE}>{PHOTO_TERMS_NOTICE_CARD.title}</Text>
      <Text style={[styles.summary, { color: MUTED }]} maxFontSizeMultiplier={MAX_SCALE}>{PHOTO_TERMS_NOTICE_CARD.summary}</Text>
      <View style={styles.actions}>
        <TouchableOpacity style={styles.action} onPress={() => dispatch({ type: 'open_details' })} accessibilityRole="button" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={[styles.actionText, { color: AMBER }]} maxFontSizeMultiplier={MAX_SCALE}>{PHOTO_TERMS_NOTICE_CARD.readDetails}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.action} onPress={dismiss} accessibilityRole="button" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={[styles.actionText, { color: MUTED }]} maxFontSizeMultiplier={MAX_SCALE}>{PHOTO_TERMS_NOTICE_CARD.dismiss}</Text>
        </TouchableOpacity>
      </View>

      <Modal
        visible={state.detailsOpen}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
        transparent={false}
        onRequestClose={() => dispatch({ type: 'close_details' })}
      >
        <View style={[styles.sheet, { backgroundColor: BG ?? CARD, paddingTop: Platform.OS === 'ios' ? 12 : insets.top + 8 }]}>
          <View style={[styles.sheetHeader, { borderBottomColor: BORDER }]}>
            <Text style={[styles.sheetTitle, { color: TEXT }]} maxFontSizeMultiplier={MAX_SCALE} accessibilityRole="header">{PHOTO_TERMS_NOTICE.title}</Text>
            <TouchableOpacity onPress={() => dispatch({ type: 'close_details' })} accessibilityRole="button" accessibilityLabel="Close" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={[styles.closeText, { color: AMBER }]} maxFontSizeMultiplier={MAX_SCALE}>{PHOTO_TERMS_NOTICE.close}</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={[styles.sheetBody, { paddingBottom: insets.bottom + 24 }]}>
            <Text style={[styles.body, { color: TEXT }]}>{PHOTO_TERMS_NOTICE.body}</Text>
            <Text style={[styles.body, { color: TEXT }]}>{PHOTO_TERMS_NOTICE.removal}</Text>
            <Text style={[styles.effective, { color: TEXT }]}>{PHOTO_TERMS_NOTICE.effectivePrefix}: {formatEffectiveDate()}</Text>
            <TouchableOpacity style={styles.linkRow} onPress={() => Linking.openURL(TERMS_URL).catch(() => {})} accessibilityRole="link">
              <Text style={[styles.actionText, { color: AMBER }]}>{PHOTO_TERMS_NOTICE.readTerms}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.linkRow} onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=Photo%20removal%20request`).catch(() => {})} accessibilityRole="link">
              <Text style={[styles.actionText, { color: AMBER }]}>{PHOTO_TERMS_NOTICE.emailSupport}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.closeButton, { borderColor: BORDER }]} onPress={() => dispatch({ type: 'close_details' })} accessibilityRole="button">
              <Text style={[styles.closeButtonText, { color: TEXT }]}>{PHOTO_TERMS_NOTICE.close}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, marginHorizontal: 16, marginBottom: 10 },
  title: { fontSize: 14, fontWeight: '800', marginBottom: 2 },
  summary: { fontSize: 12, lineHeight: 16 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: 6 },
  action: { paddingVertical: 4, marginRight: 20 },
  actionText: { fontSize: 14, fontWeight: '700' },
  sheet: { flex: 1 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  sheetTitle: { flex: 1, fontSize: 18, fontWeight: '800', marginRight: 12 },
  closeText: { fontSize: 16, fontWeight: '700' },
  sheetBody: { paddingHorizontal: 20, paddingTop: 16 },
  body: { fontSize: 15, lineHeight: 22, marginBottom: 12 },
  effective: { fontSize: 15, fontWeight: '700', marginBottom: 8 },
  linkRow: { paddingVertical: 10 },
  closeButton: { marginTop: 16, borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  closeButtonText: { fontSize: 16, fontWeight: '700' },
})
