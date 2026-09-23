// Trip Mode MVP (2026-09-23) — retroactive "I did this earlier in the
// trip" check-off flow, reached from ItemDetailScreen's "Check off from
// this trip" secondary action (only ever offered alongside, never instead
// of, the live "I'VE DONE THIS" flow — see lib/tripModeCheckOffFlow.js's
// shouldShowTripModeEntry).
//
// Prop/structure conventions (visible/onClose/colors, Modal + overlay +
// bottom sheet, theme colors destructured with fallbacks) follow
// components/CheckInMemoryModal.jsx, this session's other new shared-sheet
// component, for consistency rather than inventing a new modal shape.
//
// Date picker: reuses @react-native-community/datetimepicker, the same
// library already used by screens/CreateListScreen.jsx for its own
// starts_at/ends_at pickers — no new dependency added. The picker's
// minimumDate/maximumDate are set directly from lib/tripMode.js's
// deriveTripModeDateWindow(...), so the OS control itself refuses to let
// the user scroll to a date the server would reject; the quick Today/
// Yesterday buttons come from that same module's getTripModeQuickChoices.
//
// Photo/memory step deliberately does NOT navigate to or reuse
// screens/PhotoCheckInScreen.jsx: that screen hard-gates its entire mount
// on checkGeoFence (via its own useEffect, screens/PhotoCheckInScreen.jsx
// lines ~57-68) and gives no way in for a flow whose entire point is that
// the user is NOT currently at the venue. Bending that gate open would
// mean editing a shared screen reached from five other call sites, which
// is a much bigger and riskier diff than the one this component makes
// instead: a small, self-contained photo picker + upload step that reuses
// the exact same mechanism PhotoCheckInScreen's own submitCheckIn() uses
// (expo-image-picker, the 'checkin-photos' storage bucket, the
// fetch(...).arrayBuffer() upload — NOT blob(), which serializes as 0
// bytes over RN's bridge, per that screen's own comment) rather than
// inventing a second one.
//
// Points (2026-09-23, v2 fix — release blocker): does NOT call
// lib/checkOffAttachment.js's resolveCheckOffAttachment() at all anymore.
// That function nulls out listItemId for any non-official (personal)
// list — including the actual target list for this release
// (692cb6bc-cbeb-4740-af6f-5f1833673a0f is itself is_official=false,
// confirmed live) — which made every one of the list's 25 real catalog
// items unusable via Trip Mode (the sheet's own guard correctly refused
// to submit a null listItemId, but that meant the feature never worked
// for its own target list). Trip Mode has no standalone path — list_item_id
// is mandatory — and unlike a seasonal live recheck, a Trip Mode
// completion is a one-time-ever record of a single bounded trip window, so
// the season-collision concern resolveCheckOffAttachment exists to avoid
// never applies here. This sheet now calls the Trip-Mode-specific
// lib/tripModeAttachment.js's resolveTripModeAttachment(listItemId)
// instead, which resolves point_multiplier without ever nulling the id.
// The REAL authorization (list membership, trip-mode-enabled, window,
// item/list-item consistency) happens server-side in the trigger
// regardless of which client resolver was used — this only changes
// whether a valid attempt is even allowed to reach that check.
//
// Points_awarded itself is ALSO now server-derived/overwritten by the
// trigger for this verification_method (a separate, second release-blocker
// fix — see the migration file) — the value computed and sent here is
// still correct and still sent, but is treated by the server as
// advisory/legacy-compatible only, never trusted.
//
// Candidate-visit soft cross-reference (tester-only, best-effort): right
// before building the payload, submit() does a read-only lookup against
// candidate_visits for a same-day match on this item, gated on
// users.visit_detection_tester (the exact same tester-cohort column
// supabase/migrations/20260902_visit_reminder_v1_notify_trigger.sql
// already gates its own visit-reminder notification on — not a new flag).
// Wrapped in try/catch and never awaited-to-block: any failure or
// non-tester user just leaves matched_candidate_visit_id null. This never
// reads or changes anything about WHO gets tracked or WHEN — purely a
// read against rows the existing (untouched) visit-detection pipeline
// already wrote — and is never surfaced in any user-facing UI.

