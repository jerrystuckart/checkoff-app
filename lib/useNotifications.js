import { useEffect, useRef } from 'react'
import { Platform, Alert, Linking } from 'react-native'
import * as Notifications from 'expo-notifications'
import { supabase } from './supabase'
import { getCurrentAtPlaceItemId } from './atPlacePresenceTracker'

/**
 * Admin-broadcast notification action buttons.
 *
 * iOS/Android require a notification's action buttons to be registered
 * ahead of time as a "category" with a fixed title — you cannot send
 * arbitrary button text per push and have it render. This preset list is
 * what the admin's button-label dropdown picks from (checkoff_admin.html,
 * Notifications tab). To add a new label, add an entry here (id must match
 * the categoryId sent from admin) and it'll be live for anyone on this
 * build or later — no other changes needed.
 */
export const BROADCAST_BUTTON_PRESETS = [
  { id: 'update_now', title: 'Update Now' },
  { id: 'view',       title: 'View' },
  { id: 'open',       title: 'Open' },
  { id: 'learn_more', title: 'Learn More' },
  { id: 'shop_now',   title: 'Shop Now' },
]

async function registerBroadcastCategories() {
  try {
    for (const preset of BROADCAST_BUTTON_PRESETS) {
      await Notifications.setNotificationCategoryAsync(preset.id, [
        {
          identifier: 'open_url',
          buttonTitle: preset.title,
          options: { opensAppToForeground: true },
        },
      ])
    }
  } catch (e) {
    // Non-critical — notifications still deliver fine without action buttons
    console.warn('Notification category registration failed:', e.message)
  }
}

// Android 8+ (API 26+) requires every notification to belong to a channel,
// or the OS silently drops it — no error, it just never displays. Pushes
// are sent with no explicit channelId (see send-notifications edge
// function), so Expo's push service delivers to a channel literally named
// 'default' — this id must match exactly.
async function registerAndroidChannel() {
  if (Platform.OS !== 'android') return
  try {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      description: 'Badges, leaderboard activity, dares, and list updates',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'default',
    })
  } catch (e) {
    console.warn('Android notification channel registration failed:', e.message)
  }
}

/**
 * useNotifications()
 *
 * Call once from App.jsx after the user is signed in.
 * - Requests push permission
 * - Gets Expo push token
 * - Saves token to push_tokens table
 * - Sets up foreground notification handler
 *
 * Requires: expo-notifications installed + Apple Developer account
 * configured with APNs key via EAS credentials.
 */
export function useNotifications(userId) {
  const notifListener  = useRef()
  const responseListener = useRef()

  // Category registration doesn't need a signed-in user — do it unconditionally
  // so action buttons are ready before the user ever gets a broadcast push.
  useEffect(() => {
    registerBroadcastCategories()
    registerAndroidChannel()
  }, [])

  useEffect(() => {
    if (!userId) return
    registerForPushNotifications(userId)

    // Show notification when app is in foreground — except an at-place
    // reminder/recovery push (Visit Reminder V1/V1.5) while the user is
    // already looking at the live "You're Here / What's the Thing?" card;
    // see lib/atPlacePresenceTracker.js. Every other existing notification
    // type (check_in, dare, leaderboard_nudge, ...) is unaffected — this
    // only suppresses the two at-place-related `data.kind` values.
    Notifications.setNotificationHandler({
      handleNotification: async (notification) => {
        const kind = notification.request.content.data?.kind
        const isAtPlaceRelevant = kind === 'candidate_visit_high_confidence' || kind === 'at_place_checkoff_reminder'
        const suppress = isAtPlaceRelevant && getCurrentAtPlaceItemId() != null
        return {
          shouldShowAlert: !suppress,
          shouldPlaySound: !suppress,
          shouldSetBadge:  true,
        }
      },
    })

    // Listen for notifications received while app is open
    notifListener.current = Notifications.addNotificationReceivedListener(notification => {
      // Could show an in-app toast here if desired
      console.log('Notification received:', notification)
    })

    // Listen for user tapping a notification (either the body or an action
    // button, e.g. admin_broadcast's "Update Now") — both should open the
    // URL the admin attached, if any.
    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data
      console.log('Notification tapped:', data)
      if (data?.url) {
        Linking.openURL(data.url).catch(e =>
          console.warn('Failed to open notification URL:', e.message)
        )
      }
    })

    return () => {
      notifListener.current?.remove()
      responseListener.current?.remove()
    }
  }, [userId])
}

async function registerForPushNotifications(userId) {
  try {
    // Request permission (required on iOS always; required on Android 13+/API 33)
    const { status: existing } = await Notifications.getPermissionsAsync()
    let finalStatus = existing

    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync()
      finalStatus = status
    }

    if (finalStatus !== 'granted') {
      // User declined — don't push again, just return silently
      return
    }

    // Get the Expo push token
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: 'ee4a752d-9be6-4e3b-93c8-7d6be626d568', 
      // Find this in app.json after running: eas build:configure
    })

    const token = tokenData.data

    if (!token) return

    // Save to Supabase — upsert so re-installs don't create duplicates
    await supabase
      .from('push_tokens')
      .upsert(
        {
          user_id:   userId,
          token,
          platform:  Platform.OS,
          last_seen: new Date().toISOString(),
        },
        { onConflict: 'token' }
      )

  } catch (e) {
    // Non-critical — app works fine without push tokens
    console.warn('Push token registration failed:', e.message)
  }
}
