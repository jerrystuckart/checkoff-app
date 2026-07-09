import React, { useEffect, useState } from 'react'
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native'
import { supabase } from '../lib/supabase'

const NAVY  = '#0F0F1E'
const AMBER = '#F5A623'
const MUTED = 'rgba(255,255,255,0.5)'

/**
 * DeepLinkCreatorResolverScreen
 *
 * Destination for checkoff://c/:handle and getcheckoff.com/c/:handle universal links.
 * Validates the creator exists and is active, then replaces with CreatorProfileScreen.
 * Falls back to HomeScreen if handle is missing or creator not found.
 *
 * Route params:
 *   handle — creator handle, e.g. 'jerryeats'
 */
export default function DeepLinkCreatorResolverScreen({ route, navigation }) {
  const { handle } = route.params ?? {}
  const [fetchError, setFetchError] = useState(null)

  useEffect(() => {
    resolveCreator()
  }, [])

  async function resolveCreator() {
    setFetchError(null)

    if (!handle) {
      setFetchError('no_handle')
      navigation.replace('Home')
      return
    }

    try {
      const { data, error } = await supabase
        .from('creators')
        .select('handle')
        .eq('handle', handle.toLowerCase())
        .maybeSingle()

      if (error) throw error

      if (!data) {
        setFetchError('not_found')
        navigation.replace('Home')
        return
      }

      navigation.reset({
        index: 1,
        routes: [
          { name: 'Home' },
          { name: 'CreatorProfile', params: { handle: data.handle } },
        ],
      })
    } catch (e) {
      console.error('DeepLinkCreatorResolverScreen error:', e?.message ?? e)
      setFetchError('fetch_failed')
      navigation.replace('Home')
    }
  }

  return (
    <View style={styles.container}>
      <ActivityIndicator size="small" color={AMBER} />
      <Text style={styles.text}>
        {fetchError ? 'Creator not found…' : 'Opening creator profile…'}
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
