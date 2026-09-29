// Copy for the Visit Inbox when there is nothing to review. It used to tell every user to "turn on visit
// recovery in Profile", including users who had already turned it on and were simply waiting for a visit (or whose
// nearby catalog had nothing to monitor). Now the message follows the actual state.

/**
 * @param {{ optedIn: boolean, hasBackgroundPermission: boolean }} state
 * @returns {{ title: string, body: string, action: 'open_settings' | 'open_profile' | null }}
 */
export function describeEmptyInbox({ optedIn, hasBackgroundPermission }) {
  if (!optedIn) {
    return {
      title: 'Nothing to review right now',
      body: 'When you spend time at a CheckOff place, it shows up here for 7 days so you can check it off later — from anywhere. Turn on visit recovery in Profile to have CheckOff remember your visits.',
      action: 'open_profile',
    }
  }
  if (!hasBackgroundPermission) {
    return {
      title: 'Visit recovery is on, but needs location access',
      body: 'CheckOff can only notice visits while location is set to "Always". Update it in Settings and your visits will start appearing here.',
      action: 'open_settings',
    }
  }
  return {
    title: 'Visit recovery is on — nothing waiting',
    body: 'When you spend time at a CheckOff place, it shows up here for 7 days so you can check it off later — from anywhere.',
    action: null,
  }
}
