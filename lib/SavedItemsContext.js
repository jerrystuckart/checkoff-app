// Saved Items V1 (2026-09-18) — shared Saved-items state, consumed by
// Home cards, Item Detail, and the Lists tab's "Saved" destination.
// Single source of truth: one bulk fetch per session, optimistic
// save/unsave, no per-card queries anywhere.
//
// Follows this repo's existing context/provider convention exactly (see
// lib/ThemeContext.js): createContext + a Provider component wrapping
// children + a useX() hook that just returns useContext(...). Auth is
// obtained the same way useAuth.js already does — supabase.auth.getSession()
// on mount, then supabase.auth.onAuthStateChange(...) for sign-in/out —
// rather than inventing a second, parallel auth mechanism. This provider
// does NOT re-derive its own user object for the rest of the app; it only
// needs the user id to scope its own fetch/writes, exactly like
// lib/trackEvent.js already does with `supabase.auth.getUser()`.
//
// Pure decision logic (what to do, not how to talk to React/Supabase)
// lives in lib/savedItemsState.js so it can be unit tested without a
// React Native render harness — see lib/savedItemsState.test.js.

import React, { createContext, useContext, useEffect, useMemo, useCallback, useRef, useState } from 'react'
import { Alert } from 'react-native'
import { supabase } from './supabase'
import { trackEvent } from './trackEvent'
import {
  buildSavedIdsFromRows,
  applyOptimisticUpdate,
  shouldStartToggle,
  shouldIssueWrite,
  isBenignDuplicateInsertError,
  isDeleteConvergedToUnsaved,
  markInFlight,
  clearInFlight,
  resetState,
} from './savedItemsState'

const SavedItemsContext = createContext({
  savedItemIds: new Set(),
  isSaved:      () => false,
  toggleSaved:  () => {},
  saveItem:     () => {},
  unsaveItem:   () => {},
  loading:      false,
})

// Reused verbatim from ItemDetailScreen.jsx's existing "Sign in first"
// pattern (handleCheckOff / openListPicker) — same copy, same mechanism,
// per the instruction not to invent new sign-in-prompt copy.
function promptSignIn(navigation) {
  Alert.alert('Sign in first', 'You need an account to save items.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Sign in', onPress: () => navigation?.navigate?.('SignIn') },
  ])
}

