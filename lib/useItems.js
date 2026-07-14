import { useState, useEffect, useCallback, useRef } from 'react'
import { Alert } from 'react-native'
import { supabase } from './supabase'
import { completeDare } from './completeDare'
import { updateUserLifetimePoints } from './points'

export function useItems(listId, showAlcohol = true) {
  const [items, setItems]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  // Refs — never cause re-renders, never go stale in callbacks
  const uidRef    = useRef(null)
  const itemsRef  = useRef([])
  const loadingOp = useRef(false)  // prevent concurrent loads

  // Keep itemsRef in sync
  useEffect(() => { itemsRef.current = items }, [items])

  // Resolve user once — no state, just ref
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      uidRef.current = data?.user?.id ?? null
      // Trigger a reload now that we have the user
      if (uidRef.current && listId) loadItems()
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      uidRef.current = session?.user?.id ?? null
    })
    return () => subscription.unsubscribe()
  }, []) // eslint-disable-line

  async function loadItems() {
    if (!listId || loadingOp.current) return
    loadingOp.current = true
    setLoading(true)
    setError(null)

    try {
      // Step 1: get list items
      const { data: listItems, error: liErr } = await supabase
        .from('list_items')
        .select(`
          id,
          sort_order,
          point_multiplier,
          items (
            id, body, is_active, checkin_type, is_universal, ring_weight,
            difficulty, photo_required, is_secret, secret_reveal_text,
            maps_lat, maps_lng, geo_radius_m,
            website_url, maps_query, partner_id, has_alcohol,
            allows_personal_note, personal_prompt_label, personal_place_label,
            is_insider_drop, insider_drop_requires_points, insider_drop_requires_status, insider_drop_teaser_text,
            categories ( name, color_hex ),
            neighborhoods!items_neighborhood_id_fkey ( id, name, metro_id ),
            partners!items_partner_id_fkey ( business_name )
          )
        `)
        .eq('list_id', listId)
        .order('sort_order')

      if (liErr) throw liErr
      if (!listItems?.length) { setItems([]); return }

      // Step 2: get this user's check-ins — CORRECT COLUMN: checked_at
      let checkedSet = {}
      const uid = uidRef.current
      if (uid) {
        const ids = listItems.map(li => li.id)
        const { data: checkIns, error: ciErr } = await supabase
          .from('check_ins')
          .select('list_item_id, checked_at, personal_place, personal_note')
          .eq('user_id', uid)
          .in('list_item_id', ids)

        if (!ciErr) {
          checkedSet = Object.fromEntries(
            (checkIns ?? []).map(ci => [ci.list_item_id, ci])
          )
        }
      }

      // Step 3: merge
      const merged = listItems.map(li => {
        const difficulty      = li.items?.difficulty      ?? 1
        const photoRequired   = li.items?.photo_required  ?? false
        const pointMultiplier = li.point_multiplier       ?? 1.0
        const effectivePts    = Math.round(difficulty * pointMultiplier)

        return {
          listItemId:       li.id,
          sortOrder:        li.sort_order,
          id:               li.items?.id,
          body:             li.items?.body ?? '',
          // RLS returns items as null for inactive items the user hasn't
          // checked off — treat that as inactive rather than defaulting to
          // active, so it gets filtered out below instead of showing blank.
          isActive:         li.items?.is_active ?? false,
          checkinType:      li.items?.checkin_type ?? 'tap',
          checkin_type:     li.items?.checkin_type ?? 'tap',
          isUniversal:      li.items?.is_universal ?? true,
          ring_weight:      li.items?.ring_weight  ?? 0,
          difficulty,
          photoRequired,
          isSecret:         li.items?.is_secret          ?? false,
          secretRevealText: li.items?.secret_reveal_text ?? null,
          mapsLat:          li.items?.maps_lat            ?? null,
          mapsLng:          li.items?.maps_lng            ?? null,
          geoRadiusM:       li.items?.geo_radius_m        ?? null,
          pointMultiplier,
          effectivePts,
          categoryName:     li.items?.categories?.name      ?? 'Misc',
          categoryColor:    li.items?.categories?.color_hex ?? '#888780',
          neighborhoodId:   li.items?.neighborhoods?.id       ?? null,
          neighborhoodName: li.items?.neighborhoods?.name     ?? null,
          metroId:          li.items?.neighborhoods?.metro_id ?? null,
          website_url:      li.items?.website_url  ?? null,
          maps_query:       li.items?.maps_query   ?? null,
          partner_id:       li.items?.partner_id            ?? null,
          partnerName:      li.items?.partners?.business_name ?? null,
          has_alcohol:           li.items?.has_alcohol            ?? false,
          isFiltered:            !showAlcohol && (li.items?.has_alcohol ?? false),
          allowsPersonalNote:          li.items?.allows_personal_note          ?? false,
          personalPromptLabel:         li.items?.personal_prompt_label         ?? null,
          personalPlaceLabel:          li.items?.personal_place_label          ?? null,
          isInsiderDrop:               li.items?.is_insider_drop               ?? false,
          insiderDropRequiresPoints:   li.items?.insider_drop_requires_points  ?? null,
          insiderDropRequiresStatus:   li.items?.insider_drop_requires_status  ?? null,
          insiderDropTeaserText:       li.items?.insider_drop_teaser_text      ?? null,
          checked:               li.id in checkedSet,
          checkedAt:             checkedSet[li.id]?.checked_at    ?? null,
          personalPlace:         checkedSet[li.id]?.personal_place ?? null,
          personalNote:          checkedSet[li.id]?.personal_note  ?? null,
        }
      // Deactivated items disappear from the list (and its count/cap) for
      // anyone who hasn't checked them off — but stay fully visible, with
      // full content, for anyone who already has (see the RLS policy that
      // restores their content: "items: read own checked-off history...").
      }).filter(item => item.isActive || item.checked)

      setItems(merged)
    } catch (e) {
      console.error('useItems load error:', e.message)
      setError(e.message)
    } finally {
      setLoading(false)
      loadingOp.current = false
    }
  }

  // Load on mount and when listId changes
  useEffect(() => {
    loadItems()
  }, [listId]) // eslint-disable-line

  const checkOff = useCallback(async (listItemId) => {
    const uid = uidRef.current
    if (!uid) {
      console.warn('checkOff: no user id')
      return { error: 'Not signed in' }
    }

    // Snapshot BEFORE any state change
    const snapshot   = itemsRef.current
    const existing   = snapshot.find(i => i.listItemId === listItemId)
    const wasChecked = existing?.checked ?? false

    // Optimistic update immediately
    setItems(prev => prev.map(item =>
      item.listItemId === listItemId
        ? { ...item, checked: !wasChecked, checkedAt: wasChecked ? null : new Date().toISOString() }
        : item
    ))

    if (wasChecked) {
      // Un-check
      const { error } = await supabase
        .from('check_ins')
        .delete()
        .eq('user_id', uid)
        .eq('list_item_id', listItemId)

      if (error) {
        console.error('checkOff delete error:', error.message)
        setItems(snapshot)
        return { error }
      }
    } else {
      // Check off — include points_awarded so updateUserLifetimePoints sums
      // the correct value immediately rather than racing a DB trigger.
      const pointsAwarded = Math.round(
        (existing?.difficulty ?? 1) * (existing?.pointMultiplier ?? 1)
      )
      const { error } = await supabase
        .from('check_ins')
        .insert({
          user_id:        uid,
          list_item_id:   listItemId,
          checkin_method: 'tap',
          points_awarded: pointsAwarded,
        })

      if (error) {
        console.error('checkOff insert error:', error.message, error.code, error.details)
        setItems(snapshot)  // revert optimistic update
        // Surface DB-level rejections (list not started / ended / partner
        // cancelled) with clean messages. Other errors bubble up as
        // { error } for the caller to handle. The partnership-ended case
        // is normally caught client-side first (checkbox already disabled
        // in ListScreen) — this is the server-side backstop for stale
        // client state, same defense-in-depth as the other two conditions.
        if (error.code === 'P0001') {
          const msg = error.message ?? ''
          if (msg.includes('started')) {
            Alert.alert('List not active yet', 'This list hasn\'t started yet. Check back when it opens.')
          } else if (msg.includes('partnership')) {
            Alert.alert('Partnership ended', 'This partnership has ended — new check-ins are disabled.')
          } else {
            Alert.alert('List closed', 'This list has ended and check-ins are no longer accepted.')
          }
        }
        return { error }
      }

      // Await streak update so streak milestone badges land in notification_queue
      // before pollForNewBadges runs in the screen's .then() handler.
      await supabase.functions.invoke('update-streak', {
        body: { user_id: uid },
      }).catch(() => {})

      // Await lifetime points update so point milestone badges land in notification_queue
      // before pollForNewBadges runs.
      await updateUserLifetimePoints(uid).catch(() => {})

      // Complete any active dares for this item — fire and forget
      if (existing?.id) {
        completeDare(uid, existing.id).catch(() => {})
      }
    }

    return { error: null }
  }, []) // no deps — pure ref access

  const checkedCount = items.filter(i => i.checked).length
  const totalCount   = items.length
  const pct = totalCount > 0 ? Math.round((checkedCount / totalCount) * 100) : 0

  return {
    items,
    loading,
    error,
    checkOff,
    reload: loadItems,
    checkedCount,
    totalCount,
    pct,
  }
}


