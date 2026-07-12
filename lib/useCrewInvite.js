import { useState, useEffect, useCallback } from 'react'
import { Share, Linking } from 'react-native'
import { supabase } from './supabase'

/**
 * useCrewInvite(listId?)
 *
 * Provides saved crew data and invite helpers.
 * - savedCrew: people who share at least one non-official (custom) list with
 *   the current user — same "who you know" definition used for dare
 *   recipient scoping (DareScreen.jsx). Being on the same seasonal/official
 *   list with hundreds of strangers doesn't make someone "crew."
 * - inviteToList(memberIds, list): sends push notifications + records invite
 * - shareInviteLink(list): opens native share sheet with invite link
 * - sendSMSInvite(list): opens SMS composer with invite link
 */
export function useCrewInvite() {
  const [savedCrew, setSavedCrew]   = useState([])
  const [loading, setLoading]       = useState(true)
  const [userId, setUserId]         = useState(null)

  useEffect(() => {
    loadSavedCrew()
  }, [])

  async function loadSavedCrew() {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }
      setUserId(user.id)

      // Find every non-official list the current user belongs to.
      const { data: myPrivateLists, error } = await supabase
        .from('list_members')
        .select('list_id, lists!inner(is_official)')
        .eq('user_id', user.id)
        .eq('lists.is_official', false)

      if (error) throw error
      const myPrivateListIds = (myPrivateLists ?? []).map(r => r.list_id)
      if (!myPrivateListIds.length) { setSavedCrew([]); setLoading(false); return }

      // Of those lists, find every other member — no email selected here,
      // it's never needed for the crew picker UI.
      const { data: members } = await supabase
        .from('list_members')
        .select('user_id, users(id, display_name, avatar_url)')
        .in('list_id', myPrivateListIds)
        .neq('user_id', user.id)

      const seen = new Map()
      ;(members ?? []).forEach(m => {
        const u = m.users
        if (u && !seen.has(u.id)) {
          const name = u.display_name ?? 'Unknown'
          seen.set(u.id, {
            id:          u.id,
            displayName: name,
            avatarUrl:   u.avatar_url ?? null,
            initial:     name[0].toUpperCase(),
          })
        }
      })

      setSavedCrew(
        Array.from(seen.values()).sort((a, b) => a.displayName.localeCompare(b.displayName))
      )
    } catch (e) {
      console.warn('useCrewInvite loadSavedCrew error:', e.message)
    } finally {
      setLoading(false)
    }
  }

  /**
   * addToList(memberIds, listId)
   * Upserts selected saved crew members as list_members.
   * The DB trigger sync_saved_crew handles updating everyone's saved_crew
   * automatically on join.
   */
  const addToList = useCallback(async (memberIds, listId) => {
    if (!memberIds?.length || !listId) return { error: 'Missing params' }
    try {
      const rows = memberIds.map(uid => ({
        list_id:       listId,
        user_id:       uid,
        invite_source: 'direct',
      }))

      const { error } = await supabase
        .from('list_members')
        .upsert(rows, { onConflict: 'list_id,user_id', ignoreDuplicates: true })

      if (error) throw error
      return { error: null }
    } catch (e) {
      console.warn('addToList error:', e.message)
      return { error: e.message }
    }
  }, [])

  /**
   * inviteMessage(list)
   * Generates the standard invite text with deep link.
   */
  function inviteMessage(list) {
    const link = `https://getcheckoff.com/join/${list.invite_code}`
    return `Join my CheckOff list "${list.title}" — check things off together and see who gets the most points!\n\nJoin here: ${link}\n\nDon't have CheckOff yet? Download it free: https://getcheckoff.com`
  }

  /**
   * sendSMSInvite(list)
   * Opens the native SMS composer with the invite message pre-filled.
   */
  const sendSMSInvite = useCallback(async (list) => {
    const encoded = encodeURIComponent(inviteMessage(list))
    const url = `sms:?body=${encoded}`
    const ok = await Linking.canOpenURL(url)
    Linking.openURL(ok ? url : 'sms:').catch(() => {})
  }, [])

  /**
   * shareInviteLink(list)
   * Opens the native share sheet.
   */
  const shareInviteLink = useCallback(async (list) => {
    try {
      await Share.share({ message: inviteMessage(list), title: list.title })
    } catch (e) { /* user cancelled */ }
  }, [])

  return {
    savedCrew,
    loading,
    userId,
    addToList,
    sendSMSInvite,
    shareInviteLink,
    reload: loadSavedCrew,
  }
}
