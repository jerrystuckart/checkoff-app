import React, { useEffect, useRef, useState } from 'react'
import { View, Text, ActivityIndicator, TouchableOpacity, StyleSheet } from 'react-native'
import { supabase } from '../lib/supabase'
import { resolveItemLink, planItemNavigation } from '../lib/linkResolution'
import { setExplicitMetro } from '../lib/explicitMetroIntent'

const NAVY = '#0F0F1E'
const AMBER = '#F5A623'
const MUTED = 'rgba(255,255,255,0.6)'

// RFC-4122-shaped UUID check — used to reject obviously malformed ids
// client-side before they ever reach a `.eq()` filter, so a bad param
// can't produce a raw Postgres "invalid input syntax for type uuid" error.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * DeepLinkItemResolverScreen
 *
 * Destination for checkoff://item/:id deep links — mirrors
 * screens/DeepLinkExperienceResolverScreen.jsx's resolve-then-replace
 * pattern. OTA-safe: App.jsx's linking config is pure JS, and the
 * checkoff:// scheme is already globally trusted, so this route ships
 * with no native rebuild. Universal-link (https://getcheckoff.com/item/:id)
 * resolution on iOS follows once the server-side AASA file is updated —
 * out of scope here (web work). Android intentFilters explicitly enumerate
 * path prefixes and do NOT include `item` — adding it needs a native
 * rebuild, deliberately not done in this pass.
 *
 * Resolution:
 *   1. Fetch the item row by id, scoped to the same live-catalog filter
 *      the rest of the app already uses (is_active + is_approved — see
 *      lib/useItems.js, screens/HomeScreen.jsx, screens/ListScreen.jsx,
 *      screens/DiscoverScreen.jsx). An inactive/unapproved item's row is
 *      never returned by this query at all.
 *   2. If found -> navigation.replace('ItemDetail', { item }). This
 *      includes active secret items — ItemDetailScreen.jsx already owns
 *      the ONLY secret-reveal guard (redirects internally to
 *      SecretReveal when unchecked); nothing secret-specific is
 *      duplicated here.
 *   3. Missing id, malformed-UUID id, not-found id, and found-but-inactive
 *      id are all indistinguishable outcomes from here on out: none of
 *      them navigate to ItemDetail, and all of them render the same
 *      "unavailable" state below. This is deliberate — it must not be
 *      possible to infer "this id exists but is inactive" vs "this id
 *      doesn't exist" from the app's behavior.
 *
 * Route params:
 *   id — the item's uuid.
 */
export default function DeepLinkItemResolverScreen({ route, navigation }) {
  const { id } = route.params ?? {}
  const [unavailable, setUnavailable] = useState(false)
  const hasFetchedRef = useRef(false)

  useEffect(() => {
    if (hasFetchedRef.current) return
    hasFetchedRef.current = true
    resolveItem()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Explicit navigation intent: resolve the item from production data, derive ITS metro from the item, make
  // that metro the browsing context (lib/explicitMetroIntent.js, session scoped, never persisted), and only
  // then open the exact item. Location refresh and nearest metro logic cannot replace it.
  async function resolveItem() {
    try {
      const result = await resolveItemLink(supabase, id)
      if (result.status === 'ok') {
        if (result.metro) setExplicitMetro(result.metro, 'item_link')
        const cold = (navigation.getState?.()?.routes?.length ?? 1) <= 1
        const plan = planItemNavigation(result, { cold })
        if (plan.type === 'reset') navigation.reset({ index: plan.routes.length - 1, routes: plan.routes })
        else navigation.replace(plan.name, plan.params)
        return
      }
    } catch (e) {
      // Never surface internal error text in the UI; an unexpected failure shows the same state as "not found".
      console.error('[deep link] DeepLinkItemResolverScreen error:', e?.message ?? e)
    }
    console.log('[deep link] item link unavailable; showing unavailable state')
    setUnavailable(true)
  }

  if (unavailable) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>This experience isn't available right now.</Text>
        <TouchableOpacity
          style={styles.homeBtn}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Return to Home"
          onPress={() => navigation.replace('Home')}
        >
          <Text style={styles.homeBtnText}>Back to Home</Text>
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
  container: {
    flex: 1,
    backgroundColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 32,
  },
  message: {
    fontSize: 15,
    color: MUTED,
    textAlign: 'center',
  },
  homeBtn: {
    backgroundColor: AMBER,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  homeBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: NAVY,
  },
})
