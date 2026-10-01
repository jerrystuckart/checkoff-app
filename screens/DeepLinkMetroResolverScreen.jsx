import React, { useEffect, useRef, useState } from 'react'
import { View, Text, ActivityIndicator, TouchableOpacity, StyleSheet } from 'react-native'
import { supabase } from '../lib/supabase'
import { resolveMetroLink, planHomeNavigation } from '../lib/linkResolution'
import { setExplicitMetro } from '../lib/explicitMetroIntent'

const NAVY = '#0F0F1E'
const AMBER = '#F5A623'
const MUTED = 'rgba(255,255,255,0.6)'

/**
 * DeepLinkMetroResolverScreen
 *
 * Destination for https://getcheckoff.com/metro?slug=<metro slug> and checkoff://metro?slug=<slug>.
 * Resolves the exact ACTIVE metro, makes it the browsing context (lib/explicitMetroIntent.js: session scoped,
 * not persisted, so it never redefines the persisted choice), and opens Home, which shows the selected metro
 * the same way Switch City does. Current location cannot replace it.
 *
 * Route params:
 *   slug — metro_areas.slug (canonical)
 *   id   — metro_areas.id (optional alternative)
 *
 * An unknown, inactive or malformed metro shows a controlled message; it never selects a different metro and
 * never silently opens another screen. Positano and Willcox are destinations, not metros, and resolve to
 * "unavailable" here.
 */
export default function DeepLinkMetroResolverScreen({ route, navigation }) {
  const { slug, id } = route.params ?? {}
  const [unavailable, setUnavailable] = useState(false)
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    resolve()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function resolve() {
    try {
      const result = await resolveMetroLink(supabase, { slug, id })
      if (result.status === 'ok') {
        setExplicitMetro(result.metro, 'metro_link')
        const plan = planHomeNavigation()
        navigation.reset({ index: plan.routes.length - 1, routes: plan.routes })
        return
      }
    } catch (e) {
      console.error('[deep link] DeepLinkMetroResolverScreen error:', e?.message ?? e)
    }
    setUnavailable(true)
  }

  if (unavailable) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>That city isn't available right now.</Text>
        <TouchableOpacity style={styles.btn} activeOpacity={0.8} accessibilityRole="button" onPress={() => navigation.replace('Home')}>
          <Text style={styles.btnText}>Back to Home</Text>
        </TouchableOpacity>
      </View>
    )
  }
  return (
    <View style={styles.container}>
      <ActivityIndicator size="small" color={AMBER} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 32 },
  message: { fontSize: 15, color: MUTED, textAlign: 'center' },
  btn: { backgroundColor: AMBER, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 24 },
  btnText: { fontSize: 14, fontWeight: '800', color: NAVY },
})
