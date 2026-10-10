// Compact chooser for Home's "Explore destinations →" link when the selected metro has several eligible hubs.
// Same sheet pattern as CityPickerModal (a real Modal: Alert.alert caps buttons on Android).
import React from 'react'
import { Modal, View, Text, TouchableOpacity, FlatList, StyleSheet, Pressable } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export default function HubChooserModal({ visible, hubs, onSelect, onClose, colors }) {
  const insets = useSafeAreaInsets()
  const { BG, CARD, TEXT, MUTED, BORDER, AMBER } = colors

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: BG, paddingBottom: insets.bottom + 12 }]} onPress={() => {}}>
          <View style={styles.handle} />
          <Text style={[styles.title, { color: TEXT }]}>Explore destinations</Text>
          <Text style={[styles.subtitle, { color: MUTED }]}>Places worth the trip</Text>

          <FlatList
            data={hubs}
            keyExtractor={(item) => String(item.id)}
            style={styles.list}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.row, { borderColor: BORDER, backgroundColor: CARD }]}
                onPress={() => onSelect(item)}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel={`Explore ${item.name}`}
              >
                <Text style={[styles.rowText, { color: TEXT }]} numberOfLines={2}>{item.name}</Text>
                <Text style={[styles.chevron, { color: MUTED }]}>›</Text>
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
  row:       { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16 },
  rowText:   { flex: 1, fontSize: 15, fontWeight: '700' },
  chevron:   { fontSize: 20, marginLeft: 8 },
  sep:       { height: 10 },
  cancelBtn: { paddingVertical: 14, marginTop: 12 },
  cancelText:{ fontSize: 15, fontWeight: '800', textAlign: 'center' },
})
