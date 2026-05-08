import { useEffect, useRef } from 'react'
import { Platform, Alert } from 'react-native'
import * as Notifications from 'expo-notifications'
import { supabase } from './supabase'

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

  useEffect(() => {
    if (!userId) return
    registerForPushNotifications(userId)

    // Show notification when app is in foreground
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge:  true,
      }),
    })

    // Listen for notifications received while app is open
    notifListener.current = Notifications.addNotificationReceivedListener(notification => {
      // Could show an in-app toast here if desired
      console.log('Notification received:', notification)
    })

    // Listen for user tapping a notification
    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data
      // Navigation based on screen in data payload handled by App.jsx linking config
      console.log('Notification tapped:', data)
    })

    return () => {
      notifListener.current?.remove()
      responseListener.current?.remove()
    }
  }, [userId])
}

async function registerForPushNotifications(userId) {
  try {
    // iOS only — request permission
    if (Platform.OS === 'ios') {
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
