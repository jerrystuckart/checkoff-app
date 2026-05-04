import { useState, useEffect, useCallback } from 'react'
import { Share, Linking } from 'react-native'
import { supabase } from './supabase'

/**
 * useCrewInvite(listId?)
 *
 * Provides saved crew data and invite helpers.
 * - savedCrew: all people the current user has ever shared a list with
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

      // Step 1: Get saved crew member IDs and snapshot names
      const { data: crewRows, error } = await supabase
        .from('saved_crew')
        .select('crew_member_id, display_name, added_at')
        .eq('user_id', user.id)
        .order('added_at', { ascending: false })

      if (error) throw error
      if (!crewRows?.length) { setSavedCrew([]); setLoading(false); return }

      // Step 2: Fetch full profile data from public users table
      const memberIds = crewRows.map(r => r.crew_member_id)
      const { data: profiles } = await supabase
        .from('users')
        .select('id, display_name, avatar_url, email')
        .in('id', memberIds)

      const profileMap = {}
      ;(profiles ?? []).forEach(p => { profileMap[p.id] = p })

      setSavedCrew(
        crewRows.map(row => {
          const profile = profileMap[row.crew_member_id] ?? {}
          const name    = profile.display_name ?? row.display_name ?? 'Unknown'
          return {
            id:          row.crew_member_id,
            displayName: name,
            avatarUrl:   profile.avatar_url ?? null,
            email:       profile.email      ?? null,
            addedAt:     row.added_at,
            initial:     name[0].toUpperCase(),
          }
        })
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
    Linking.openURL(ok ? url : 'sms:')
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
