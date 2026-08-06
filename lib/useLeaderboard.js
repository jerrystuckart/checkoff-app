import { useState, useEffect, useRef } from 'react'
import { supabase } from './supabase'
import { isWithinWindow } from './seasonWindow'

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
      const memberIds = members.map(m => m.user_id)

      // Step 2: Get all items on this list, with difficulty + multiplier —
      // keyed by item_id, not list_item_id (see step 4 for why).
      const { data: listItems, error: liErr } = await supabase
        .from('list_items')
        .select('item_id, point_multiplier, items(difficulty)')
        .eq('list_id', listId)

      if (liErr) throw liErr
      const itemIds = (listItems ?? []).map(li => li.item_id).filter(Boolean)

      // Build a map of item_id → base effective points AND difficulty
      // (difficulty stored separately so we can exempt Legend items from streak bonus)
      const effectivePtsMap  = {}
      const difficultyMap    = {}
      ;(listItems ?? []).forEach(li => {
        const difficulty      = li.items?.difficulty  ?? 1
        const pointMultiplier = li.point_multiplier   ?? 1.0
        effectivePtsMap[li.item_id] = Math.round(difficulty * pointMultiplier)
        difficultyMap[li.item_id]   = difficulty
      })

      // Step 3: This list's own window — a check-off only counts toward
      // this leaderboard if it happened inside these dates, the same
      // source lib/useItems.js uses to decide "checked" for this list.
      const { data: listRow } = await supabase
        .from('lists')
        .select('starts_at, ends_at')
        .eq('id', listId)
        .maybeSingle()
      const listDates = { starts_at: listRow?.starts_at ?? null, ends_at: listRow?.ends_at ?? null }

      // Step 4: Get all of these members' check-ins for this list's items —
      // keyed by item_id, not list_item_id, so a standalone check-in (or
      // one attached to a DIFFERENT list containing the same item) still
      // counts toward this list's leaderboard. A check-off is a fact
      // about the user and the item, not which list_item_id it happened
      // to land on — see lib/checkOffAttachment.js: personal-list
      // check-ins are deliberately standalone across season boundaries,
      // exactly so this still has to count here.
      let checkIns = []
      if (itemIds.length > 0) {
        const { data: ci, error: ciErr } = await supabase
          .from('check_ins')
          .select('user_id, item_id, checked_at, points_awarded')
          .in('item_id', itemIds)
          .in('user_id', memberIds)

        if (!ciErr) checkIns = ci ?? []
      }

      // Scope to this list's own window, then dedupe by (user_id, item_id)
      // — fan-out can leave a second, zero-point mirror row for the same
      // item on this exact list (e.g. a personal-list standalone
      // check-in fans out into every other list the user belongs to
      // containing the same item, including this one) — counting both
      // would double the score for a single real action. Prefer the row
      // carrying real evidence (points_awarded > 0, the original) over a
      // zero-point mirror, same preference rule as lib/joinListCredit.js.
      const inWindow = checkIns.filter(ci => isWithinWindow(ci.checked_at, listDates.starts_at, listDates.ends_at))
      const dedupedMap = new Map()
      for (const ci of inWindow) {
        const key = `${ci.user_id}:${ci.item_id}`
        const cur = dedupedMap.get(key)
        if (!cur || (ci.points_awarded ?? 0) > (cur.points_awarded ?? 0)) {
          dedupedMap.set(key, ci)
        }
      }
      const deduped = [...dedupedMap.values()]

      // Step 5: Fetch current streaks for all members
      // Used to apply 1.5× bonus for users with 4+ week streaks
      // Legend items (difficulty=25) are exempt from the bonus
      const { data: streakData } = await supabase
        .from('users')
        .select('id, current_streak, insider_tier')
        .in('id', memberIds)

      const streakMap = {}
      const insiderTierMap = {}
      ;(streakData ?? []).forEach(u => {
        streakMap[u.id] = u.current_streak ?? 0
        insiderTierMap[u.id] = u.insider_tier ?? 'Starter'
      })

      // Step 6: Build score per user — sum effectivePts with streak bonus
      // Per-list score intentionally uses the streak-bonus formula (not points_awarded)
      // so leaderboard ranking reflects live multipliers. points_awarded is accumulated
      // separately as lifetimePoints for Insider Access tier display (future build).
      const scoreMap       = {}
      const lastActiveMap  = {}
      const lifetimePtsMap = {}

      deduped.forEach(ci => {
        const basePts   = effectivePtsMap[ci.item_id] ?? 1
        const difficulty = difficultyMap[ci.item_id]  ?? 1
        const streak     = streakMap[ci.user_id]      ?? 0

        // 1.5× streak bonus applies when streak >= 4, but NOT on Legend (25pt) items
        const streakMultiplier = (streak >= 4 && difficulty < 25) ? 1.5 : 1.0
        const pts = Math.round(basePts * streakMultiplier)

        scoreMap[ci.user_id] = (scoreMap[ci.user_id] ?? 0) + pts
        lifetimePtsMap[ci.user_id] = (lifetimePtsMap[ci.user_id] ?? 0) + (ci.points_awarded ?? 0)
        if (!lastActiveMap[ci.user_id] || ci.checked_at > lastActiveMap[ci.user_id]) {
          lastActiveMap[ci.user_id] = ci.checked_at
        }
      })

      // Step 7: Build entries array from members
      const built = members.map(m => ({
        userId:         m.user_id,
        displayName:    m.users?.is_deleted ? 'Former member' : (m.users?.display_name ?? 'Unknown'),
        avatarUrl:      m.users?.is_deleted ? null : (m.users?.avatar_url ?? null),
        score:          scoreMap[m.user_id] ?? 0,
        lastActive:     lastActiveMap[m.user_id] ?? null,
        streak:         streakMap[m.user_id] ?? 0,
        isDeleted:      m.users?.is_deleted ?? false,
        lifetimePoints: lifetimePtsMap[m.user_id] ?? 0,
        insiderTier:    insiderTierMap[m.user_id] ?? 'Starter',
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