import React, { useEffect, useState } from 'react'
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native'
import { supabase } from '../lib/supabase'

const NAVY = '#0F0F1E'
const AMBER = '#F5A623'
const MUTED = 'rgba(255,255,255,0.5)'

/**
 * DeepLinkListResolverScreen
 *
 * Destination for checkoff://list?id=SLUG&city=CITY_SLUG deep links.
 *
 * Resolution priority:
 *   STEP 1 — slug exact + city_slug     (most specific, requires slug column populated)
 *   STEP 2 — slug exact only            (any city)
 *   STEP 3 — title word-pattern + city  (handles apostrophes: 'west%valley%best%')
 *   STEP 4 — title word-pattern only    (any city)
 *   STEP 5 — BrowseLists fallback
 *
 * Route params:
 *   id        — slug, e.g. 'west-valley-best'
 *   city      — city_slug, e.g. 'phoenix'  (optional)
 *   heroImage — forwarded from ExperiencesRail card image (optional)
 */
export default function DeepLinkListResolverScreen({ route, navigation }) {
  const { id, city } = route.params ?? {}
  const [fetchError, setFetchError] = useState(null)

  useEffect(() => {
    resolveList()
  }, [])

  async function resolveList() {
    setFetchError(null)

    if (!id && !city) {
      setFetchError('no_list')
      navigation.replace('BrowseLists')
      return
    }

    const SELECT = 'id, title, tagline, city_slug, audience_groups (name, tagline, emoji)'

    // Build a word-by-word wildcard pattern so 'west-valley-best' matches
    // "West Valley's Best" despite apostrophes or extra punctuation.
    // e.g. 'west-valley-best' → '%west%valley%best%'
    const titlePattern = id
      ? '%' + String(id).replace(/[-_]+/g, '%').trim() + '%'
      : null

    let listRow = null
    try {
      // ── STEP 1: slug exact + city_slug (most specific) ───────────────────
      if (id && city) {
        const { data, error } = await supabase
          .from('curated_lists')
          .select(SELECT)
          .eq('slug', id)
          .eq('city_slug', city)
          .maybeSingle()
        if (error) throw error
        if (data) listRow = data
      }

      // ── STEP 2: slug exact, any city ─────────────────────────────────────
      if (!listRow && id) {
        const { data, error } = await supabase
          .from('curated_lists')
          .select(SELECT)
          .eq('slug', id)
          .maybeSingle()
        if (error) throw error
        if (data) listRow = data
      }

      // ── STEP 3: title word-pattern + city (handles apostrophes) ──────────
      if (!listRow && titlePattern && city) {
        const { data, error } = await supabase
          .from('curated_lists')
          .select(SELECT)
          .ilike('title', titlePattern)
          .eq('city_slug', city)
          .limit(1)
          .maybeSingle()
        if (error) throw error
        if (data) listRow = data
      }

      // ── STEP 4: title word-pattern only (any city) ───────────────────────
      if (!listRow && titlePattern) {
        const { data, error } = await supabase
          .from('curated_lists')
          .select(SELECT)
          .ilike('title', titlePattern)
          .limit(1)
          .maybeSingle()
        if (error) throw error
        if (data) listRow = data
      }
    } catch (e) {
      console.error('DeepLinkListResolverScreen resolveList error:', e?.message ?? e)
      setFetchError('fetch_failed')
      navigation.replace('BrowseLists')
      return
    }

    if (!listRow) {
      setFetchError('no_list')
      navigation.replace('BrowseLists')
      return
    }

    const ag = listRow.audience_groups
    navigation.replace('CuratedListPreview', {
      curatedListId: listRow.id,
      groupName:     ag?.name    ?? listRow.title,
      groupEmoji:    ag?.emoji   ?? undefined,
      groupTagline:  ag?.tagline ?? listRow.tagline ?? undefined,
      citySlug:      listRow.city_slug ?? undefined,
      groupImageUrl: route.params?.heroImage ?? undefined,
    })
  }

  return (
    <View style={styles.container}>
      <ActivityIndicator size="small" color={AMBER} />
      <Text style={styles.text}>
        {fetchError ? 'List not found — heading to Browse Lists…' : 'Opening list…'}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  text: {
    fontSize: 13,
    color: MUTED,
  },
})