// ============================================================
// CURATED LISTS — standalone async functions
// Not part of the useItems hook (no state needed at this level).
// Import individually where needed:
//   import { fetchCuratedLists, fetchCuratedListItems, adoptCuratedList } from '../lib/useItems'
// ============================================================


/**
 * fetchCuratedLists(citySlug)
 *
 * Returns all active curated lists for a given city, including
 * their audience group details. Includes universal groups (city_slug = null)
 * plus any city-specific groups (city_slug = citySlug).
 *
 * @param {string} citySlug  e.g. 'phoenix' | 'milwaukee'
 * @returns {Promise<{ data: Array, error: string|null }>}
 *
 * Shape of each item in data:
 * {
 *   id, title, season, year, city_slug,
 *   audience_groups: { id, name, tagline, description, emoji, city_slug }
 * }
 */
export async function fetchCuratedLists(citySlug) {
  try {
    const { data, error } = await supabase
      .from('curated_lists')
      .select(`
        id,
        title,
        season,
        year,
        city_slug,
        audience_groups (
          id,
          name,
          tagline,
          description,
          emoji,
          city_slug,
          image_url
        )
      `)
      .eq('is_active', true)
      .or(`city_slug.eq.${citySlug},city_slug.is.null`)
      .order('season')

    if (error) throw error

    // Sort: city-specific groups first, universal second
    // Within each, respect audience_group display_order
    const sorted = (data ?? []).sort((a, b) => {
      const aCity = a.audience_groups?.city_slug ? 0 : 1
      const bCity = b.audience_groups?.city_slug ? 0 : 1
      return aCity - bCity
    })

    return { data: sorted, error: null }
  } catch (e) {
    console.error('fetchCuratedLists error:', e.message)
    return { data: [], error: e.message }
  }
}