export function SavedItemsProvider({ children }) {
  const [savedItemIds, setSavedItemIds] = useState(() => new Set())
  const [loading, setLoading] = useState(true)

  // Refs, not state, for bookkeeping that must never itself trigger a
  // rerender (mirrors useAuth.js's currentUserId/initialized ref pattern).
  const userIdRef      = useRef(null)
  const inFlightRef     = useRef(new Set())
  const savedIdsRef     = useRef(new Set())
  const fetchTokenRef    = useRef(0) // guards against a stale fetch resolving after a newer one/logout

  useEffect(() => { savedIdsRef.current = savedItemIds }, [savedItemIds])

  const loadForUser = useCallback(async (uid) => {
    const token = ++fetchTokenRef.current
    if (!uid) {
      const fresh = resetState()
      setSavedItemIds(fresh.savedItemIds)
      inFlightRef.current = fresh.inFlightIds
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      // RLS (`user_id = auth.uid()`) already scopes this to the caller's
      // own rows — matching this app's established convention for other
      // owner-scoped tables (e.g. lib/useAuth.js's `.eq('id', userId)` on
      // `users`, which IS explicit because `id` there is the row's own
      // primary key, not a foreign "owner" column). saved_items has a
      // dedicated user_id column that IS the RLS predicate, and every
      // other RLS-scoped query in this app that filters by a foreign
      // owner column (e.g. check_ins by user_id, list_items owner checks)
      // states it explicitly rather than relying on RLS alone — matching
      // that convention (defense in depth, and it makes the query's
      // intent self-evident from the client code) rather than omitting it.
      const { data, error } = await supabase
        .from('saved_items')
        .select('item_id')
        .eq('user_id', uid)
        .order('created_at', { ascending: false })

      if (token !== fetchTokenRef.current) return // superseded by a newer load/logout
      if (error) throw error
      setSavedItemIds(buildSavedIdsFromRows(data))
    } catch (e) {
      if (token !== fetchTokenRef.current) return
      console.warn('SavedItemsContext load error:', e?.message ?? e)
      // Fail closed to an empty (not stale/wrong-user) set rather than
      // crashing or leaving a previous user's data on screen.
      setSavedItemIds(new Set())
    } finally {
      if (token === fetchTokenRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return
      const uid = session?.user?.id ?? null
      userIdRef.current = uid
      loadForUser(uid)
    }).catch(() => {
      if (!cancelled) loadForUser(null)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const uid = session?.user?.id ?? null
      if (uid === userIdRef.current) return // no actual account change
      userIdRef.current = uid
      // Clear immediately (synchronously, before the re-fetch below) so no
      // stale, previously-logged-in user's Saved state is ever visible
      // even for a moment after logout/account switch.
      const fresh = resetState()
      setSavedItemIds(fresh.savedItemIds)
      inFlightRef.current = fresh.inFlightIds
      fetchTokenRef.current++ // invalidate any in-flight fetch from the old user
      loadForUser(uid)
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [loadForUser])

  const isSaved = useCallback((itemId) => savedIdsRef.current.has(itemId), [])

  const runMutation = useCallback(async (itemId, action, navigation, { force = false } = {}) => {
    if (!itemId) return
    const uid = userIdRef.current
    if (!uid) {
      promptSignIn(navigation)
      return
    }
    if (!shouldStartToggle(inFlightRef.current, itemId)) return
    if (!shouldIssueWrite(savedIdsRef.current, itemId, action, force)) return

    inFlightRef.current = markInFlight(inFlightRef.current, itemId)
    const previous = savedIdsRef.current
    const optimistic = applyOptimisticUpdate(previous, itemId, action)
    setSavedItemIds(optimistic)

    try {
      if (action === 'save') {
        // Never trust a caller-supplied user id — always the current
        // authenticated session's own id, enforced client-side too even
        // though RLS's WITH CHECK also guarantees it server-side.
        const { error } = await supabase.from('saved_items').insert({ user_id: uid, item_id: itemId })
        if (error && !isBenignDuplicateInsertError(error)) throw error
        trackEvent('item_save', { itemId })
      } else {
        const result = await supabase.from('saved_items').delete().eq('user_id', uid).eq('item_id', itemId)
        if (!isDeleteConvergedToUnsaved(result)) throw result.error
        trackEvent('item_unsave', { itemId })
      }
    } catch (e) {
      // Roll back to the pre-toggle state — not just "the opposite" of
      // the optimistic value, since a rapid double-tap could have moved
      // savedIdsRef on again in between.
      setSavedItemIds(previous)
      console.warn('SavedItemsContext mutation error:', action, e?.message ?? e)
      Alert.alert('Could not save', 'Something went wrong — please try again.')
    } finally {
      inFlightRef.current = clearInFlight(inFlightRef.current, itemId)
    }
  }, [])

  const saveItem = useCallback((itemId, navigation) => runMutation(itemId, 'save', navigation), [runMutation])
  const unsaveItem = useCallback((itemId, navigation) => runMutation(itemId, 'unsave', navigation), [runMutation])
  const toggleSaved = useCallback((itemId, navigation) => {
    const action = savedIdsRef.current.has(itemId) ? 'unsave' : 'save'
    return runMutation(itemId, action, navigation)
  }, [runMutation])

  // Memoized so a save toggle for one item doesn't force every unrelated
  // consumer to re-render its whole subtree — same reasoning as
  // ThemeContext.js's own useMemo'd value. savedItemIds itself is a new
  // Set reference on every change (by design, see savedItemsState.js), so
  // it's still the right dependency to react to; isSaved/toggleSaved/etc.
  // are all useCallback-stable so they never force a re-memo on their own.
  const value = useMemo(() => ({
    savedItemIds,
    isSaved,
    toggleSaved,
    saveItem,
    unsaveItem,
    loading,
  }), [savedItemIds, isSaved, toggleSaved, saveItem, unsaveItem, loading])

  return (
    <SavedItemsContext.Provider value={value}>
      {children}
    </SavedItemsContext.Provider>
  )
}

export function useSavedItems() {
  return useContext(SavedItemsContext)
}
