import React, { useState, useEffect, useRef } from 'react'
import {
  Modal, View, Text, TouchableOpacity, StyleSheet,
  Animated, PanResponder, ActivityIndicator, Share, Alert,
} from 'react-native'
import * as Location from 'expo-location'
import { supabase } from '../lib/supabase'
import { useLeaderboard } from '../lib/useLeaderboard'
import { haversineMeters } from '../lib/distance'
import { formatDistanceLabel } from '../lib/proximity'
import { isWithinWindow, getCurrentSeasonWindow } from '../lib/seasonWindow'
import { filterMaskedBonusDrops } from '../lib/bonusDrops'

const AMBER  = '#F5A623'
const NAVY   = '#0F0F1E'
const CARD   = '#1A1A2E'
const TEXT   = '#E8E6DF'
const MUTED  = 'rgba(255,255,255,0.5)'
const BORDER = 'rgba(255,255,255,0.1)'

const SAME_VENUE_RADIUS_M = 40

function seasonWordFromTitle(title) {
  const match = (title ?? '').match(/^(spring|summer|fall|winter)/i)
  return match ? match[1].toLowerCase() : 'season'
}

/**
 * PostCheckoffSheet — the one thing every check-off (tap or photo) ends on,
 * replacing three previously-independent dead ends (ListScreen's row-flash
 * celebration, ItemDetailScreen's triggerPostCheckinDiscover redirect to
 * Nearby, PhotoCheckInScreen's plain goBack()).
 *
 * Rendered locally by each of the three screens — same pattern already used
 * for TierUpgradeCelebrationModal/BadgeCelebrationModal in this app. No
 * global portal; each caller owns one piece of state and passes it here.
 *
 * @param {object|null} data - null hides the sheet. Non-null shape:
 *   { itemId, listItemId, userId, item: { body, maps_lat/mapsLat,
 *     maps_lng/mapsLng, is_universal/isUniversal, neighborhood_id } }
 *   Callers set this at the moment of the tap, before the insert resolves —
 *   that's what "fires the proximity queries on tap" means in practice,
 *   since this component's own effect starts every query the instant it
 *   receives non-null data. If the insert later fails, the caller just sets
 *   data back to null; there's no separate reconciliation path to build.
 * @param {() => void} onDismiss
 * @param {object} navigation - for opening a suggested item or a list
 */