/**
 * fetchCuratedListItems(curatedListId)
 *
 * Returns all items for a given curated list template,
 * joined with full item details. Used to preview a list
 * before adopting it.
 *
 * @param {string} curatedListId  UUID of the curated_lists row
 * @returns {Promise<{ data: Array, error: string|null }>}
 *
 * Shape of each item in data:
 * {
 *   id, display_order,
 *   items: { id, body, checkin_type, is_universal, ring_weight,
 *            has_alcohol, website_url, maps_query,
 *            categories: { name, color_hex },
 *            neighborhoods: { name } }
 * }
 */
export async function fetchCuratedListItems(curatedListId) {
  try {
    const { data, error } = await supabase
      .from('curated_list_items')
      .select(`
        id,
        display_order,
        items (
          id, body, checkin_type, is_universal, ring_weight,
          has_alcohol, website_url, maps_query, is_secret,
          categories ( name, color_hex ),
          neighborhoods!items_neighborhood_id_fkey ( name )
        )
      `)
      .eq('curated_list_id', curatedListId)
      .order('display_order')

    if (error) throw error
    return { data: data ?? [], error: null }
  } catch (e) {
    console.error('fetchCuratedListItems error:', e.message)
    return { data: [], error: e.message }
  }
}


/**
 * adoptCuratedList(params)
 *
 * Copies a curated list template into a brand-new user-owned list.
 * Steps:
 *   1. Insert row into public.lists  (triggers auto_add_creator_as_member)
 *   2. Fetch item_ids from curated_list_items
 *   3. Bulk insert into list_items
 *
 * @param {object} params
 * @param {string} params.curatedListId   UUID of the curated_lists template
 * @param {string} params.userId          auth.uid() of the adopting user
 * @param {string} params.title           User's chosen list name
 * @param {string|null} params.cityId     UUID from cities table (nullable)
 * @param {string|null} params.metroId    UUID from metro_areas table (nullable)
 * @param {string|null} params.seasonId   UUID from seasons table (nullable)
 * @param {string|null} params.startsAt   ISO date string e.g. '2026-06-01' (nullable)
 * @param {string|null} params.endsAt     ISO date string e.g. '2026-08-31' (nullable)
 * @param {boolean}     params.isPublic   default false
 * @param {string|null} params.coverEmoji pulled from audience_groups.emoji
 *
 * @returns {Promise<{ listId: string|null, error: string|null }>}
 */
