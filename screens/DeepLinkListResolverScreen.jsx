import React, { useEffect, useState } from 'react'
import { View, Text, ActivityIndicator, StyleSheet, TouchableOpacity } from 'react-native'
import { supabase } from '../lib/supabase'
import { isUuid } from '../lib/emailLinkContract'
import { resolveListLink, planListNavigation } from '../lib/linkResolution'
import { setExplicitMetro } from '../lib/explicitMetroIntent'

const NAVY = '#0F0F1E'
const AMBER = '#F5A623'
const MUTED = 'rgba(255,255,255,0.5)'

/**
 * DeepLinkListResolverScreen
 *
 * Destination for checkoff://list?id=... deep links.
 *
 * A UUID id (the form email and web links use) is resolved FIRST and exactly: lists.id opens the List screen,
 * curated_lists.id opens CuratedListPreview. The list's own metro becomes the browsing context before the list
 * opens (lib/explicitMetroIntent.js). A missing or private list shows a controlled "no longer available" state
 * with a Browse lists action; a valid list never falls back to Browse Lists.
 *
 * A non UUID id keeps the original slug and title behavior:
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
  const [unavailable, setUnavailable] = useState(false)
  const startedRef = React.useRef(false)

  useEffect(() => {
    if (startedRef.current) return // never resolve or navigate twice
    startedRef.current = true
    if (isUuid(id)) { resolveExactList(); return }
    resolveList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function resolveExactList() {
    try {
      const result = await resolveListLink(supabase, id)
      if (result.status === 'ok') {
        if (result.metro) setExplicitMetro(result.metro, 'list_link')
        const cold = (navigation.getState?.()?.routes?.length ?? 1) <= 1
        const plan = planListNavigation(result, { cold, heroImage: route.params?.heroImage })
        if (plan.type === 'reset') navigation.reset({ index: plan.routes.length - 1, routes: plan.routes })
        else navigation.replace(plan.name, plan.params)
        return
      }
    } catch (e) {
      console.error('DeepLinkListResolverScreen exact list error:', e?.message ?? e)
    }
    setUnavailable(true)
  }

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
      // `city` (the deep link's own city_slug param, when present) is a
      // real signal for which metro's lists to fall back to — thread it
      // through instead of discarding it. metroName is intentionally
      // omitted: we only have the slug here, not a display name, and
      // BrowseListsScreen already handles a citySlug-without-metroName
      // param combination via its own metro_areas lookup.
      navigation.replace('BrowseLists', city ? { citySlug: city } : undefined)
      return
    }

    if (!listRow) {
      setFetchError('no_list')
      navigation.replace('BrowseLists', city ? { citySlug: city } : undefined)
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

  if (unavailable) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>This list isn't available right now.</Text>
        <TouchableOpacity style={styles.btn} activeOpacity={0.8} accessibilityRole="button"
          onPress={() => navigation.replace('BrowseLists')}>
          <Text style={styles.btnText}>Browse lists</Text>
        </TouchableOpacity>
        <TouchableOpacity activeOpacity={0.8} accessibilityRole="button" onPress={() => navigation.replace('Home')}>
          <Text style={styles.link}>Back to Home</Text>
        </TouchableOpacity>
      </View>
    )
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
  message: { fontSize: 15, color: 'rgba(255,255,255,0.6)', textAlign: 'center', paddingHorizontal: 32 },
  btn: { backgroundColor: AMBER, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 24 },
  btnText: { fontSize: 14, fontWeight: '800', color: NAVY },
  link: { fontSize: 14, color: MUTED, paddingVertical: 8 },
})
