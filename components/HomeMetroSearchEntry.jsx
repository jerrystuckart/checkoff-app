import React from 'react'
import { TouchableOpacity, Text, View, StyleSheet } from 'react-native'

// Entry point on Home for "Search Metro": opens the full-catalog search for the metro currently selected on Home.
// Search Metro is not Nearby: it never uses the user's location.
export default function HomeMetroSearchEntry({ metro, colors, navigation }) {
  if (!metro?.id) return null
  const label = (metro.name ?? '').replace(' Metro', '') || 'this city'
  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={[styles.bar, { backgroundColor: colors.CARD, borderColor: colors.BORDER }]}
        activeOpacity={0.8}
        onPress={() => navigation.navigate('MetroSearch', { metroId: metro.id, metroName: metro.name, metroSlug: metro.slug })}
        accessibilityRole="search"
        accessibilityLabel={`Search all of ${label}`}
        accessibilityHint="Searches every CheckOff experience in this city, wherever you are"
        testID="home-metro-search-entry"
      >
        <Text style={styles.icon}>🔍</Text>
        <Text style={[styles.text, { color: colors.MUTED }]} numberOfLines={1}>{`Search all of ${label}`}</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  bar: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
  icon: { fontSize: 16, marginRight: 10 },
  text: { fontSize: 15, flex: 1 },
})
