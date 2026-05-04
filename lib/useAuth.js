import { useState, useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import { supabase } from './supabase'

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
        const u = session?.user ?? null

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
      }
    )

    // Re-fetch profile whenever the app returns to the foreground.
    // Catches the "came back after an hour" case where the auth subscription
    // never fires because no sign-in/out event occurred.
    const appStateSub = AppState.addEventListener('change', nextState => {
      if (nextState === 'active' && currentUserId.current) {
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