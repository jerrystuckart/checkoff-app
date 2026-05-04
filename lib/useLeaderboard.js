import { useState, useEffect, useRef } from 'react'
import { supabase } from './supabase'

/**
 * useLeaderboard(listId)
 *
 * Fetches crew scores directly from list_members + check_ins + users.
 * Does not rely on a leaderboard view — works with raw tables only.
 * Subscribes to check_ins changes for real-time score updates.
 *
 * Uses a unique channel name per hook instance (via useRef) to prevent
 * the "cannot add postgres_changes callbacks after subscribe()" error
 * when multiple components use the hook simultaneously.
 */
export function useLeaderboard(listId) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)

  // Unique ID per hook instance so two components (ListScreen + LeaderboardScreen)
  // don't share the same Realtime channel name and collide on subscribe
  const instanceId = useRef(`lb-${Math.random().toString(36).slice(2, 8)}`).current

  const load = async () => {
    if (!listId) return
    try {
      // Step 1: Get all members of this list
      const { data: members, error: membersErr } = await supabase
        .from('list_members')
        .select('user_id, users(id, display_name, avatar_url, is_deleted)')
        .eq('list_id', listId)

      if (membersErr) throw membersErr
      if (!members?.length) {
        setEntries([])
        setLoading(false)
        return
      }

      // Step 2: Get all list_item IDs for this list, with difficulty + multiplier
      const { data: listItems, error: liErr } = await supabase
        .from('list_items')
        .select('id, point_multiplier, items(difficulty)')
        .eq('list_id', listId)

      if (liErr) throw liErr
      const listItemIds = (listItems ?? []).map(li => li.id)

      // Build a map of list_item_id → base effective points AND difficulty
      // (difficulty stored separately so we can exempt Legend items from streak bonus)
      const effectivePtsMap  = {}
      const difficultyMap    = {}
      ;(listItems ?? []).forEach(li => {
        const difficulty      = li.items?.difficulty  ?? 1
        const pointMultiplier = li.point_multiplier   ?? 1.0
        effectivePtsMap[li.id] = Math.round(difficulty * pointMultiplier)
        difficultyMap[li.id]   = difficulty
      })

      // Step 3: Get all check-ins for this list's items
      let checkIns = []
      if (listItemIds.length > 0) {
        const { data: ci, error: ciErr } = await supabase
          .from('check_ins')
          .select('user_id, list_item_id, checked_at')
          .in('list_item_id', listItemIds)

        if (!ciErr) checkIns = ci ?? []
      }

      // Step 4: Fetch current streaks for all members
      // Used to apply 1.5× bonus for users with 4+ week streaks
      // Legend items (difficulty=25) are exempt from the bonus
      const memberIds = members.map(m => m.user_id)
      const { data: streakData } = await supabase
        .from('users')
        .select('id, current_streak')
        .in('id', memberIds)

      const streakMap = {}
      ;(streakData ?? []).forEach(u => { streakMap[u.id] = u.current_streak ?? 0 })

      // Step 5: Build score per user — sum effectivePts with streak bonus
      const scoreMap      = {}
      const lastActiveMap = {}

      checkIns.forEach(ci => {
        const basePts   = effectivePtsMap[ci.list_item_id] ?? 1
        const difficulty = difficultyMap[ci.list_item_id]  ?? 1
        const streak     = streakMap[ci.user_id]           ?? 0

        // 1.5× streak bonus applies when streak >= 4, but NOT on Legend (25pt) items
        const streakMultiplier = (streak >= 4 && difficulty < 25) ? 1.5 : 1.0
        const pts = Math.round(basePts * streakMultiplier)

        scoreMap[ci.user_id] = (scoreMap[ci.user_id] ?? 0) + pts
        if (!lastActiveMap[ci.user_id] || ci.checked_at > lastActiveMap[ci.user_id]) {
          lastActiveMap[ci.user_id] = ci.checked_at
        }
      })

      // Step 6: Build entries array from members
      const built = members.map(m => ({
        userId:      m.user_id,
        displayName: m.users?.is_deleted ? 'Former member' : (m.users?.display_name ?? 'Unknown'),
        avatarUrl:   m.users?.is_deleted ? null : (m.users?.avatar_url ?? null),
        score:       scoreMap[m.user_id] ?? 0,
        lastActive:  lastActiveMap[m.user_id] ?? null,
        streak:      streakMap[m.user_id] ?? 0,
        isDeleted:   m.users?.is_deleted ?? false,
      }))

      // Sort by score descending, then by last active
      built.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        if (a.lastActive && b.lastActive) return b.lastActive > a.lastActive ? 1 : -1
        return 0
      })

      setEntries(built)
    } catch (e) {
      console.warn('useLeaderboard error:', e.message)
      setEntries([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()

    // Unique channel name per instance prevents double-subscribe collision
    const channel = supabase
      .channel(`${instanceId}-${listId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'check_ins' },
        () => load()
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [listId])

  return { entries, loading }
}