// Switch City picker — a real Modal + scrollable list, not Alert.alert.
//
// Bug this fixes: Alert.alert(title, message, buttons) on Android maps
// buttons to the native AlertDialog's positive/negative/neutral slots,
// which caps rendered buttons at 3 — anything past the first 3 entries is
// silently dropped. iOS's Alert.alert has no such cap. With every active
// metro (from metro_areas, alphabetically ordered) plus a trailing Cancel
// button passed as the `buttons` array, Android only ever showed the
// first 3 (currently Denver/Milwaukee/Phoenix), permanently hiding any
// metro alphabetically after them (Tucson, San Diego, Vienna) — not a
// data or query problem, an unsuitable native primitive for a
// variable-length list. A Modal has no such per-platform button cap.

import React from 'react'
import { Modal, View, Text, TouchableOpacity, FlatList, StyleSheet, Pressable } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export default function CityPickerModal({ visible, metros, onSelect, onClose, colors }) {
  const insets = useSafeAreaInsets()
  const { BG, CARD, TEXT, MUTED, BORDER, AMBER } = colors

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: BG, paddingBottom: insets.bottom + 12 }]} onPress={() => {}}>
          <View style={styles.handle} />
          <Text style={[styles.title, { color: TEXT }]}>Switch City</Text>
          <Text style={[styles.subtitle, { color: MUTED }]}>Choose your city</Text>

          <FlatList
            data={metros}
            keyExtractor={item => String(item.id)}
            style={styles.list}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.row, { borderColor: BORDER, backgroundColor: CARD }]}
                onPress={() => onSelect(item)}
                activeOpacity={0.75}
              >
                <Text style={[styles.rowText, { color: TEXT }]}>{item.name.replace(' Metro', '')}</Text>
              </TouchableOpacity>
            )}
            ItemSeparatorComponent={() => <View style={styles.sep} />}
          />

          <TouchableOpacity style={styles.cancelBtn} onPress={onClose} activeOpacity={0.75}>
            <Text style={[styles.cancelText, { color: AMBER }]}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet:     { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 10, paddingHorizontal: 20, maxHeight: '75%' },
  handle:    { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(120,120,120,0.35)', marginBottom: 14 },
  title:     { fontSize: 18, fontWeight: '900', textAlign: 'center' },
  subtitle:  { fontSize: 13, fontWeight: '600', textAlign: 'center', marginTop: 2, marginBottom: 14 },
  list:      { flexGrow: 0 },
  row:       { borderWidth: 1, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16 },
  rowText:   { fontSize: 15, fontWeight: '700', textAlign: 'center' },
  sep:       { height: 10 },
  cancelBtn: { paddingVertical: 14, marginTop: 12 },
  cancelText:{ fontSize: 15, fontWeight: '800', textAlign: 'center' },
})
