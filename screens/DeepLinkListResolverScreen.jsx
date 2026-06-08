import React, { useEffect, useState } from 'react'
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native'
import { supabase } from '../lib/supabase'

const NAVY = '#0F0F1E'
const AMBER = '#F5A623'
const MUTED = 'rgba(255,255,255,0.5)'

/**
 * DeepLinkListResolverScreen
 *
 * Destination for checkoff://list?id=SLUG deep links.
 * Mirrors the CuratedListPreviewScreen "next10" pattern: the linking config
 * routes here by name only (no params resolved ahead of time), and this
 * screen performs its own Supabase lookup, then proceeds — in this case by
 * replacing itself with the CuratedListPreview screen (in standard mode, via
 * curatedListId) once a matching curated list template is found — exactly the
 * same destination + params the home-screen curated-list chips navigate to —
 * or falling back to BrowseLists gracefully if no match exists.
 *
 * Route params: { id }  — a slug-like string, e.g. 'willcox-wine-trail',
 * matched against curated_lists.title (case-insensitive, hyphen/space tolerant).
 */
export default function DeepLinkListResolverScreen({ route, navigation }) {
  const { id } = route.params ?? {}
  const [fetchError, setFetchError] = useState(null)

  useEffect(() => {
    resolveList()
  }, [])

  async function resolveList() {
    setFetchError(null)

    if (!id) {
      setFetchError('no_list')
      navigation.replace('BrowseLists')
      return
    }

    let listRow = null
    try {
      // Slug → human title guess, e.g. 'willcox-wine-trail' → 'willcox wine trail'
      const titleGuess = String(id).replace(/[-_]+/g, ' ').trim()

      const { data, error } = await supabase
        .from('curated_lists')
        .select('id, title, city_slug, audience_groups (name, tagline, emoji)')
        .ilike('title', `%${titleGuess}%`)
        .limit(1)
        .maybeSingle()

      if (error) throw error
      listRow = data
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
      groupName:    ag?.name    ?? listRow.title,
      groupEmoji:   ag?.emoji   ?? undefined,
      groupTagline: ag?.tagline ?? undefined,
      citySlug:     listRow.city_slug ?? undefined,
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