export default function PostCheckoffSheet({ data, onDismiss, navigation }) {
  const [phase, setPhase]           = useState('loading') // 'loading' | 'ready'
  const [countLabel, setCountLabel] = useState(null)
  const [listCtx, setListCtx]       = useState(null)       // { listId, title, inviteCode, metroName } | null
  const [alsoHere, setAlsoHere]     = useState(null)       // item | null
  const [nearestNext, setNearestNext] = useState([])       // item[]

  const [isOrphaned, setIsOrphaned] = useState(false) // Case C active: zero public lists contain this item
  // Case C — item is on zero public (is_official) lists. Secondary "Save to a list"
  // action reuses the same personal-list model as ItemDetailScreen's
  // Nearby-mode "+ Add to a list" — no new schema, just this surface.
  const [personalLists, setPersonalLists]   = useState([])  // user's own non-official lists
  const [showSaveMenu, setShowSaveMenu]     = useState(false)
  const [savingToList, setSavingToList]     = useState(false)
  const [savedLabel, setSavedLabel]         = useState(null)

  const { entries: rankEntries } = useLeaderboard(listCtx?.listId ?? null)

  const dragY = useRef(new Animated.Value(0)).current
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      // Capture-phase check runs before any child TouchableOpacity (the
      // Also Here card, Nearest Next rows, invite button) gets a chance to
      // claim the touch — without this, a swipe that starts over one of
      // those rows never reaches this responder at all. A stricter
      // vertical-ness requirement here (1.5x) keeps ordinary taps on those
      // rows working.
      onMoveShouldSetPanResponderCapture: (_, g) => g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
      onPanResponderMove: (_, g) => { if (g.dy > 0) dragY.setValue(g.dy) },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 90 || g.vy > 1.2) {
          Animated.timing(dragY, { toValue: 700, duration: 180, useNativeDriver: true }).start(onDismiss)
        } else {
          Animated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start()
        }
      },
    })
  ).current

  useEffect(() => {
    if (!data) return
    dragY.setValue(0)
    setPhase('loading')
    setCountLabel(null)
    setListCtx(null)
    setAlsoHere(null)
    setNearestNext([])
    setIsOrphaned(false)
    setPersonalLists([])
    setShowSaveMenu(false)
    setSavingToList(false)
    setSavedLabel(null)

    let cancelled = false
    ;(async () => {
      const item = data.item ?? {}
      const itemLat      = item.maps_lat ?? item.mapsLat ?? null
      const itemLng       = item.maps_lng ?? item.mapsLng ?? null
      const isUniversal   = item.is_universal ?? item.isUniversal ?? false
      const neighborhoodId = item.neighborhood_id ?? item.neighborhoodId ?? null

      // ── Which list did this check-off happen on (if any)? ──
      let listRow = null
      if (data.listItemId) {
        const { data: li } = await supabase
          .from('list_items')
          .select('list_id, lists(id, title, starts_at, ends_at, is_official, is_public, metro_id, invite_code)')
          .eq('id', data.listItemId)
          .maybeSingle()
        listRow = li?.lists ?? null
      }
      if (cancelled) return

      // ── Is that list specifically the metro's current active seasonal
      // hero (not just any active official list — a themed list sharing
      // the same dates doesn't count)? Mirrors HomeScreen's own
      // activeOfficial[0] derivation. ──
      let isActiveSeasonalList = false
      if (listRow?.is_official && listRow?.metro_id) {
        const today = new Date().toISOString().split('T')[0]
        const { data: officials } = await supabase
          .from('lists')
          .select('id, ends_at')
          .eq('is_official', true)
          .eq('is_public', true)
          .eq('metro_id', listRow.metro_id)
          .or(`ends_at.gte.${today},ends_at.is.null`)
          .or(`starts_at.lte.${today},starts_at.is.null`)
          .order('ends_at', { ascending: true, nullsFirst: false })
        isActiveSeasonalList = (officials ?? [])[0]?.id === listRow.id
      }
      if (cancelled) return

      // ── Count: season-scoped for the active seasonal list, lifetime
      // otherwise. Suppressed entirely only when the check-off has no list
      // context at all (shouldn't happen in practice — every check-in path
      // resolves a list_item_id before inserting — but the spec calls this
      // out explicitly as "celebration and suggestions only"). ──
      let count = null
      if (listRow && data.userId) {
        if (isActiveSeasonalList) {
          const { data: liRows } = await supabase.from('list_items').select('item_id').eq('list_id', listRow.id)
          const itemIds = (liRows ?? []).map(r => r.item_id).filter(Boolean)
          if (itemIds.length) {
            const { data: checkins } = await supabase
              .from('check_ins')
              .select('item_id, checked_at')
              .eq('user_id', data.userId)
              .in('item_id', itemIds)
            const inWindow = (checkins ?? []).filter(c => isWithinWindow(c.checked_at, listRow.starts_at, listRow.ends_at))
            const n = new Set(inWindow.map(c => c.item_id)).size
            count = `That's ${n} this ${seasonWordFromTitle(listRow.title)}`
          }
        } else {
          // Fan-out (lib/checkInFanOut.js) mirrors one check-in into every
          // other active list containing the same item, so a raw row count
          // over-counts. Dedupe by item_id for the true lifetime figure.
          const { data: lifetimeRows } = await supabase
            .from('check_ins')
            .select('item_id')
            .eq('user_id', data.userId)
          const lifetimeCount = new Set((lifetimeRows ?? []).map(r => r.item_id).filter(id => id != null)).size
          count = `${lifetimeCount} lifetime check-off${lifetimeCount === 1 ? '' : 's'}`
        }
      }
      if (cancelled) return
      setCountLabel(count)

      // listCtx drives the leaderboard rank and the "join my list" invite
      // framing — private-list features only. Public lists (is_official:
      // Seasonal/Themed/Destinations) have no leaderboard and no membership
      // at all (product decision, 2026-08), even when this check-off
      // happened while viewing one directly — list_item_id resolves for
      // whatever list you're currently inside regardless of public/private,
      // membership doesn't.
      if (listRow && !listRow.is_official) {
        let metroName = ''
        if (listRow.metro_id) {
          const { data: metroRow } = await supabase.from('metro_areas').select('name').eq('id', listRow.metro_id).maybeSingle()
          metroName = metroRow?.name?.replace(' Metro', '') ?? ''
        }
        setListCtx({ listId: listRow.id, title: listRow.title, inviteCode: listRow.invite_code, metroName })
      }

      // ── Standalone check-off (no listItemId): is this item on a live
      // public list at all? Public-list progress is computed live by
      // item_id + that list's own active window — no join, no membership —
      // so it already reflects there automatically. Still worth surfacing
      // the same season-scoped count wording as the listRow branch above.
      // If the item isn't on any public list, this is Case C: a truly
      // orphaned item, offer the low-key "Save to a list" (private list)
      // secondary action instead. ──
      if (!data.listItemId && data.itemId && data.userId) {
        const today = new Date().toISOString().split('T')[0]
        const { data: candidateListItems } = await supabase
          .from('list_items')
          .select('list_id, lists!inner(id, title, starts_at, ends_at, is_official)')
          .eq('item_id', data.itemId)

        const activePublic = (candidateListItems ?? []).filter(li => {
          const l = li.lists
          if (!l?.is_official) return false
          if (l.starts_at && l.starts_at > today) return false
          if (l.ends_at   && l.ends_at   < today) return false
          return true
        })

        if (activePublic.length) {
          // Soonest-ending first, matching HomeScreen's own activeOfficial
          // sort — just for choosing which title/season word to show, not
          // a join target. No listCtx set here — no leaderboard, no invite
          // framing for a public list.
          const best = [...activePublic].sort(
            (a, b) => new Date(a.lists.ends_at || '9999-12-31') - new Date(b.lists.ends_at || '9999-12-31')
          )[0].lists

          const { data: liRows } = await supabase.from('list_items').select('item_id').eq('list_id', best.id)
          const itemIds = (liRows ?? []).map(r => r.item_id).filter(Boolean)
          if (itemIds.length) {
            const { data: checkins } = await supabase
              .from('check_ins')
              .select('item_id, checked_at')
              .eq('user_id', data.userId)
              .in('item_id', itemIds)
            const inWindow = (checkins ?? []).filter(c => isWithinWindow(c.checked_at, best.starts_at, best.ends_at))
            const n = new Set(inWindow.map(c => c.item_id)).size
            if (!cancelled) setCountLabel(`That's ${n} this ${seasonWordFromTitle(best.title)}`)
          }
        } else if (!cancelled) {
          // Case C — truly orphaned. Load the user's own private (non-
          // public) lists for the low-key "Save to a list" secondary action.
          setIsOrphaned(true)
          const { data: members } = await supabase
            .from('list_members')
            .select('lists(id, title, ends_at, is_official)')
            .eq('user_id', data.userId)
          const lists = (members ?? [])
            .map(m => m.lists)
            .filter(Boolean)
            .filter(l => {
              if (l.is_official) return false
              if (!l.ends_at) return true
              return new Date(l.ends_at) >= new Date()
            })
            .sort((a, b) => a.title.localeCompare(b.title))
          if (!cancelled) setPersonalLists(lists)
        }
      }

      // ── Also Here / Nearest Next — both skipped entirely if the checked
      // item has no coordinates or is universal (no meaningful anchor). ──
      if (itemLat && itemLng && !isUniversal && neighborhoodId) {
        const { data: myHood } = await supabase.from('neighborhoods').select('metro_id').eq('id', neighborhoodId).maybeSingle()
        const metroId = myHood?.metro_id

        if (metroId) {
          const { data: metroHoods } = await supabase.from('neighborhoods').select('id').eq('metro_id', metroId)
          const hoodIds = (metroHoods ?? []).map(h => h.id)

          const { data: candidates } = await supabase
            .from('items')
            .select('id, body, maps_lat, maps_lng, difficulty, checkin_type')
            .eq('is_active', true)
            .eq('is_approved', true)
            .eq('is_universal', false)
            .not('maps_lat', 'is', null)
            .not('maps_lng', 'is', null)
            .in('neighborhood_id', hoodIds)
            .neq('id', data.itemId)

          // Locked Bonus Drops must not leak here — they only exist inside
          // their own list until unlocked or already checked (lib/bonusDrops.js).
          let pool = await filterMaskedBonusDrops(candidates ?? [], data.userId)

          // Season-scoped exclusion, not lifetime — a prior season's
          // check-off must not suppress an item the current season wants
          // resurfaced. Same rule, same helper, as everywhere else this
          // season-reset model applies (lib/seasonWindow.js).
          if (pool.length && data.userId) {
            const candidateIds = pool.map(c => c.id)
            const [{ data: checkins }, season] = await Promise.all([
              supabase.from('check_ins').select('item_id, checked_at').eq('user_id', data.userId).in('item_id', candidateIds),
              getCurrentSeasonWindow(),
            ])
            const doneThisSeason = new Set(
              (checkins ?? [])
                .filter(c => isWithinWindow(c.checked_at, season.starts_at, season.ends_at))
                .map(c => c.item_id)
            )
            pool = pool.filter(c => !doneThisSeason.has(c.id))
          }

          const withItemDist = pool.map(c => ({
            ...c,
            distFromItemM: haversineMeters(itemLat, itemLng, c.maps_lat, c.maps_lng),
          }))

          // "Also here" — same-venue detection — is always measured from
          // the checked item's own coordinates.
          const nearestToItem = [...withItemDist].sort((a, b) => a.distFromItemM - b.distFromItemM)[0]
          const alsoHereMatch = nearestToItem && nearestToItem.distFromItemM <= SAME_VENUE_RADIUS_M
            ? nearestToItem
            : null

          // "Nearest next" is measured from the USER's current position
          // when available (last-known, no permission prompt — this is a
          // secondary suggestion, not worth an intrusive dialog right after
          // a celebratory moment), falling back to item-based distance.
          let userLat = null
          let userLng = null
          try {
            const pos = await Location.getLastKnownPositionAsync({})
            userLat = pos?.coords?.latitude  ?? null
            userLng = pos?.coords?.longitude ?? null
          } catch { /* no location — falls back below */ }

          const remaining = withItemDist.filter(c => c.id !== alsoHereMatch?.id)
          const withDisplayDist = remaining.map(c => ({
            ...c,
            distM: (userLat != null && userLng != null)
              ? haversineMeters(userLat, userLng, c.maps_lat, c.maps_lng)
              : c.distFromItemM,
          }))
          const nextTwo = withDisplayDist.sort((a, b) => a.distM - b.distM).slice(0, 2)

          if (!cancelled) {
            setAlsoHere(alsoHereMatch ? { ...alsoHereMatch } : null)
            setNearestNext(nextTwo)
          }
        }
      }

      if (!cancelled) setPhase('ready')
    })()

    return () => { cancelled = true }
  }, [data?.itemId, data?.listItemId])

  if (!data) return null

  const myScore = rankEntries.find(e => e.userId === data.userId)?.score ?? 0
  const participants = rankEntries.filter(e => (e.score ?? 0) > 0).length
  const rankEligible = phase === 'ready' && myScore > 0 && participants >= 10

  let rankLabel = null
  if (rankEligible) {
    const myIdx = rankEntries.findIndex(e => e.userId === data.userId)
    const rank = myIdx + 1
    const metroName = listCtx?.metroName || 'your city'
    if (rank <= 5) {
      rankLabel = `#${rank} in ${metroName}`
    } else {
      const gap = Math.max(0, (rankEntries[4]?.score ?? 0) - myScore)
      rankLabel = `${gap} check${gap === 1 ? '' : 's'} from the top 5`
    }
  }

  function shareInvite() {
    const listPart = listCtx?.title ? ` on the "${listCtx.title}" CheckOff list` : ''
    const joinUrl  = listCtx?.inviteCode
      ? `https://getcheckoff.com/join/${listCtx.inviteCode}`
      : 'https://getcheckoff.com'
    const cta = listCtx?.inviteCode
      ? `Want to do it together? Download CheckOff and join my list: ${joinUrl}`
      : `Want to do it together? Download CheckOff: ${joinUrl}`
    const message = `Hey! I'm trying to check off "${data.item?.body ?? 'this'}"${listPart}. ${cta}`
    Share.share({ message, title: 'CheckOff invite' }).catch(() => {})
  }

  function openItem(item) {
    onDismiss()
    navigation.navigate('ItemDetail', { item })
  }

  // Case C — "Save to a list." Same insert lib/checkInFanOut.js's siblings
  // use elsewhere (ItemDetailScreen.addToList) — no new schema.
  async function saveToExistingList(listId, listTitle) {
    if (!data?.userId || !data?.itemId) return
    setSavingToList(true)
    try {
      const { data: existing } = await supabase
        .from('list_items')
        .select('sort_order')
        .eq('list_id', listId)
        .order('sort_order', { ascending: false })
        .limit(1)
      const nextOrder = (existing?.[0]?.sort_order ?? 0) + 1

      const { error } = await supabase
        .from('list_items')
        .insert({ list_id: listId, item_id: data.itemId, sort_order: nextOrder, added_by: data.userId })

      if (error && error.code !== '23505') throw error

      setShowSaveMenu(false)
      setSavedLabel(`Saved to ${listTitle}`)
    } catch (e) {
      Alert.alert('Could not save', e.message)
    } finally {
      setSavingToList(false)
    }
  }

  function createFirstList() {
    setShowSaveMenu(false)
    onDismiss()
    navigation.navigate('CreateList', { adoptedItemIds: data?.itemId ? [data.itemId] : [] })
  }

  return (
    <Modal transparent visible animationType="slide" onRequestClose={onDismiss} statusBarTranslucent>
      <View style={styles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onDismiss} />
        <Animated.View style={[styles.sheet, { transform: [{ translateY: dragY }] }]} {...panResponder.panHandlers}>
          <View style={styles.handleWrap}>
            <View style={styles.handle} />
          </View>

          <Text style={styles.title}>✓ Checked off</Text>
          {countLabel ? <Text style={styles.countText}>{countLabel}</Text> : null}
          {rankLabel ? <Text style={styles.rankText}>{rankLabel}</Text> : null}

          {phase === 'loading' && <ActivityIndicator color={AMBER} style={{ marginVertical: 18 }} />}

          {phase === 'ready' && alsoHere && (
            <TouchableOpacity style={styles.alsoHereCard} onPress={() => openItem(alsoHere)} activeOpacity={0.85}>
              <Text style={styles.sectionLabel}>ALSO HERE</Text>
              <Text style={styles.alsoHereBody} numberOfLines={2}>{alsoHere.body}</Text>
            </TouchableOpacity>
          )}

          {phase === 'ready' && nearestNext.length > 0 && (
            <View style={styles.nearestNextBlock}>
              <Text style={styles.sectionLabel}>NEAREST NEXT</Text>
              {nearestNext.map(it => (
                <TouchableOpacity key={it.id} style={styles.itemRow} onPress={() => openItem(it)} activeOpacity={0.85}>
                  <Text style={styles.itemRowBody} numberOfLines={2}>{it.body}</Text>
                  <Text style={styles.itemRowDist}>{formatDistanceLabel(it.distM)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <TouchableOpacity style={styles.inviteBtn} onPress={shareInvite} activeOpacity={0.85}>
            <Text style={styles.inviteBtnText}>Invite a friend</Text>
          </TouchableOpacity>

          {/* Case C — orphaned item, low-key optional save */}
          {phase === 'ready' && isOrphaned && !savedLabel && (
            <TouchableOpacity
              style={styles.saveLink}
              onPress={() => (personalLists.length ? setShowSaveMenu(true) : createFirstList())}
              activeOpacity={0.7}
            >
              <Text style={styles.saveLinkText}>Save to a list</Text>
            </TouchableOpacity>
          )}
          {phase === 'ready' && savedLabel && (
            <Text style={styles.savedText}>{savedLabel}</Text>
          )}

          {showSaveMenu && (
            <View style={styles.saveMenu}>
              {personalLists.map(l => (
                <TouchableOpacity
                  key={l.id}
                  style={styles.saveMenuRow}
                  disabled={savingToList}
                  onPress={() => saveToExistingList(l.id, l.title)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.saveMenuRowText}>{l.title}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.saveMenuRow} onPress={createFirstList} activeOpacity={0.8}>
                <Text style={[styles.saveMenuRowText, { color: AMBER }]}>+ New list</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveMenuCancel} onPress={() => setShowSaveMenu(false)}>
                <Text style={styles.saveMenuCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          )}
        </Animated.View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: NAVY,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 4,
    paddingHorizontal: 24,
    paddingBottom: 36,
  },
  // Bigger + higher-contrast than a typical hairline handle on purpose —
  // this is the sheet's only dismiss affordance besides tap-outside, and
  // it was reported as too subtle to read as one at all.
  handleWrap: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  handle: {
    width: 64,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: TEXT,
    textAlign: 'center',
  },
  countText: {
    fontSize: 15,
    fontWeight: '700',
    color: AMBER,
    textAlign: 'center',
    marginTop: 6,
  },
  rankText: {
    fontSize: 13,
    fontWeight: '600',
    color: MUTED,
    textAlign: 'center',
    marginTop: 4,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: MUTED,
    marginBottom: 8,
  },
  alsoHereCard: {
    backgroundColor: CARD,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.3)',
    padding: 14,
    marginTop: 20,
  },
  alsoHereBody: {
    fontSize: 15,
    fontWeight: '700',
    color: TEXT,
    lineHeight: 20,
  },
  nearestNextBlock: {
    marginTop: 20,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: CARD,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  itemRowBody: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: TEXT,
    lineHeight: 19,
  },
  itemRowDist: {
    fontSize: 12,
    fontWeight: '700',
    color: MUTED,
    flexShrink: 0,
    marginTop: 1,
  },
  inviteBtn: {
    marginTop: 22,
    backgroundColor: AMBER,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  inviteBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: NAVY,
  },
  saveLink: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  saveLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: MUTED,
    textDecorationLine: 'underline',
  },
  savedText: {
    fontSize: 13,
    fontWeight: '600',
    color: MUTED,
    textAlign: 'center',
    paddingVertical: 12,
  },
  saveMenu: {
    marginTop: 4,
    backgroundColor: CARD,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: 'hidden',
  },
  saveMenuRow: {
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  saveMenuRowText: {
    fontSize: 14,
    fontWeight: '600',
    color: TEXT,
  },
  saveMenuCancel: {
    paddingVertical: 13,
    alignItems: 'center',
  },
  saveMenuCancelText: {
    fontSize: 13,
    fontWeight: '600',
    color: MUTED,
  },
})
