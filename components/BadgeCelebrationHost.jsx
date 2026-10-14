import React, { useEffect, useState } from 'react'
import { AppState } from 'react-native'
import BadgeCelebrationModal from './BadgeCelebrationModal'
import { badgeCelebrations } from '../lib/badgeCelebrationStore'

/**
 * Mounted once at the app root. Owns the badge celebration for the signed-in account
 * (see lib/badgeCelebrations.js for the model). Renders nothing until there is something to show.
 */
export default function BadgeCelebrationHost({ userId }) {
  const [presenting, setPresenting] = useState(badgeCelebrations.getState().presenting)

  useEffect(() => badgeCelebrations.subscribe(s => setPresenting(s.presenting)), [])
  useEffect(() => { badgeCelebrations.setUser(userId ?? null) }, [userId])
  useEffect(() => {
    badgeCelebrations.setAppActive(AppState.currentState === 'active')
    const sub = AppState.addEventListener('change', s => badgeCelebrations.setAppActive(s === 'active'))
    return () => sub.remove()
  }, [])

  if (!presenting) return null
  return (
    <BadgeCelebrationModal
      key={presenting.id}
      badges={presenting.badges}
      onBadgeShown={b => badgeCelebrations.onBadgeVisible(b)}
      onDismiss={() => badgeCelebrations.dismiss()}
    />
  )
}
