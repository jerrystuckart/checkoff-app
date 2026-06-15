import React, { useEffect } from 'react'
import { View, ActivityIndicator, StyleSheet } from 'react-native'
import { supabase } from '../lib/supabase'

const NAVY = '#0F0F1E'
const AMBER = '#F5A623'

/**
 * DeepLinkExperienceResolverScreen
 *
 * Destination for checkoff://experience?tag=TAG deep links (both from external
 * URL scheme and from ExperiencesRail for experience?tag= cards without list_id).
 *
 * Resolution:
 *   1. Query featured_experiences where deep_link contains the tag AND list_id is not null
 *   2. If found → navigate to CuratedListPreview with that list_id
 *   3. Otherwise → fall back to BrowseLists
 *
 * Route params:
 *   tag       — e.g. 'bachelorette', 'date-night'
 *   heroImage — forwarded from ExperiencesRail card image (optional)
 */
export default function DeepLinkExperienceResolverScreen({ route, navigation }) {
  const { tag, heroImage } = route.params ?? {}

  useEffect(() => {
    resolveExperience()
  }, [])

  async function resolveExperience() {
    if (!tag) {
      navigation.replace('BrowseLists')
      return
    }

    try {
      // Look for an active experience card whose deep_link contains this tag
      // and has a list_id set — that's our direct navigation target.
      const { data, error } = await supabase
        .from('featured_experiences')
        .select('list_id, image_url')
        .ilike('deep_link', `%experience%tag=${tag}%`)
        .not('list_id', 'is', null)
        .eq('active', true)
        .limit(1)
        .maybeSingle()

      if (error) throw error

      if (data?.list_id) {
        navigation.replace('CuratedListPreview', {
          curatedListId: data.list_id,
          groupImageUrl: heroImage ?? data.image_url ?? undefined,
        })
        return
      }
    } catch (e) {
      console.error('[deep link] DeepLinkExperienceResolverScreen error:', e?.message ?? e)
    }

    // No matching experience with a list_id found — fall back to Browse Lists
    console.log(`[deep link] checkoff://experience?tag=${tag} — no list_id found; forwarding to BrowseLists`)
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
