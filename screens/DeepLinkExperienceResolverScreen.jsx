import React, { useEffect } from 'react'
import { View, ActivityIndicator, StyleSheet } from 'react-native'

const NAVY = '#0F0F1E'
const AMBER = '#F5A623'

const SUPPORTED_TAGS = ['bachelorette', 'date-night']

/**
 * DeepLinkExperienceResolverScreen
 *
 * Destination for checkoff://experience?tag=TAG deep links.
 * Follows the same "route here by name only, screen handles it" pattern as
 * next10 / DeepLinkListResolverScreen. There is no tag-filtered view yet, so
 * this simply logs the intent and forwards to the Lists tab (BrowseLists)
 * gracefully — tag pre-filtering is a future feature.
 *
 * Route params: { tag } — e.g. 'bachelorette', 'date-night'
 */
export default function DeepLinkExperienceResolverScreen({ route, navigation }) {
  const { tag } = route.params ?? {}

  useEffect(() => {
    if (tag && SUPPORTED_TAGS.includes(tag)) {
      console.log(`[deep link] checkoff://experience?tag=${tag} — tag-filtered views are a future feature; forwarding to Lists`)
    } else if (tag) {
      console.log(`[deep link] checkoff://experience?tag=${tag} — unsupported tag; forwarding to Lists`)
    } else {
      console.log('[deep link] checkoff://experience — no tag provided; forwarding to Lists')
    }

    navigation.replace('BrowseLists')
  }, [])

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
