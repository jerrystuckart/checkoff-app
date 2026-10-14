// Hubs the SELECTED metro should link to from Home (see lib/homeHubLinks.js for the eligibility rule).
// Re-reads when the metro changes and whenever Home regains focus, so an admin enabling a hub shows up on the next visit
// without an app update. A late answer for a metro the user has already left is discarded.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useFocusEffect } from '@react-navigation/native'
import { supabase } from './supabase'
import { fetchDiscoveryHubs, deriveHubLink } from './homeHubLinks'

export function useDiscoveryHubs(metroId) {
  const [state, setState] = useState({ metroId: null, hubs: [] })
  const latest = useRef(metroId)
  latest.current = metroId

  const load = useCallback(async () => {
    const asked = metroId
    const hubs = await fetchDiscoveryHubs(supabase, asked)
    if (latest.current === asked) setState({ metroId: asked, hubs })
  }, [metroId])

  useEffect(() => { if (!metroId) setState({ metroId: null, hubs: [] }) }, [metroId])
  useFocusEffect(useCallback(() => { load() }, [load]))

  // Never show a previous metro's hubs while the new metro's answer is in flight.
  return deriveHubLink(state.metroId === metroId ? state.hubs : [])
}