export async function adoptCuratedList({
  curatedListId,
  userId,
  title,
  cityId      = null,
  metroId     = null,
  seasonId    = null,
  startsAt    = null,
  endsAt      = null,
  isPublic    = true,
  coverEmoji  = null,
}) {
  try {
    // ── Step 1: Create the new user-owned list ────────────────────────
    const inviteCode = Math.random().toString(36).slice(2, 9).toUpperCase()
    const { data: newList, error: listErr } = await supabase
      .from('lists')
      .insert({
        creator_id:  userId,
        title,
        city_id:     cityId,
        metro_id:    metroId,
        season_id:   seasonId,
        starts_at:   startsAt,
        ends_at:     endsAt,
        is_public:   isPublic,
        is_official: false,
        cover_emoji: coverEmoji,
        invite_code: inviteCode,
      })
      .select('id')
      .single()

    if (listErr) throw listErr
    const newListId = newList.id

    // ── Step 2: Fetch item_ids from the curated template ─────────────
    const { data: templateItems, error: tmplErr } = await supabase
      .from('curated_list_items')
      .select('item_id, display_order')
      .eq('curated_list_id', curatedListId)
      .order('display_order')

    if (tmplErr) throw tmplErr
    if (!templateItems?.length) {
      // List created but empty — still a success, just warn
      console.warn('adoptCuratedList: template has no items', curatedListId)
      return { listId: newListId, itemIds: [], error: null }
    }

    // ── Step 3: Bulk insert into list_items ───────────────────────────
    const listItemRows = templateItems.map((ti, index) => ({
      list_id:    newListId,
      item_id:    ti.item_id,
      sort_order: ti.display_order ?? index,
    }))

    const { error: insertErr } = await supabase
      .from('list_items')
      .insert(listItemRows)

    if (insertErr) throw insertErr
    return { listId: newListId, itemIds: templateItems.map(ti => ti.item_id), error: null }
  } catch (e) {
    console.error('adoptCuratedList error:', e.message)
    return { listId: null, error: e.message }
  }
}


