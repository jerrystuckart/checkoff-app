import React, { useEffect, useMemo, useState } from 'react'
import { View, Text, TextInput, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet, Keyboard } from 'react-native'
import { supabase } from '../lib/supabase'
import { useTheme } from '../lib/ThemeContext'
import { fetchMetroSearchIndex, searchMetroIndex, MIN_QUERY_LENGTH } from '../lib/metroSearch'
import { resolveItemLink, planItemNavigation } from '../lib/linkResolution'

// Search Metro. Params: { metroId, metroName }. Searches EVERY active, approved, non-secret experience in the metro, from
// anywhere: it never reads the user's location, never depends on curated-list membership, and is separate from Nearby.
export default function MetroSearchScreen({ route, navigation }) {
  const { metroId, metroName } = route.params ?? {}
  const { colors } = useTheme()
  const { BG, CARD, TEXT, MUTED, BORDER, AMBER } = colors
  const styles = useMemo(() => createStyles({ BG, CARD, TEXT, MUTED, BORDER, AMBER }), [BG, CARD, TEXT, MUTED, BORDER, AMBER])
  const label = (metroName ?? '').replace(' Metro', '') || 'this city'
  const [index, setIndex] = useState(null)
  const [error, setError] = useState(false)
  const [text, setText] = useState('')
  const [opening, setOpening] = useState(null)

  useEffect(() => {
    let alive = true
    fetchMetroSearchIndex(supabase, metroId)
      .then((rows) => alive && setIndex(rows))
      .catch((e) => { console.warn('[metro search] index failed:', e?.message ?? e); if (alive) setError(true) })
    return () => { alive = false }
  }, [metroId])

  const results = useMemo(() => (index ? searchMetroIndex(index, text) : []), [index, text])
  const queried = text.trim().length >= MIN_QUERY_LENGTH

  // Opening an exact item never depends on proximity: it resolves the item by id (active + approved) like a deep link does.
  async function openItem(id) {
    if (opening) return
    setOpening(id)
    try {
      const result = await resolveItemLink(supabase, id)
      if (result.status === 'ok') {
        Keyboard.dismiss()
        const plan = planItemNavigation(result, { cold: false })
        navigation.navigate(plan.name, plan.params)
      }
    } catch (e) {
      console.warn('[metro search] open failed:', e?.message ?? e)
    } finally {
      setOpening(null)
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.searchBox}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder={`Search all of ${label}`}
          placeholderTextColor={MUTED}
          autoFocus
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="while-editing"
          accessibilityLabel={`Search all of ${label}`}
          testID="metro-search-input"
        />
      </View>
      <Text style={styles.scope}>{`Searching every CheckOff experience in ${label}, wherever you are.`}</Text>
      {error ? (
        <Text style={styles.empty}>Search is unavailable right now. Please try again.</Text>
      ) : !index ? (
        <ActivityIndicator color={AMBER} style={{ marginTop: 32 }} />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(r) => r.id}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={queried ? <Text style={styles.empty}>{`No experiences found in ${label} for "${text.trim()}".`}</Text> : <Text style={styles.empty}>Try a business name, a food or activity, or a neighborhood.</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} onPress={() => openItem(item.id)} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={item.title}>
              <Text style={styles.title} numberOfLines={3}>{item.title}</Text>
              <Text style={styles.meta} numberOfLines={1}>{[item.venue, item.neighborhood].filter(Boolean).join(' · ')}</Text>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  )
}

const createStyles = ({ BG, CARD, TEXT, MUTED, BORDER, AMBER }) => StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  searchBox: { margin: 16, marginBottom: 6, borderRadius: 14, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD },
  input: { paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: TEXT },
  scope: { color: MUTED, fontSize: 12, marginHorizontal: 18, marginBottom: 8 },
  row: { marginHorizontal: 16, marginVertical: 5, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD },
  title: { color: TEXT, fontSize: 15, fontWeight: '600' },
  meta: { color: MUTED, fontSize: 12, marginTop: 4 },
  empty: { color: MUTED, fontSize: 14, textAlign: 'center', marginTop: 40, paddingHorizontal: 32 },
})
