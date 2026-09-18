import React, { useEffect } from 'react'
import { View, ActivityIndicator, StyleSheet } from 'react-native'
import { supabase } from '../lib/supabase'

const NAVY = '#0F0F1E'
const AMBER = '#F5A623'

/**
 * DeepLinkItemResolverScreen
 *
 * Destination for checkoff://item/:id deep links — mirrors
 * screens/DeepLinkExperienceResolverScreen.jsx's resolve-then-replace
 * pattern exactly. OTA-safe: App.jsx's linking config is pure JS, and the
 * checkoff:// scheme is already globally trusted, so this route ships
 * with no native rebuild. Universal-link (https://getcheckoff.com/item/:id)
 * resolution on iOS follows once the server-side AASA file is updated —
 * out of scope here (web work). Android intentFilters explicitly enumerate
 * path prefixes and do NOT include `item` — adding it needs a native
 * rebuild, deliberately not done in this pass.
 *
 * Resolution:
 *   1. Fetch the item row by id.
 *   2. If found -> navigation.replace('ItemDetail', { item })
 *   3. Otherwise -> fall back to BrowseLists (same fallback target
 *      DeepLinkExperienceResolverScreen uses for a miss).
 *
 * Route params:
 *   id — the item's uuid.
 */
export default function DeepLinkItemResolverScreen({ route, navigation }) {
  const { id } = route.params ?? {}

  useEffect(() => {
    resolveItem()
  }, [])

  async function resolveItem() {
    if (!id) {
      navigation.replace('BrowseLists')
      return
    }

    try {
      const { data, error } = await supabase
        .from('items')
        .select('*')
        .eq('id', id)
        .maybeSingle()

      if (error) throw error

      if (data) {
        navigation.replace('ItemDetail', { item: data })
        return
      }
    } catch (e) {
      console.error('[deep link] DeepLinkItemResolverScreen error:', e?.message ?? e)
    }

    console.log(`[deep link] checkoff://item/${id} — item not found; forwarding to BrowseLists`)
    navigation.replace('BrowseLists')
  }

  return (
    <View style={styles.container}>
      <ActivityIndicator size="small" color={AMBER} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