// Local date (not UTC) — toISOString() can land on the wrong calendar day
// for users in negative-offset timezones late at night. Mirrors the same
// helper already used in CreateListScreen.jsx.
function localDateString(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * adoptDestinationList(params)
 *
 * Copies a Destination Hub's linked list into a brand-new personal list
 * for the visiting user — same "auto-create + bulk-copy, zero manual
 * steps" shape as adoptCuratedList above, but sourced from an existing
 * lists row (via its destination_lists linkage) instead of a
 * curated_lists template.
 *
 * @param {object} params
 * @param {string} params.destinationListId  destination_lists.id — stored
 *   on the new list as source_destination_list_id, which is what lets
 *   re-visit detection and check-in freezing trace back to it later.
 * @param {string} params.sourceListId       lists.id being copied
 *   (destination_lists.list_id) — its title, items, cover_emoji,
 *   metro_id and city_id are carried over onto the new list.
 * @param {string} params.userId             auth.uid() of the visitor.
 *
 * @returns {Promise<{ listId: string|null, error: string|null }>}
 */
export async function adoptDestinationList({ destinationListId, sourceListId, userId }) {
  try {
    // ── Step 1: Pull the source list's own title/emoji/metro for parity ──
    // Title is copied verbatim from the list being copied (e.g. "Willcox
    // Wine Trail · Anytime 2026"), not the destination's name (e.g.
    // "Willcox") and not appended with a year — the source title already
    // says whatever whoever manages destination_lists wants it to say
    // (Willcox's already includes a year; appending one here doubled it).
    // No attempt to detect/strip an existing year suffix either — this
    // is a straight copy, full stop.
    const { data: sourceList, error: sourceErr } = await supabase
      .from('lists')
      .select('title, cover_emoji, metro_id, city_id')
      .eq('id', sourceListId)
      .single()

    if (sourceErr) throw sourceErr

    const year = new Date().getFullYear()
    const inviteCode = Math.random().toString(36).slice(2, 9).toUpperCase()

    // ── Step 2: Create the new personal list ──────────────────────────
    const { data: newList, error: listErr } = await supabase
      .from('lists')
      .insert({
        creator_id:  userId,
        title:       sourceList.title,
        cover_emoji: sourceList.cover_emoji,
        metro_id:    sourceList.metro_id,
        city_id:     sourceList.city_id,
        starts_at:   localDateString(),
        ends_at:     `${year}-12-31`,
        is_public:   false,
        is_official: false,
        invite_code: inviteCode,
        source_destination_list_id: destinationListId,
      })
      .select('id')
      .single()

    if (listErr) throw listErr
    const newListId = newList.id

    // ── Step 3: Bulk-copy list_items from the source list ─────────────
    const { data: sourceItems, error: itemsErr } = await supabase
      .from('list_items')
      .select('item_id, sort_order, point_multiplier, is_partner_item')
      .eq('list_id', sourceListId)
      .order('sort_order')

    if (itemsErr) throw itemsErr
    if (!sourceItems?.length) {
      // List created but empty — still a success, just warn
      console.warn('adoptDestinationList: source list has no items', sourceListId)
      return { listId: newListId, error: null }
    }

    const listItemRows = sourceItems.map(si => ({
      list_id:          newListId,
      item_id:          si.item_id,
      sort_order:       si.sort_order,
      point_multiplier: si.point_multiplier,
      is_partner_item:  si.is_partner_item,
    }))

    const { error: insertErr } = await supabase
      .from('list_items')
      .insert(listItemRows)

    if (insertErr) throw insertErr
    return { listId: newListId, error: null }
  } catch (e) {
    console.error('adoptDestinationList error:', e.message)
    return { listId: null, error: e.message }
  }
}