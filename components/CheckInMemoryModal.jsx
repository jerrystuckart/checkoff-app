// Check-In Memory Viewer (2026-09-23) — shared read-only viewer for a
// saved photo check-in memory, used from Item Detail, Home, and Nearby.
// Visual/behavioral pattern (title/date/photo/place/note/"no memory"
// fallback) lifted from screens/ListScreen.jsx's own detail sheet
// (~line 1862-1920), reimplemented here as an importable component since
// ListScreen.jsx's version is private/inline and ListScreen.jsx itself is
// out of scope to edit. This is the SAME memory model (check_ins rows),
// just a shared viewer rather than a second one.
//
// `colors` follows the established theme-prop convention already used by
// components/home/WhatsTheThingHero.jsx and components/PostCheckoffSheet.jsx
// (colors destructured from useTheme() in the parent, passed down as a prop
// rather than this component calling useTheme() itself).

import React, { useState } from 'react'
import {
  View,
  Text,
  Image,
  Modal,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native'

function formatCheckInDate(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  if (Number.isNaN(d.getTime())) return ''
  const datePart = d.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })
  const timePart = d.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
  return `${datePart} at ${timePart}`
}

// Small PhotoWithLoader-equivalent, written fresh (not imported from
// ListScreen.jsx, which does not export it) — same behavior: spinner while
// loading, fails safely to a blank tile (no crash, no broken-image icon) if
// the photo 404s or the URL is missing/deleted.
function MemoryPhoto({ uri, style, colors }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const { CARD_ELEVATED = '#22232E', MUTED = '#9AA0AE' } = colors ?? {}

  if (!uri || error) {
    return (
      <View style={[style, { backgroundColor: CARD_ELEVATED, alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={{ color: MUTED, fontSize: 13 }}>Photo unavailable</Text>
      </View>
    )
  }

  return (
    <View style={[style, { overflow: 'hidden', backgroundColor: CARD_ELEVATED }]}>
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
        onLoadEnd={() => setLoading(false)}
        onError={() => { setLoading(false); setError(true) }}
      />
      {loading && (
        <ActivityIndicator style={StyleSheet.absoluteFill} color={MUTED} />
      )}
    </View>
  )
}

/**
 * @param {boolean} visible
 * @param {() => void} onClose
 * @param {string} itemBody - item title, passed in by the caller
 * @param {boolean} loading - true while the detail fetch is in flight
 * @param {{checked_at, photo_url, personal_place, personal_note}|null} detail
 * @param {object} colors - theme colors object (see useTheme())
 * @param {() => void} [onEditMemory] - optional secondary action (e.g. add/retake a photo); omitted renders no secondary action
 * @param {string} [editLabel]
 */
export default function CheckInMemoryModal({
  visible,
  onClose,
  itemBody,
  loading = false,
  detail = null,
  colors = {},
  onEditMemory = null,
  editLabel = 'Add a memory',
}) {
  const {
    CARD = '#1B1C26',
    TEXT = '#FFFFFF',
    MUTED = '#9AA0AE',
    BORDER = '#2E2F3A',
    AMBER = '#F5A623',
  } = colors

  const hasMemoryContent = !!(detail && (detail.personal_place || detail.personal_note))

  return (
    <Modal visible={!!visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity
          activeOpacity={1}
          style={[styles.sheet, { backgroundColor: CARD, borderColor: BORDER }]}
        >
          {loading ? (
            <ActivityIndicator color={AMBER} style={{ marginVertical: 32 }} />
          ) : !detail ? (
            <Text style={[styles.fallback, { color: MUTED }]}>Check-in details unavailable.</Text>
          ) : (
            <>
              <Text style={[styles.title, { color: TEXT }]} numberOfLines={0}>
                {itemBody ?? ''}
              </Text>

              {detail.checked_at ? (
                <Text style={[styles.date, { color: MUTED }]}>
                  {formatCheckInDate(detail.checked_at)}
                </Text>
              ) : null}

              {detail.photo_url ? (
                <MemoryPhoto uri={detail.photo_url} style={styles.photo} colors={colors} />
              ) : null}

              {detail.personal_place ? (
                <Text style={[styles.place, { color: TEXT }]}>📍 {detail.personal_place}</Text>
              ) : null}

              {detail.personal_note ? (
                <Text style={[styles.note, { color: MUTED }]}>{detail.personal_note}</Text>
              ) : null}

              {!hasMemoryContent && !detail.photo_url ? (
                <Text style={[styles.noMemory, { color: MUTED }]}>No memory added for this one.</Text>
              ) : null}

              {onEditMemory ? (
                <TouchableOpacity style={styles.editBtn} onPress={onEditMemory} activeOpacity={0.85}>
                  <Text style={[styles.editBtnText, { color: AMBER }]}>{editLabel}</Text>
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.85}>
                <Text style={[styles.closeBtnText, { color: MUTED }]}>Close</Text>
              </TouchableOpacity>
            </>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
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
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 6,
    lineHeight: 24,
  },
  date: {
    fontSize: 13,
    marginBottom: 16,
  },
  photo: {
    width: '100%',
    height: 220,
    borderRadius: 12,
    marginBottom: 16,
  },
  place: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 6,
  },
  note: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  noMemory: {
    fontSize: 14,
    fontStyle: 'italic',
    marginBottom: 16,
  },
  fallback: {
    fontSize: 14,
    textAlign: 'center',
    marginVertical: 32,
  },
  editBtn: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 4,
  },
  editBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
  closeBtn: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  closeBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
})
