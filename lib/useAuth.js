import { useState, useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import { supabase } from './supabase'
import * as Sentry from '@sentry/react-native'
import * as Application from 'expo-application'

function updateUserVersionRecord(userId) {
  if (!userId) return
  const version = Application.nativeApplicationVersion ?? null
  const build   = Application.nativeBuildVersion ?? null
  supabase
    .from('users')
    .update({ app_version: version, build_number: build, last_app_open_at: new Date().toISOString() })
    .eq('id', userId)
    .then(() => {})
    .catch(() => {})
}

/**
 * useAuth()
 *
 * Returns current auth state and helper functions.
 * Listens to Supabase auth state changes so the UI updates
 * automatically on sign-in and sign-out.
 */
export function useAuth() {
  const [user, setUser]       = useState(null)
  const [profile, setProfile] = useState(null)  // public.users row
  const [loading, setLoading] = useState(true)

  // Guard against double-resolution from getSession + onAuthStateChange
  const initialized = useRef(false)
  // Track current user ID so we only clear profile on actual user change
  const currentUserId = useRef(null)

  useEffect(() => {
    // Safety net: never hang longer than 5 seconds no matter what
    const safetyTimeout = setTimeout(() => {
      if (loading) {
        console.warn('useAuth: safety timeout hit — forcing loading=false')
        setLoading(false)
      }
    }, 5000)

    // Get current session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      // If onAuthStateChange already fired and initialized, skip
      if (initialized.current) return

      initialized.current = true
      const u = session?.user ?? null
      currentUserId.current = u?.id ?? null
      setUser(u)

      if (u) {
        updateUserVersionRecord(u.id)
        loadProfile(u.id)
      } else {
        setLoading(false)
      }
    }).catch((e) => {
      console.warn('getSession error:', e.message)
      setLoading(false)
    })

    // Listen for auth state changes (sign-in / sign-out)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        try {
          const u = session?.user ?? null
          Sentry.addBreadcrumb({ category: 'auth', message: `onAuthStateChange event=${_event} hasUser=${!!u}`, level: 'info' })

          // Mark initialized so getSession().then() skips if it fires after
          initialized.current = true

          // Clear profile only when the user actually changes
          if (u?.id !== currentUserId.current) {
            setProfile(null)
          }
          currentUserId.current = u?.id ?? null
          setUser(u)

          if (u) {
            await loadProfile(u.id)
          } else {
            setProfile(null)
            setLoading(false)
          }
          Sentry.addBreadcrumb({ category: 'auth', message: `onAuthStateChange complete event=${_event}`, level: 'info' })
        } catch (e) {
          Sentry.captureException(e)
          setLoading(false)
        }
      }
    )

    // Re-fetch profile whenever the app returns to the foreground.
    // Catches the "came back after an hour" case where the auth subscription
    // never fires because no sign-in/out event occurred.
    const appStateSub = AppState.addEventListener('change', nextState => {
      if (nextState === 'active' && currentUserId.current) {
        updateUserVersionRecord(currentUserId.current)
        loadProfile(currentUserId.current)
      }
    })

    return () => {
      subscription.unsubscribe()
      appStateSub.remove()
      clearTimeout(safetyTimeout)
    }
  }, [])

  async function loadProfile(userId) {
    // Don't clear profile here — keeps UI stable during re-fetch (no blank-tab flash).
    // Profile is only explicitly cleared on sign-out or when the signed-in user changes.
  try {
    const result = await Promise.race([
      supabase
        .from('users')
        .select('id, display_name, email, is_admin, current_streak, longest_streak')
        .eq('id', userId)
        .single(),
      new Promise(resolve =>
        setTimeout(() => resolve({ data: null, error: null }), 4000)
      ),
    ])
    const { data, error } = result
    if (!error && data) setProfile(data)
  } catch (e) {
    console.warn('loadProfile error:', e.message)
  } finally {
    setLoading(false)
  }
}

  async function signOut() {
    initialized.current = false
    currentUserId.current = null
    setUser(null)
    setProfile(null)
    await supabase.auth.signOut()
  }

  return {
    user,
    profile,
    loading,
    isAdmin: profile?.is_admin === true,
    isSignedIn: !!user,
    userId: user?.id ?? null,
    signOut,
    refreshProfile: () => user && loadProfile(user.id),
  }
}