import React, { useState, useMemo } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Modal,
  ActivityIndicator,
  Image,
  Alert,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
} from 'react-native'
import DateTimePicker from '@react-native-community/datetimepicker'
import * as ImagePicker from 'expo-image-picker'
import { supabase } from '../lib/supabase'
import { resolveTripModeAttachment } from '../lib/tripModeAttachment'
import {
  deriveTripModeDateWindow,
  getTripModeQuickChoices,
} from '../lib/tripMode'
import { toMetroDateString } from '../lib/seasonWindowPure'
import {
  computeTripModePointsAwarded,
  buildTripModeCheckInPayload,
  resolveTripModeCollisionOutcome,
} from '../lib/tripModeCheckOffFlow'

/**
 * @param {boolean} visible
 * @param {() => void} onClose
 * @param {object} colors  theme colors (see useTheme())
 * @param {object} item    the item being checked off (id, body, difficulty, allowsPersonalNote, personalPlaceLabel, personalPromptLabel)
 * @param {string} listItemId  REQUIRED — the list_item_id for THIS list, already resolved by the caller
 * @param {string} userId
 * @param {{startsAt: string|null, endsAt: string|null, graceDays: number, timezone: string}} tripWindow
 * @param {(result: {itemId: string, listItemId: string, pointsAwarded: number, experiencedAt: string}) => void} onSuccess
 *   Fires once the check-in is confirmed written (fresh insert OR a 23505
 *   collision resolved to an existing matching row) — caller owns the
 *   post-success flow (PostCheckoffSheet, trackEvent, points/streak
 *   refresh), same as every other check-off site in this app.
 */
export default function TripModeCheckOffSheet({
  visible,
  onClose,
  colors = {},
  item,
  listItemId,
  userId,
  tripWindow,
  onSuccess,
}) {
  const {
    CARD = '#1B1C26',
    TEXT = '#FFFFFF',
    MUTED = '#9AA0AE',
    BORDER = '#2E2F3A',
    AMBER = '#F5A623',
    BG = '#0F0F1E',
  } = colors

  const { startsAt = null, endsAt = null, graceDays = 7, timezone = 'America/Phoenix' } = tripWindow ?? {}

  const { minDate, maxDate } = useMemo(
    () => deriveTripModeDateWindow({ startsAt, endsAt, graceDays, timezone }),
    [startsAt, endsAt, graceDays, timezone]
  )
  const { today, yesterday } = useMemo(() => getTripModeQuickChoices(timezone), [timezone])

  const [selectedDate, setSelectedDate] = useState(today)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [step, setStep] = useState('date') // 'date' | 'memory'
  const [photo, setPhoto] = useState(null)
  const [personalPlace, setPersonalPlace] = useState('')
  const [personalNote, setPersonalNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function resetAndClose() {
    setSelectedDate(today)
    setShowDatePicker(false)
    setStep('date')
    setPhoto(null)
    setPersonalPlace('')
    setPersonalNote('')
    setSubmitting(false)
    onClose?.()
  }

  function handlePickerChange(_event, pickedDate) {
    if (Platform.OS !== 'ios') setShowDatePicker(false)
    if (!pickedDate) return
    // Date-only string in the LIST's timezone context — the picker itself
    // is already clamped to [minDate, maxDate] via minimumDate/maximumDate
    // below, so this is just formatting, not a second validation pass.
    const y = pickedDate.getFullYear()
    const m = String(pickedDate.getMonth() + 1).padStart(2, '0')
    const d = String(pickedDate.getDate()).padStart(2, '0')
    setSelectedDate(`${y}-${m}-${d}`)
  }

  async function pickFromLibrary() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo library access to attach a photo.')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaType?.images ?? ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    })
    if (!result.canceled && result.assets?.[0]) setPhoto(result.assets[0])
  }

  async function takePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow camera access to take a photo.')
      return
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 })
    if (!result.canceled && result.assets?.[0]) setPhoto(result.assets[0])
  }

  async function uploadPhotoIfAny() {
    if (!photo?.uri) return { photoUrl: null, photoWidth: null, photoHeight: null }

    const rawExt = photo.uri.split('.').pop()?.toLowerCase() ?? 'jpg'
    const contentExt = rawExt === 'jpg' ? 'jpeg' : rawExt
    const filename = `${userId}/${Date.now()}.${rawExt}`
    const response = await fetch(photo.uri)
    // arrayBuffer(), not blob() — blob() serializes as an empty (0-byte)
    // file across RN's bridge to Supabase Storage (same gotcha documented
    // in screens/PhotoCheckInScreen.jsx's submitCheckIn()).
    const arrayBuffer = await response.arrayBuffer()

    const { error: uploadErr } = await supabase.storage
      .from('checkin-photos')
      .upload(filename, arrayBuffer, { contentType: `image/${contentExt}`, upsert: false })

    if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`)

    const { data: urlData } = supabase.storage.from('checkin-photos').getPublicUrl(filename)
    return { photoUrl: urlData?.publicUrl ?? null, photoWidth: photo?.width ?? null, photoHeight: photo?.height ?? null }
  }

  // Tester-only, best-effort, silent-fail. Never blocks or delays the
  // check-off — any error or "not a tester"/"no match" result just
  // resolves to null. See this file's header comment for the full
  // rationale and the exact gating column reused.
  async function findMatchedCandidateVisitId() {
    try {
      const { data: userRow } = await supabase
        .from('users')
        .select('visit_detection_tester')
        .eq('id', userId)
        .maybeSingle()
      if (!userRow?.visit_detection_tester) return null
      if (!item?.id) return null

      const { data: candidates } = await supabase
        .from('candidate_visits')
        .select('id, arrival_at, confidence_score')
        .eq('user_id', userId)
        .eq('item_id', item.id)
        .order('confidence_score', { ascending: false })
        .limit(10)

      const sameDayMatch = (candidates ?? []).find(
        cv => toMetroDateString(cv.arrival_at, timezone) === selectedDate
      )
      return sameDayMatch?.id ?? null
    } catch {
      return null
    }
  }

  async function submit() {
    if (!userId) {
      Alert.alert('Sign in first', 'You need an account to check off items.')
      return
    }
    if (!listItemId) {
      Alert.alert('Trip Mode unavailable', "This item isn't set up for Trip Mode right now.")
      return
    }
    if (!selectedDate) {
      Alert.alert('Pick a date', 'Choose the day you did this.')
      return
    }

    setSubmitting(true)
    try {
      // Trip-Mode-specific resolver — never nulls listItemId regardless of
      // the list's official/personal status. See this file's header
      // comment and lib/tripModeAttachment.js for why.
      const attachment = await resolveTripModeAttachment(listItemId)
      if (!attachment) {
        Alert.alert('Trip Mode unavailable', "Couldn't find this item on the list — try again.")
        return
      }
      const resolvedListItemId = attachment.listItemId
      // Client-side defense-in-depth: catches an accidental item/list-item
      // mismatch early with a friendly message. The REAL, unbypassable
      // check is server-side in the trigger (item_id, if sent, must match
      // what list_item_id actually points to) — this is purely a better
      // error message for a case that would otherwise surface as a raw
      // Postgres error.
      if (item?.id && attachment.itemId && item.id !== attachment.itemId) {
        Alert.alert('Trip Mode unavailable', "This item doesn't match the trip list entry — try again.")
        return
      }
      const pointsAwarded = computeTripModePointsAwarded(item?.difficulty, attachment.pointMultiplier)

      const { photoUrl, photoWidth, photoHeight } = await uploadPhotoIfAny()

      // Best-effort, silent-fail, tester-only — see findMatchedCandidateVisitId's
      // own comment. Never blocks submission on failure.
      const matchedCandidateVisitId = await findMatchedCandidateVisitId().catch(() => null)

      const payload = buildTripModeCheckInPayload({
        userId,
        listItemId: resolvedListItemId,
        itemId: item?.id ?? null,
        pointsAwarded,
        experiencedAt: selectedDate,
        photoUrl,
        photoWidth,
        photoHeight,
        personalPlace: personalPlace.trim() || null,
        personalNote: personalNote.trim() || null,
        matchedCandidateVisitId,
      })

      const { error } = await supabase.from('check_ins').insert(payload)

      if (error) {
        if (error.code === '23505') {
          const { data: existingRows } = await supabase
            .from('check_ins')
            .select('id')
            .eq('user_id', userId)
            .eq('list_item_id', resolvedListItemId)
          const outcome = resolveTripModeCollisionOutcome({ existingRowCount: existingRows?.length ?? 0 })
          if (outcome === 'success') {
            resetAndClose()
            onSuccess?.({ itemId: item?.id ?? null, listItemId: resolvedListItemId, pointsAwarded, experiencedAt: selectedDate })
          } else {
            Alert.alert('Could not check off', 'Something went wrong — please try again.')
          }
          return
        }

        // Any other error is a trigger rejection (list not enabled, not a
        // member, date outside the window, etc.) or another Postgres
        // error — surfaced with the server's own message text, same as
        // every other check-off site in this app.
        Alert.alert('Could not check off', error.message ?? 'Please try again.')
        return
      }

      resetAndClose()
      onSuccess?.({ itemId: item?.id ?? null, listItemId: resolvedListItemId, pointsAwarded, experiencedAt: selectedDate })
    } catch (e) {
      Alert.alert('Could not check off', e?.message ?? 'Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const pickerDateObj = useMemo(() => {
    const [y, m, d] = (selectedDate || today).split('-').map(Number)
    return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0)
  }, [selectedDate, today])
  const minDateObj = minDate ? (() => { const [y, m, d] = minDate.split('-').map(Number); return new Date(y, m - 1, d) })() : undefined
  const maxDateObj = (() => { const [y, m, d] = maxDate.split('-').map(Number); return new Date(y, m - 1, d, 23, 59, 59) })()

  return (
    <Modal visible={!!visible} transparent animationType="slide" onRequestClose={resetAndClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={resetAndClose} />
        <View style={[styles.sheet, { backgroundColor: CARD, borderColor: BORDER }]}>
          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Deliberately distinct copy/visual treatment from the live
                "You are here" flow — never claims location verification. */}
            <Text style={[styles.badge, { color: AMBER, borderColor: AMBER }]}>TRIP MODE</Text>
            <Text style={[styles.title, { color: TEXT }]} numberOfLines={2}>
              {item?.body ?? 'this item'}
            </Text>

            {step === 'date' ? (
              <>
                <Text style={[styles.question, { color: TEXT }]}>When did you do this?</Text>

                <View style={styles.quickRow}>
                  <TouchableOpacity
                    style={[styles.quickBtn, { borderColor: BORDER }, selectedDate === today && { borderColor: AMBER }]}
                    onPress={() => { setSelectedDate(today); setShowDatePicker(false) }}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.quickBtnText, { color: selectedDate === today ? AMBER : TEXT }]}>Today</Text>
                  </TouchableOpacity>
                  {yesterday >= (minDate ?? yesterday) ? (
                    <TouchableOpacity
                      style={[styles.quickBtn, { borderColor: BORDER }, selectedDate === yesterday && { borderColor: AMBER }]}
                      onPress={() => { setSelectedDate(yesterday); setShowDatePicker(false) }}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.quickBtnText, { color: selectedDate === yesterday ? AMBER : TEXT }]}>Yesterday</Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    style={[styles.quickBtn, { borderColor: BORDER }, showDatePicker && { borderColor: AMBER }]}
                    onPress={() => setShowDatePicker(v => !v)}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.quickBtnText, { color: showDatePicker ? AMBER : TEXT }]}>Choose date</Text>
                  </TouchableOpacity>
                </View>

                {showDatePicker && (
                  <DateTimePicker
                    value={pickerDateObj}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'inline' : 'default'}
                    minimumDate={minDateObj}
                    maximumDate={maxDateObj}
                    onChange={handlePickerChange}
                    themeVariant="dark"
                  />
                )}

                <Text style={[styles.selectedDateLabel, { color: MUTED }]}>Selected: {selectedDate}</Text>

                <TouchableOpacity
                  style={[styles.primaryBtn, { backgroundColor: AMBER }]}
                  onPress={submit}
                  disabled={submitting}
                  activeOpacity={0.85}
                >
                  {submitting ? <ActivityIndicator color={BG} /> : <Text style={styles.primaryBtnText}>Check it off</Text>}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.secondaryBtn, { borderColor: BORDER }]}
                  onPress={() => setStep('memory')}
                  disabled={submitting}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.secondaryBtnText, { color: TEXT }]}>Add photo or memory</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={[styles.question, { color: TEXT }]}>Add a photo or memory (optional)</Text>

                {photo?.uri ? (
                  <Image source={{ uri: photo.uri }} style={styles.photoPreview} resizeMode="cover" />
                ) : (
                  <View style={styles.photoPickRow}>
                    <TouchableOpacity style={[styles.photoPickBtn, { borderColor: BORDER }]} onPress={takePhoto} activeOpacity={0.85}>
                      <Text style={[styles.photoPickBtnText, { color: TEXT }]}>Take photo</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.photoPickBtn, { borderColor: BORDER }]} onPress={pickFromLibrary} activeOpacity={0.85}>
                      <Text style={[styles.photoPickBtnText, { color: TEXT }]}>Choose from library</Text>
                    </TouchableOpacity>
                  </View>
                )}

                <TextInput
                  style={[styles.input, { color: TEXT, borderColor: BORDER }]}
                  placeholder={item?.personalPlaceLabel ?? 'Place or location'}
                  placeholderTextColor={MUTED}
                  value={personalPlace}
                  onChangeText={setPersonalPlace}
                />
                <TextInput
                  style={[styles.input, styles.noteInput, { color: TEXT, borderColor: BORDER }]}
                  placeholder={item?.personalPromptLabel ?? 'Any notes?'}
                  placeholderTextColor={MUTED}
                  value={personalNote}
                  onChangeText={setPersonalNote}
                  multiline
                />

                <TouchableOpacity
                  style={[styles.primaryBtn, { backgroundColor: AMBER }]}
                  onPress={submit}
                  disabled={submitting}
                  activeOpacity={0.85}
                >
                  {submitting ? <ActivityIndicator color={BG} /> : <Text style={styles.primaryBtnText}>Check it off</Text>}
                </TouchableOpacity>

                <TouchableOpacity style={styles.backLink} onPress={() => setStep('date')} disabled={submitting}>
                  <Text style={[styles.backLinkText, { color: MUTED }]}>Back</Text>
                </TouchableOpacity>
              </>
            )}

            <TouchableOpacity style={styles.closeBtn} onPress={resetAndClose} disabled={submitting}>
              <Text style={[styles.closeBtnText, { color: MUTED }]}>Cancel</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    borderTopWidth: 1,
    maxHeight: '85%',
  },
  badge: {
    alignSelf: 'flex-start',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 16,
    lineHeight: 24,
  },
  question: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 12,
  },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  quickBtn: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  quickBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  selectedDateLabel: {
    fontSize: 12,
    marginBottom: 16,
  },
  primaryBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  primaryBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F0F1E',
  },
  secondaryBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    marginBottom: 6,
  },
  secondaryBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  photoPickRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  photoPickBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  photoPickBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  photoPreview: {
    width: '100%',
    height: 180,
    borderRadius: 12,
    marginBottom: 16,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    marginBottom: 10,
  },
  noteInput: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
  backLink: {
    alignItems: 'center',
    paddingVertical: 6,
    marginBottom: 4,
  },
  backLinkText: {
    fontSize: 13,
    fontWeight: '600',
  },
  closeBtn: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  closeBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
})
