import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Linking,
  Share,
  Alert,
  ScrollView,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import Clipboard from '@react-native-clipboard/clipboard'
import * as Haptics from 'expo-haptics'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect } from '@react-navigation/native'
import { supabase } from '../lib/supabase'
import { completeDare } from '../lib/completeDare'
import { notifyCrewCheckIn } from '../lib/notifyCrewCheckIn'
import { updateUserLifetimePoints, getUserLifetimePoints, checkTierCrossingForUser } from '../lib/points'
import TierUpgradeCelebrationModal from '../components/TierUpgradeCelebrationModal'
import { useTheme } from '../lib/ThemeContext'
import { trackEvent } from '../lib/trackEvent'
import { fanOutCheckIn } from '../lib/checkInFanOut'
import { isWithinWindow, getCurrentSeasonWindow } from '../lib/seasonWindow'
import { checkGeoFence, presentGeoFenceFailure } from '../lib/geoFence'
import PostCheckoffSheet from '../components/PostCheckoffSheet'

const AMBER = '#F5A623'
const NAVY = '#1A1A2E'
const GREEN = '#1D9E75'
const BLUE = '#378ADD'

const RED = '#D85A30'

const RING_COLORS = ['#1D9E75', '#378ADD', '#BA7517', '#D85A30']
const RING_LABELS = ['Core', 'Near', 'Metro', 'Destination']

const CHANNELS = {
  sms: {
    label: 'Text',
    color: '#1D9E75',
    open: async (msg) => {
      const encoded = encodeURIComponent(msg)
      const url = `sms:?body=${encoded}`
      const ok = await Linking.canOpenURL(url)
      Linking.openURL(ok ? url : 'sms:').catch(() => {})
    },
  },
  imessage: {
    label: 'iMessage',
    color: '#1D9E75',
    open: async (msg) => {
      const encoded = encodeURIComponent(msg)
      Linking.openURL(`sms:?body=${encoded}`).catch(() => {})
    },
  },
  instagram: {
    label: 'Instagram',
    color: '#C13584',
    open: async (msg) => {
      // const Clipboard = require('@react-native-clipboard/clipboard').default
      Clipboard.setString(msg)
      const ok = await Linking.canOpenURL('instagram://direct-inbox')
      if (ok) {
        Alert.alert(
          'Copied to clipboard',
          'Message copied — paste it into your Instagram DM',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Instagram', onPress: () => Linking.openURL('instagram://direct-inbox').catch(() => {}) },
          ]
        )
      } else {
        Linking.openURL('https://www.instagram.com/direct/inbox/').catch(() => {})
      }
    },
  },
  snapchat: {
    label: 'Snapchat',
    color: '#FFFC00',
    textColor: '#000',
    open: async (msg) => {
      // const Clipboard = require('@react-native-clipboard/clipboard').default
      Clipboard.setString(msg)
      const ok = await Linking.canOpenURL('snapchat://')
      if (ok) {
        Alert.alert(
          'Copied to clipboard',
          'Message copied — open a Snap chat and paste it',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Snapchat', onPress: () => Linking.openURL('snapchat://').catch(() => {}) },
          ]
        )
      } else {
        Linking.openURL('https://www.snapchat.com').catch(() => {})
      }
    },
  },
  whatsapp: {
    label: 'WhatsApp',
    color: '#25D366',
    open: async (msg) => {
      const encoded = encodeURIComponent(msg)
      const url = `whatsapp://send?text=${encoded}`
      const ok = await Linking.canOpenURL(url)
      Linking.openURL(ok ? url : `https://wa.me/?text=${encoded}`).catch(() => {})
    },
  },
  tiktok: {
    label: 'TikTok',
    color: '#010101',
    textColor: '#fff',
    open: async (msg) => {
      // const Clipboard = require('@react-native-clipboard/clipboard').default
      Clipboard.setString(msg)
      const ok = await Linking.canOpenURL('tiktok://')
      if (ok) {
        Alert.alert(
          'Copied to clipboard',
          'Message copied — open a TikTok DM and paste it',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open TikTok', onPress: () => Linking.openURL('tiktok://').catch(() => {}) },
          ]
        )
      } else {
        Alert.alert('TikTok not installed', 'Install TikTok to share this way.')
      }
    },
  },
  facebook: {
    label: 'Facebook',
    color: '#1877F2',
    open: async (msg) => {
      // const Clipboard = require('@react-native-clipboard/clipboard').default
      Clipboard.setString(msg)
      const ok = await Linking.canOpenURL('fb-messenger://')
      if (ok) {
        Alert.alert(
          'Copied to clipboard',
          'Message copied — open a Messenger conversation and paste it',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Messenger', onPress: () => Linking.openURL('fb-messenger://').catch(() => {}) },
          ]
        )
      } else {
        Linking.openURL('https://www.messenger.com').catch(() => {})
      }
    },
  },
}

const DEFAULT_CHANNELS = ['sms', 'instagram', 'snapchat', 'tiktok']

export default function ItemDetailScreen({ route, navigation }) {
  const { item, listId, listTitle } = route.params ?? {}
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const { BG, CARD, TEXT, MUTED, BORDER, SOFT, SOFT_2, AMBER, NAVY, GREEN, RED } = colors
  const styles = useMemo(() => createItemStyles({ BG, CARD, TEXT, MUTED, BORDER, SOFT, SOFT_2, AMBER, NAVY, GREEN, RED }),
    [BG, CARD, TEXT, MUTED, BORDER, SOFT, SOFT_2, AMBER, NAVY, GREEN, RED])

  const [checked, setChecked] = useState(item?.checked ?? false)
  const [saving, setSaving] = useState(false)
  const [userId, setUserId] = useState(null)
  const [userChannels, setUserChannels] = useState(DEFAULT_CHANNELS)
  const [showChannelPicker, setShowChannelPicker] = useState(false)
  const [savingChannels, setSavingChannels] = useState(false)
  const [pendingChannels, setPendingChannels] = useState(null)
  const [showFlagPicker, setShowFlagPicker] = useState(false)
  const [flagReason, setFlagReason] = useState(null)
  const [flagNote, setFlagNote] = useState('')
  const [flagSubmitting, setFlagSubmitting] = useState(false)
  const [flagDone, setFlagDone] = useState(false)

  const [memoryModal,  setMemoryModal]  = useState(null) // { listItemId, placeLabel, noteLabel, itemBody, difficulty }
  const [memoryPlace,  setMemoryPlace]  = useState('')
  const [memoryNote,   setMemoryNote]   = useState('')
  const [memoryError,  setMemoryError]  = useState(null)
  const [memorySaving, setMemorySaving] = useState(false)
  const [tierUpgrade, setTierUpgrade] = useState(null)          // { tier, newPoints }
  // Deferred until the memory modal closes, so the tier-upgrade celebration
  // doesn't compete with the personal-note input for the user's attention.
  const [pendingTierUpgrade, setPendingTierUpgrade] = useState(null)
  const [postCheckoffData, setPostCheckoffData] = useState(null)

  // Nearby mode — shown when no listId, item came from Nearby tab
  const isNearbyMode = !listId
  const [userLists, setUserLists] = useState([])
  const [showListPicker, setShowListPicker] = useState(false)
  const [addingToList, setAddingToList] = useState(false)
  const [itemOnListId, setItemOnListId] = useState(null) // listItemId if item is on any user list
  const [itemOnListIds, setItemOnListIds] = useState({}) // { listId: listItemId } for all lists
  const [listInviteCode, setListInviteCode] = useState(null)

  useEffect(() => {
    loadUser()
  }, [])

  // Always holds the CURRENT item's id, kept in sync by the effect just
  // below. Read by loadCheckedState/refreshItemListContext to detect when
  // their own in-flight invocation has been superseded by a newer item —
  // see the comment on refreshItemListContext for why this is needed.
  // Declared before useFocusEffect below so its own updating effect runs
  // first within the same commit whenever item?.id changes, guaranteeing
  // the ref already reflects the new item by the time useFocusEffect's
  // wrapped effect re-fires and calls into either guarded function.
  const latestItemIdRef = useRef(item?.id)
  useEffect(() => {
    latestItemIdRef.current = item?.id
  }, [item?.id])

  // Centralized secret-reveal guard — the ONLY place this decision lives.
  // Previously duplicated as a caller-side check in ListScreen.jsx and
  // DiscoverScreen.jsx (removed); any future entry point gets this for
  // free instead of needing its own copy. Paired with the render-time
  // early return below (spinner instead of full item content) so this
  // doesn't flash the wrong UI before navigating away — mirrors the
  // resolve-then-replace pattern already used by the DeepLink*Resolver
  // screens in this codebase.
  useEffect(() => {
    if ((item?.is_secret || item?.isSecret) && !checked) {
      navigation.replace('SecretReveal', { item, listItemId: item?.listItemId ?? null })
    }
  }, [item, checked])

  useEffect(() => {
    if (item?.id) trackEvent('item_view', { itemId: item.id, listId })
  }, [item?.id, listId])

  // Promote a tier upgrade held during the memory modal once it closes
  useEffect(() => {
    if (!memoryModal && pendingTierUpgrade) {
      setTierUpgrade(pendingTierUpgrade)
      setPendingTierUpgrade(null)
    }
  }, [memoryModal, pendingTierUpgrade])

  useFocusEffect(
    useCallback(() => {
      if (userId) {
        loadCheckedState()
        refreshItemListContext(userId, item?.id)
      }
    }, [userId, item?.listItemId, item?.id])
  )

  async function loadUser() {
    const { data } = await supabase.auth.getUser()
    const uid = data?.user?.id
    setUserId(uid)

    if (uid) {
      const { data: profile } = await supabase
        .from('users')
        .select('share_channels')
        .eq('id', uid)
        .single()

      if (profile?.share_channels?.length > 0) {
        // Merge saved prefs with any new default channels added since last save
        const saved = profile.share_channels
        const merged = [...new Set([...saved, ...DEFAULT_CHANNELS.filter(c => !saved.includes(c))])]
        setUserChannels(merged)
      }

      await loadCheckedState(uid)

      // userLists itself is user-scoped (not item-scoped) — the user's own
      // personal lists don't change per item, so this only needs fetching
      // once, at mount. refreshItemListContext (called below, and again on
      // every item change via the useFocusEffect above) cross-references it
      // against whichever item is currently on screen.
      let lists = []
      if (!listId) {
        const { data: members } = await supabase
          .from('list_members')
          .select('lists(id, title, ends_at, is_official)')
          .eq('user_id', uid)

        lists = (members ?? [])
          .map(m => m.lists)
          .filter(Boolean)
          .filter(l => {
            if (l.is_official) return false
            if (!l.ends_at) return true
            return new Date(l.ends_at) >= new Date()
          })
          .sort((a, b) => a.title.localeCompare(b.title))

        setUserLists(lists)
      }

      // Passing `lists` directly (rather than letting this read `userLists`
      // from state) avoids reading the pre-update value of the setUserLists
      // call just above — state updates aren't visible synchronously within
      // the same function.
      await refreshItemListContext(uid, item?.id, lists)
    }
  }

  // itemOnListId / itemOnListIds / listInviteCode are all scoped to
  // "whichever item is currently on screen" — but this screen instance is
  // reused (not remounted) when the user chains from one item to another
  // via PostCheckoffSheet's "Also Here"/"Nearest Next" (openItem navigates
  // to the same 'ItemDetail' route, which React Navigation updates in place
  // rather than pushing a new screen). Without this, all three kept
  // reflecting whichever item was on screen at mount, silently misattaching
  // a chained item's check-off, dare, and photo-checkin to the PREVIOUS
  // item's list — see the "+ Add to a list" / dare / photo-quick-action
  // call sites below, all of which read these same three values.
  //
  // This is called from two places: the useFocusEffect below (fresh,
  // correctly re-fires per item) AND loadUser()'s own mount-time call
  // (closured to whichever item was on screen when loadUser() itself was
  // invoked). loadUser() has several sequential awaited steps before it
  // ever reaches this call, so on slow network that ORIGINAL, stale
  // invocation can resolve well after a chained check-off has moved the
  // screen on to a newer item — and without a guard, it would silently
  // overwrite that newer item's already-correct state with the old item's.
  // isStale() re-checks currentItemId against the live ref before every
  // write (not just once at the top) so a race that develops partway
  // through this function's own awaits is still caught.
  async function refreshItemListContext(uid, currentItemId, listsOverride = null) {
    const isStale = () => currentItemId !== latestItemIdRef.current
    if (isStale()) return

    setItemOnListId(null)
    setItemOnListIds({})

    if (listId) {
      // List-mode: item?.listItemId / getOrCreateListItemId (called
      // directly by the check-off handlers) resolve list_item_id
      // themselves — nothing to derive here. Just keep this list's own
      // invite code current so share messages never reference a stale one.
      const { data: listData } = await supabase
        .from('lists')
        .select('invite_code')
        .eq('id', listId)
        .single()
      if (isStale()) return
      setListInviteCode(listData?.invite_code ?? null)
      return
    }

    // Nearby mode — and every chained item, since openItem's navigate
    // always drops listId regardless of how the first item was opened —
    // has no current list context to have an invite code for.
    setListInviteCode(null)

    if (!uid || !currentItemId) return
    const lists = listsOverride ?? userLists
    const listIds = lists.map(l => l.id)
    if (!listIds.length) return

    // Check which of the user's own lists already have this item
    const { data: existing } = await supabase
      .from('list_items')
      .select('id, list_id')
      .eq('item_id', currentItemId)
      .in('list_id', listIds)

    if (isStale()) return
    if (existing?.length) {
      // Build map of listId → listItemId for greying out in picker
      const map = {}
      existing.forEach(li => { map[li.list_id] = li.id })
      setItemOnListIds(map)
      // Set first match as the listItemId for "I've done this" button
      setItemOnListId(existing[0].id)
    }
  }

  async function loadCheckedState(passedUid = null) {
    // Captured up front: this invocation's own item, fixed for its
    // lifetime regardless of what the screen moves on to later. loadUser()
    // calls this closured to whichever item was on screen at mount, and
    // can still be awaiting its own earlier steps (auth, profile,
    // list_members) well after a chained check-off has moved the screen on
    // to a different item — on slow network, easily outliving that item.
    // Checked again below, right before the write, so a stale resolution
    // can never overwrite a newer item's already-correct `checked` state.
    const startItemId = item?.id

    let uid = passedUid ?? userId
    if (!uid) {
      const { data: authData } = await supabase.auth.getUser()
      uid = authData?.user?.id ?? null
    }
    if (!uid || !startItemId) return

    try {
      // Keyed by item_id, not list_item_id — a check-off made from a
      // different list containing this same item still shows as checked.
      // But it only counts if it happened inside the relevant season
      // window: this list's own dates when opened from a list, or the
      // current season when opened from the Nearby rail (isNearbyMode) —
      // same window the rail itself uses, so tapping into an item's detail
      // from the rail can't show checked when the rail just showed unchecked.
      const [{ data, error }, windowDates] = await Promise.all([
        supabase
          .from('check_ins')
          .select('checked_at')
          .eq('user_id', uid)
          .eq('item_id', startItemId),
        listId
          ? supabase.from('lists').select('starts_at, ends_at').eq('id', listId).maybeSingle()
              .then(({ data: l }) => ({ starts_at: l?.starts_at ?? null, ends_at: l?.ends_at ?? null }))
          : getCurrentSeasonWindow(),
      ])

      if (error) throw error
      if (startItemId !== latestItemIdRef.current) return

      const inWindow = (data ?? []).some(ci =>
        isWithinWindow(ci.checked_at, windowDates.starts_at, windowDates.ends_at)
      )
      setChecked(inWindow)
    } catch (e) {
      console.warn('loadCheckedState:', e.message)
    }
  }

  function inviteMessage() {
    const listPart = listTitle ? ` on the "${listTitle}" CheckOff list` : ''
    const joinUrl  = listInviteCode
      ? `https://getcheckoff.com/join/${listInviteCode}`
      : 'https://getcheckoff.com'
    const callToAction = listInviteCode
      ? `Want to do it together? Download CheckOff and join my list: ${joinUrl}`
      : `Want to do it together? Download CheckOff: ${joinUrl}`
    return `Hey! I'm trying to check off "${item?.body}"${listPart}. ${callToAction}`
  }

  async function handleCheckOff() {
    if (!userId) {
      Alert.alert('Sign in first', 'You need an account to check off items.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign in', onPress: () => navigation.navigate('SignIn') },
      ])
      return
    }

    // Started here, before the list-item lookup and geofence check (both of
    // which can take seconds on slow network/GPS — checkGeoFence alone races
    // a 6s GPS timeout), so the button shows its spinner the instant the
    // user taps instead of appearing frozen. Every early return between here
    // and the try block below must reset it explicitly since none of them
    // reach the try/finally's own reset.
    setSaving(true)

    let listItemId = item?.listItemId

    if (!listItemId) {
      // Resolves to a joined-list context if one exists; null otherwise.
      // A null result is NOT an error — item_id is the check-in's source
      // of truth, and list membership is never required to complete it
      // (product decision, 2026-08). The insert below falls back to a
      // standalone row (list_item_id: null) in that case.
      listItemId = await getOrCreateListItemId(item?.id, userId)
    }

    // Photo-required items go to PhotoCheckInScreen — no tap shortcut,
    // matches the existing rule at ListScreen.jsx:902. Only applies when
    // checking ON; unchecking an already-checked item needs no photo.
    if (item?.photoRequired && !checked) {
      setSaving(false)
      navigation.navigate('PhotoCheckIn', { item, listItemId })
      return
    }

    const fenceResult = await checkGeoFence(item)
    if (!fenceResult.ok) {
      setSaving(false)
      presentGeoFenceFailure(fenceResult)
      return
    }

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

    // Capture points before the insert so tier crossing can be detected after
    const pointsBeforePromise = getUserLifetimePoints(userId)

    try {
      if (checked) {
        // Global by item_id, not just this list's row — a check-off is a
        // fact about the user and the item, so unchecking must be too.
        const { error } = await supabase
          .from('check_ins')
          .delete()
          .eq('user_id', userId)
          .eq('item_id', item?.id ?? null)

        if (error) throw error
        setChecked(false)
      } else {
        // points_awarded on the primary row — same difficulty * point_multiplier
        // formula as lib/useItems.js checkOff. Fan-out (lib/checkInFanOut.js)
        // deliberately leaves secondary rows at 0 to avoid double-counting.
        // No list context (standalone check-in) means no list-specific
        // multiplier — defaults to 1.0, same as an un-boosted list item.
        let pointMultiplier = 1.0
        if (listItemId) {
          const { data: liRow } = await supabase
            .from('list_items')
            .select('point_multiplier')
            .eq('id', listItemId)
            .maybeSingle()
          pointMultiplier = liRow?.point_multiplier ?? 1.0
        }
        const pointsAwarded = Math.round((item?.difficulty ?? 1) * pointMultiplier)

        // item_id is the canonical, always-available path to this check-in's
        // item — it survives list deletion (list_item_id goes null then).
        // list_item_id itself is null here when the item has no joined-list
        // context — a standalone check-in, valid on its own.
        const { error } = await supabase
          .from('check_ins')
          .insert({
            user_id: userId,
            list_item_id: listItemId ?? null,
            item_id: item?.id ?? null,
            checkin_method: 'tap',
            points_awarded: pointsAwarded,
          })

        if (error) {
          if (error.code === '23505') {
            // A unique-constraint hit alone doesn't say WHICH row it
            // collided with — only that a check-in for THIS item, by this
            // user, is confirmed to exist is actually a success-equivalent
            // outcome. Any other collision (e.g. a stale list_item_id
            // reused from a previous item on this screen) must never
            // celebrate a write that didn't happen for this item.
            const { data: existingCheckIn } = await supabase
              .from('check_ins')
              .select('id')
              .eq('user_id', userId)
              .eq('item_id', item?.id ?? null)
              .maybeSingle()
            if (existingCheckIn) {
              setChecked(true)
              setPostCheckoffData({ itemId: item?.id, listItemId, userId, item })
            } else {
              Alert.alert('Could not check off', 'Something went wrong — please try again.')
            }
            return
          }
          // DB trigger raises P0001 when list hasn't started or has ended.
          // Catch here so the raw Postgres message (with padded month names)
          // doesn't reach the user.
          if (error.code === 'P0001') {
            const msg = error.message ?? ''
            if (msg.includes('started')) {
              Alert.alert('List not active yet', 'This list hasn\'t started yet. Check back when it opens.')
            } else {
              Alert.alert('List closed', 'This list has ended and check-ins are no longer accepted.')
            }
            return
          }
          throw error
        }

        // Sheet only presents once the insert is confirmed — never before,
        // so a slow/failed write can't show a false "Checked off" moment.
        setChecked(true)
        setPostCheckoffData({ itemId: item?.id, listItemId, userId, item })
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        supabase.functions.invoke('update-streak', {
          body: { user_id: userId },
        }).catch(() => {/* non-critical */})

        const pointsBefore = await pointsBeforePromise.catch(() => 0)
        await updateUserLifetimePoints(userId).catch(() => {})
        if (item?.id) completeDare(userId, item.id).catch(() => {})

        // Mirror this check-off into every other active list containing
        // the same item — fire and forget, non-critical.
        if (item?.id) {
          fanOutCheckIn({
            userId,
            itemId: item.id,
            excludeListItemId: listItemId,
            checkinMethod: 'tap',
          }).catch(() => {})
        }

        const difficulty = item?.difficulty ?? 0
        if (item?.allowsPersonalNote) {
          setMemoryPlace('')
          setMemoryNote('')
          setMemoryError(null)
          setMemoryModal({
            listItemId: listItemId,
            itemId:      item?.id ?? null,
            placeLabel:  item.personalPlaceLabel  ?? 'Place or location',
            noteLabel:   item.personalPromptLabel ?? 'Any notes?',
            itemBody:    item.body ?? '',
            difficulty,
          })
        } else {
          if (difficulty >= 5) {
            notifyCrewCheckIn({ listItemId, itemBody: item?.body ?? '', difficulty, checkInId: null }).catch(() => {})
          }
        }

        // Check tier crossing after points have been updated. Deferred until
        // the memory modal closes for memory-eligible items so it doesn't
        // compete with the note input.
        checkTierCrossingForUser(userId, pointsBefore).then(({ crossedTier, newPoints }) => {
          if (crossedTier) {
            if (item?.allowsPersonalNote) {
              setPendingTierUpgrade({ tier: crossedTier, newPoints })
            } else {
              setTierUpgrade({ tier: crossedTier, newPoints })
            }
          }
        }).catch(() => {})
      }
    } catch (e) {
      setPostCheckoffData(null)
      Alert.alert('Could not check off', e.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Nearby mode: add item to a specific list ─────────────
  async function addToList(targetListId, targetListTitle) {
    if (!userId || !item?.id) return
    setAddingToList(true)
    try {
      // Get current max sort_order on the list
      const { data: existing } = await supabase
        .from('list_items')
        .select('sort_order')
        .eq('list_id', targetListId)
        .order('sort_order', { ascending: false })
        .limit(1)

      const nextOrder = (existing?.[0]?.sort_order ?? 0) + 1

      const { data: newItem, error } = await supabase
        .from('list_items')
        .insert({ 
          list_id: targetListId, 
          item_id: item.id, 
          sort_order: nextOrder,
          added_by: userId,  
        })
        .select('id')
        .single()

      if (error) {
        // Already on the list — just navigate there
        if (error.code === '23505') {
          setShowListPicker(false)
          navigation.navigate('List', { listId: targetListId, title: targetListTitle })
          return
        }
        throw error
      }

      setItemOnListId(newItem.id)
      setItemOnListIds(prev => ({ ...prev, [targetListId]: newItem.id }))
      setShowListPicker(false)

      // Refresh `checked` before the alert shows. Check-off is now global
      // by item_id (this item may already be checked via a different
      // list) — without this, `checked` can still be showing its stale
      // pre-add value when the user taps "I've done this" next, and
      // handleNearbyDone()'s checked-based toggle would then run the
      // DELETE branch instead of INSERT, wiping every check-in for this
      // item (not just this list's). Refreshing here means the button
      // correctly reads "✓ Done this!" already if that's true, instead of
      // silently toggling it off on the next tap.
      await loadCheckedState(userId)

      Alert.alert(
        'Added to list ✓',
        `"${item.body}" has been added to "${targetListTitle}". Go check it off!`,
        [
          { text: 'Stay here', style: 'cancel' },
          { text: 'Go to list', onPress: () => navigation.navigate('List', { listId: targetListId, title: targetListTitle }) },
        ]
      )
    } catch (e) {
      Alert.alert('Could not add', e.message)
    } finally {
      setAddingToList(false)
    }
  }

  // ── Nearby mode: check off item that's already on a list ──
  async function handleNearbyDone() {
    if (!userId) {
      Alert.alert('Sign in first', 'You need an account to check off items.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign in', onPress: () => navigation.navigate('SignIn') },
      ])
      return
    }

    // itemOnListId (if set) means this item is already on one of the
    // user's own lists — use that list context. Otherwise this is a
    // standalone check-in: valid on its own, no list required (product
    // decision, 2026-08). "+ Add to a list" (above) remains the only way
    // to attach an item to a personal list — that's an intentional choice,
    // never a precondition for "I've done this."

    // Started here, before the geofence check (checkGeoFence races a 6s GPS
    // timeout), so the button shows its spinner the instant the user taps
    // instead of appearing frozen. Every early return between here and the
    // try block below must reset it explicitly since neither reaches the
    // try/finally's own reset.
    setSaving(true)

    // Photo-required items go to PhotoCheckInScreen — no tap shortcut,
    // matches the existing rule at ListScreen.jsx:902. Only applies when
    // checking ON; unchecking an already-checked item needs no photo.
    if (item?.photoRequired && !checked) {
      setSaving(false)
      navigation.navigate('PhotoCheckIn', { item, listItemId: itemOnListId ?? null })
      return
    }

    const fenceResult = await checkGeoFence(item)
    if (!fenceResult.ok) {
      setSaving(false)
      presentGeoFenceFailure(fenceResult)
      return
    }

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

    try {
      if (checked) {
        // Global by item_id, not just this list's row — a check-off is a
        // fact about the user and the item, so unchecking must be too.
        const { error } = await supabase
          .from('check_ins')
          .delete()
          .eq('user_id', userId)
          .eq('item_id', item?.id ?? null)
        if (error) throw error
        setChecked(false)
      } else {
        // points_awarded on the primary row — same difficulty * point_multiplier
        // formula as lib/useItems.js checkOff. Fan-out (lib/checkInFanOut.js)
        // deliberately leaves secondary rows at 0 to avoid double-counting.
        // No list context (standalone check-in) means no list-specific
        // multiplier — defaults to 1.0.
        let pointMultiplier = 1.0
        if (itemOnListId) {
          const { data: liRow } = await supabase
            .from('list_items')
            .select('point_multiplier')
            .eq('id', itemOnListId)
            .maybeSingle()
          pointMultiplier = liRow?.point_multiplier ?? 1.0
        }
        const pointsAwarded = Math.round((item?.difficulty ?? 1) * pointMultiplier)

        // item_id is the canonical, always-available path to this check-in's
        // item — it survives list deletion (list_item_id goes null then).
        // list_item_id is null here when this item isn't on any of the
        // user's own lists — a standalone check-in, valid on its own.
        const { error } = await supabase
          .from('check_ins')
          .insert({ user_id: userId, list_item_id: itemOnListId ?? null, item_id: item?.id ?? null, checkin_method: 'tap', points_awarded: pointsAwarded })
        if (error) {
          if (error.code !== '23505') throw error
          // A unique-constraint hit alone doesn't say WHICH row it
          // collided with — only that a check-in for THIS item, by this
          // user, is confirmed to exist is actually a success-equivalent
          // outcome. Any other collision (e.g. a stale list_item_id
          // reused from a previous item on this screen) must never
          // celebrate a write that didn't happen for this item.
          const { data: existingCheckIn } = await supabase
            .from('check_ins')
            .select('id')
            .eq('user_id', userId)
            .eq('item_id', item?.id ?? null)
            .maybeSingle()
          if (!existingCheckIn) {
            Alert.alert('Could not check off', 'Something went wrong — please try again.')
            return
          }
        }
        // Sheet only presents once the insert is confirmed (or verified as
        // a genuine already-checked-off duplicate) — never before, so a
        // slow/failed/collided write can't show a false "Checked off"
        // moment.
        setChecked(true)
        setPostCheckoffData({ itemId: item?.id, listItemId: itemOnListId, userId, item })
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        supabase.functions.invoke('update-streak', {
          body: { user_id: userId },
        }).catch(() => {/* non-critical */})
        updateUserLifetimePoints(userId).catch(() => {})
        if (item?.id) completeDare(userId, item.id).catch(() => {})

        // Mirror this check-off into every other active list containing
        // the same item — fire and forget, non-critical.
        if (item?.id) {
          fanOutCheckIn({
            userId,
            itemId: item.id,
            excludeListItemId: itemOnListId,
            checkinMethod: 'tap',
          }).catch(() => {})
        }

        const difficulty = item?.difficulty ?? 0
        if (item?.allowsPersonalNote) {
          setMemoryPlace('')
          setMemoryNote('')
          setMemoryError(null)
          setMemoryModal({
            listItemId: itemOnListId,
            itemId:      item?.id ?? null,
            placeLabel:  item.personalPlaceLabel  ?? 'Place or location',
            noteLabel:   item.personalPromptLabel ?? 'Any notes?',
            itemBody:    item.body ?? '',
            difficulty,
          })
        } else {
          if (difficulty >= 5) {
            notifyCrewCheckIn({ listItemId: itemOnListId, itemBody: item?.body ?? '', difficulty, checkInId: null }).catch(() => {})
          }
        }
      }
    } catch (e) {
      setPostCheckoffData(null)
      Alert.alert('Could not check off', e.message)
    } finally {
      setSaving(false)
    }
  }

  async function getOrCreateListItemId(itemId, uid) {
    if (!itemId || !uid) return null

    try {
      // Fetch all list_items for this item, joining list dates so we can
      // filter to only currently-active lists before doing the membership lookup.
      // Without this filter, Supabase returns list_items from expired or
      // future lists and the DB trigger rejects the resulting check_in.
      const { data } = await supabase
        .from('list_items')
        .select('id, list_id, lists!inner(id, starts_at, ends_at)')
        .eq('item_id', itemId)
        .limit(50)

      if (!data?.length) return null

      const today = new Date().toISOString().split('T')[0]  // YYYY-MM-DD

      // Keep only lists that have started and haven't ended
      const activeItems = data.filter(li => {
        const l = li.lists
        if (!l) return false
        if (l.starts_at && l.starts_at > today) return false  // not started yet
        if (l.ends_at   && l.ends_at   < today) return false  // already ended
        return true
      })

      if (!activeItems.length) return null

      const activeListIds = activeItems.map(li => li.list_id)

      const { data: membership } = await supabase
        .from('list_members')
        .select('list_id')
        .eq('user_id', uid)
        .in('list_id', activeListIds)
        .limit(1)

      if (membership?.length) {
        const match = activeItems.find(li => li.list_id === membership[0].list_id)
        return match?.id ?? null
      }

      return null
    } catch (e) {
      console.warn('getOrCreateListItemId:', e.message)
      return null
    }
  }

  function openDirections() {
    if (!item) return
    trackEvent('directions_click', { itemId: item.id })
    // Support both snake_case (useNearby) and camelCase (useItems) field names
    const lat = item.maps_lat ?? item.mapsLat
    const lng = item.maps_lng ?? item.mapsLng
    if (lat && lng) {
      const url = `maps://?daddr=${lat},${lng}&dirflg=d`
      Linking.canOpenURL(url).then(ok =>
        Linking.openURL(ok ? url : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`).catch(() => {})
      )
    } else if (item.maps_query) {
      const encoded = encodeURIComponent(item.maps_query)
      const url = `maps://?q=${encoded}`
      Linking.canOpenURL(url).then(ok =>
        Linking.openURL(ok ? url : `https://maps.google.com/?q=${encoded}`).catch(() => {})
      )
    }
  }

  function openWebsite() {
    if (!item?.website_url) return
    trackEvent('url_click', { itemId: item.id })
    Linking.openURL(item.website_url).catch(() => {})
  }

  async function shareVia(channelKey) {
    const ch = CHANNELS[channelKey]
    if (!ch) return
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    try {
      await ch.open(inviteMessage())
    } catch (e) {
      console.warn('shareVia error:', channelKey, e?.message)
      Alert.alert('Could not share', 'Something went wrong. Try the text option instead.')
    }
  }

  async function openNativeShare() {
    try {
      await Share.share({ message: inviteMessage(), title: 'CheckOff invite' })
    } catch (e) {}
  }

  function openChannelPicker() {
    setPendingChannels([...userChannels])
    setShowChannelPicker(true)
  }

  const FLAG_REASONS = [
    { key: 'closed', label: 'Business is closed', icon: '🔒' },
    { key: 'unavailable', label: 'Item no longer available', icon: '🚫' },
    { key: 'wrong_info', label: 'Wrong location or info', icon: '📍' },
    { key: 'seasonal', label: 'Out of season', icon: '📅' },
    { key: 'duplicate', label: 'Duplicate item', icon: '♻' },
    { key: 'other', label: 'Something else', icon: '💬' },
  ]

  async function submitFlag() {
    if (!flagReason) return
    setFlagSubmitting(true)
    try {
      await supabase.from('item_flags').insert({
        item_id: item.id,
        user_id: userId,
        reason: flagReason,
        note: flagNote.trim() || null,
        list_id: listId || null,
      })
      setFlagDone(true)
      setShowFlagPicker(false)
      setFlagReason(null)
      setFlagNote('')
    } catch (e) {
      Alert.alert('Could not submit', 'Try again in a moment.')
    } finally {
      setFlagSubmitting(false)
    }
  }

  async function saveMemory() {
    if (!memoryModal) return
    const place = memoryPlace.trim()
    const note  = memoryNote.trim()
    setMemorySaving(true)
    setMemoryError(null)
    try {
      // Fanned out by item_id — every sibling check-in row for this user+item
      // gets the same note, not just the one for the list being viewed.
      // Otherwise viewing the same check-off's memory from a different list
      // would show it missing, the same trust break this task exists to fix.
      const { data: updatedRows, error } = await supabase
        .from('check_ins')
        .update({ personal_place: place || null, personal_note: note || null })
        .eq('user_id', userId)
        .eq('item_id', memoryModal.itemId)
        .select('id, list_item_id')
      if (error) throw error
      const updatedCI = (updatedRows ?? []).find(r => r.list_item_id === memoryModal.listItemId) ?? updatedRows?.[0] ?? null
      if ((memoryModal.difficulty ?? 0) >= 5) {
        notifyCrewCheckIn({
          listItemId: memoryModal.listItemId,
          itemBody:   memoryModal.itemBody   ?? '',
          difficulty: memoryModal.difficulty ?? 5,
          checkInId:  updatedCI?.id ?? null,
        }).catch(() => {})
      }
      setMemoryModal(null)
    } catch (e) {
      setMemoryError('Could not save — try again.')
    } finally {
      setMemorySaving(false)
    }
  }

  function togglePendingChannel(key) {
    setPendingChannels(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    )
  }

  async function saveChannels() {
    if (!pendingChannels?.length) {
      Alert.alert('Pick at least one channel')
      return
    }
    setSavingChannels(true)
    setUserChannels(pendingChannels)
    if (userId) {
      await supabase
        .from('users')
        .update({ share_channels: pendingChannels })
        .eq('id', userId)
    }
    setSavingChannels(false)
    setShowChannelPicker(false)
  }

  if (!item) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Item not found</Text>
      </View>
    )
  }

  // Paired with the redirect effect above — renders a spinner instead of
  // the full item content while navigation.replace('SecretReveal', ...)
  // is in flight, so this screen's real UI (check-off buttons, quick
  // actions) never has a chance to paint for a secret, unrevealed item.
  if ((item.is_secret || item.isSecret) && !checked) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={AMBER} />
      </View>
    )
  }

  const ring = item.ring_weight ?? 0
  const ringColor = RING_COLORS[ring] ?? RING_COLORS[0]
  const hasLoc = item.maps_query || ((item.maps_lat ?? item.mapsLat) && (item.maps_lng ?? item.mapsLng))
  const hasWeb = !!item.website_url
  const isPartner = !!item.partner_id

  const displayChannels = userChannels.filter((c, i, a) => {
    if (c === 'imessage') return !a.includes('sms')
    return true
  })

  return (
    <View style={styles.container}>
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.itemCard}>
        <View style={styles.tagRow}>
          <View style={[styles.tag, { backgroundColor: `${ringColor}18`, borderColor: `${ringColor}33` }]}>
            <Text style={[styles.tagText, { color: ringColor }]}>
              {RING_LABELS[ring] ?? 'Core'}
            </Text>
          </View>

          {item.categoryName && (
            <View
              style={[
                styles.tag,
                {
                  backgroundColor: `${item.categoryColor ?? '#888'}18`,
                  borderColor: `${item.categoryColor ?? '#888'}33`,
                },
              ]}
            >
              <Text style={[styles.tagText, { color: item.categoryColor ?? '#888' }]}>
                {item.categoryName}
              </Text>
            </View>
          )}

          {isPartner && (
            <View style={[styles.tag, { backgroundColor: '#FFF2DE', borderColor: '#F3D1A0' }]}>
              <Text style={[styles.tagText, { color: AMBER }]}>Partner</Text>
            </View>
          )}

          {item.season_tag && (
            <View style={[styles.tag, { backgroundColor: '#F6F1E9', borderColor: '#E7DED1' }]}>
              <Text style={[styles.tagText, { color: MUTED }]}>{item.season_tag}</Text>
            </View>
          )}
        </View>

        <Text style={styles.itemBody}>{item.body}</Text>

        {item.neighborhoodName && (
          <Text style={styles.locationLabel}>{item.neighborhoodName}</Text>
        )}
      </View>

      {/* ── Nearby mode: Add to list + I've done this ── */}
      {isNearbyMode ? (
        <View style={styles.nearbyActionWrap}>
          <TouchableOpacity
            style={styles.nearbyAddBtn}
            onPress={() => {
              if (!userId) {
                Alert.alert('Sign in first', 'You need an account to save items.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Sign in', onPress: () => navigation.navigate('SignIn') },
                ])
                return
              }
              if (userLists.length === 0) {
                Alert.alert(
                  'No lists yet',
                  'Create a list first to track what you do.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Create a list', onPress: () => navigation.navigate('CreateList') },
                  ]
                )
                return
              }
              setShowListPicker(true)
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.nearbyAddBtnText}>
              {itemOnListId ? '✓ On your list' : '+ Add to a list'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.nearbyDoneBtn, checked && styles.nearbyDoneBtnChecked]}
            onPress={handleNearbyDone}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving ? (
              <ActivityIndicator color={checked ? NAVY : '#fff'} />
            ) : (
              <Text style={[styles.nearbyDoneBtnText, checked && styles.nearbyDoneBtnTextChecked]}>
                {checked ? '✓ Done this!' : "I've done this"}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      ) : (
        /* ── List mode: standard check-off ── */
        <>
          <TouchableOpacity
            style={[styles.checkBtn, checked && styles.checkBtnDone]}
            onPress={handleCheckOff}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving ? (
              <ActivityIndicator color={checked ? NAVY : '#fff'} />
            ) : (
              <>
                <Text style={[styles.checkBtnIcon, checked && styles.checkBtnIconDone]}>
                  {checked ? '✓' : '○'}
                </Text>
                <Text style={[styles.checkBtnText, checked && styles.checkBtnTextDone]}>
                  {checked ? 'Checked off!' : 'Check this off'}
                </Text>
              </>
            )}
          </TouchableOpacity>

          {checked && (
            <Text style={styles.checkedSub}>Tap again to un-check · your crew can see this</Text>
          )}
        </>
      )}

      {userId && (
        <View style={styles.quickRow}>
          <TouchableOpacity
            style={styles.quickBtn}
            onPress={async () => {
              // Resolved effective list context, not the raw listId param —
              // works whether opened from a list, Nearby, or the Home rail.
              // DareScreen's own business rule (recipient must share and be
              // a member of the same non-official list) is unchanged; this
              // just makes sure it's always handed a real listId instead of
              // sometimes null.
              let dareListId = listId ?? Object.keys(itemOnListIds)[0] ?? null

              if (!dareListId) {
                const resolvedListItemId = await getOrCreateListItemId(item?.id, userId)
                if (resolvedListItemId) {
                  const { data } = await supabase
                    .from('list_items')
                    .select('list_id')
                    .eq('id', resolvedListItemId)
                    .maybeSingle()
                  dareListId = data?.list_id ?? null
                }
              }

              if (!dareListId) {
                // Dares need a shared list (DareScreen's own business rule —
                // recipient must be a member of the same non-official list).
                // This is a Dare-specific requirement, not a check-off one:
                // checking the item off itself never requires a list.
                Alert.alert('Add this to a shared list first', 'Dares need a list you and your friend both belong to.')
                return
              }

              trackEvent('dare_click', { itemId: item.id })
              navigation.navigate('Dare', { item, listId: dareListId })
            }}
          >
            <Text style={styles.quickBtnIcon}>😈</Text>
            <Text style={styles.quickBtnText}>Dare a friend</Text>
            <Text style={styles.quickBtnSub}>Make it more fun</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickBtn}
            onPress={async () => {
              // Resolves to a joined-list context if one exists; null
              // otherwise — a standalone photo check-in is valid on its
              // own, no list required (product decision, 2026-08).
              let listItemId = item?.listItemId ?? itemOnListId

              if (!listItemId) {
                listItemId = await getOrCreateListItemId(item?.id, userId)
              }

              navigation.navigate('PhotoCheckIn', {
                item: { ...item, is_secret: item.is_secret ?? item.isSecret ?? false },
                listItemId: listItemId ?? null,
              })
            }}
          >
            <Text style={styles.quickBtnIcon}>📷</Text>
            <Text style={styles.quickBtnText}>Photo check-in</Text>
            <Text style={styles.quickBtnSub}>Capture the moment</Text>
          </TouchableOpacity>
        </View>
      )}

      {(hasLoc || hasWeb) && (
        <View style={styles.actionRow}>
          {hasLoc && (
            <TouchableOpacity style={styles.actionBtn} onPress={openDirections} activeOpacity={0.8}>
              <Text style={styles.actionBtnIcon}>⌖</Text>
              <Text style={styles.actionBtnText}>Get directions</Text>
            </TouchableOpacity>
          )}
          {hasWeb && (
            <TouchableOpacity style={styles.actionBtn} onPress={openWebsite} activeOpacity={0.8}>
              <Text style={styles.actionBtnIcon}>↗</Text>
              <Text style={styles.actionBtnText}>Visit website</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <View style={styles.inviteCard}>
        <View style={styles.inviteHeaderRow}>
          <View style={styles.inviteHeaderLeft}>
            <Text style={styles.inviteTitle}>Do this together</Text>
            <Text style={styles.inviteSub}>
              Invite a friend — they'll get a link to download the app and join your list.
            </Text>
          </View>

          <TouchableOpacity style={styles.editChannelsBtn} onPress={openChannelPicker}>
            <Text style={styles.editChannels}>Edit</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.smsPreview}>
          <Text style={styles.smsPreviewLabel}>Message preview</Text>
          <Text style={styles.smsPreviewText}>{inviteMessage()}</Text>
        </View>

        <View style={styles.channelRow}>
          {displayChannels.map(key => {
            const ch = CHANNELS[key]
            if (!ch) return null
            return (
              <TouchableOpacity
                key={key}
                style={[styles.channelBtn, { backgroundColor: ch.color }]}
                onPress={() => shareVia(key)}
                activeOpacity={0.85}
              >
                <Text style={[styles.channelBtnText, { color: ch.textColor ?? '#fff' }]}>
                  {ch.label}
                </Text>
              </TouchableOpacity>
            )
          })}

          <TouchableOpacity
            style={styles.moreBtn}
            onPress={openNativeShare}
            activeOpacity={0.85}
          >
            <Text style={styles.moreBtnText}>More ···</Text>
          </TouchableOpacity>
        </View>
      </View>

      {isPartner && (
        <View style={styles.partnerCard}>
          <Text style={styles.partnerTitle}>Partner spot</Text>
          <Text style={styles.partnerSub}>
            Show the app when you visit — your check-in is logged automatically.
          </Text>
        </View>
      )}

      {!flagDone ? (
        <TouchableOpacity
          style={styles.flagBtn}
          onPress={() => setShowFlagPicker(v => !v)}
        >
          <Text style={styles.flagBtnText}>⚑  Report an issue with this item</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.flagDoneCard}>
          <Text style={styles.flagDoneText}>✓ Thanks — our team will review this item</Text>
        </View>
      )}

      {showFlagPicker && (
        <View style={styles.flagSheet}>
          <Text style={styles.flagSheetTitle}>What's the issue?</Text>
          <View style={styles.flagGrid}>
            {FLAG_REASONS.map(r => (
              <TouchableOpacity
                key={r.key}
                style={[styles.flagOption, flagReason === r.key && styles.flagOptionOn]}
                onPress={() => setFlagReason(r.key)}
              >
                <Text style={styles.flagOptionIcon}>{r.icon}</Text>
                <Text style={[styles.flagOptionText, flagReason === r.key && styles.flagOptionTextOn]}>
                  {r.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TextInput
            style={styles.flagNoteInput}
            value={flagNote}
            onChangeText={setFlagNote}
            placeholder="Optional note (e.g. closed as of April 2026)"
            placeholderTextColor="#98A2B3"
            multiline
          />

          <View style={styles.flagActions}>
            <TouchableOpacity
              style={styles.flagCancel}
              onPress={() => {
                setShowFlagPicker(false)
                setFlagReason(null)
              }}
            >
              <Text style={styles.flagCancelText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.flagSubmit, (!flagReason || flagSubmitting) && { opacity: 0.4 }]}
              onPress={submitFlag}
              disabled={!flagReason || flagSubmitting}
            >
              {flagSubmitting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.flagSubmitText}>Submit report</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {showChannelPicker && (
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerSheet}>
            <Text style={styles.pickerTitle}>Your share channels</Text>
            <Text style={styles.pickerSub}>
              Pick which platforms appear on the invite screen. We'll show those first.
            </Text>

            <View style={styles.pickerGrid}>
              {Object.entries(CHANNELS).map(([key, ch]) => {
                const on = pendingChannels?.includes(key)
                return (
                  <TouchableOpacity
                    key={key}
                    style={[
                      styles.pickerOption,
                      on && { borderColor: ch.color, borderWidth: 1.5, backgroundColor: SOFT_2 },
                    ]}
                    onPress={() => togglePendingChannel(key)}
                    activeOpacity={0.8}
                  >
                    <View style={[styles.pickerDot, { backgroundColor: ch.color }]} />
                    <Text style={[styles.pickerOptionText, on && styles.pickerOptionTextOn]}>
                      {ch.label}
                    </Text>
                    {on && <Text style={[styles.pickerCheck, { color: ch.color }]}>✓</Text>}
                  </TouchableOpacity>
                )
              })}
            </View>

            <View style={styles.pickerActions}>
              <TouchableOpacity style={styles.pickerCancel} onPress={() => setShowChannelPicker(false)}>
                <Text style={styles.pickerCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.pickerSave} onPress={saveChannels} disabled={savingChannels}>
                {savingChannels ? (
                  <ActivityIndicator color={NAVY} />
                ) : (
                  <Text style={styles.pickerSaveText}>Save preferences</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </ScrollView>

    {/* ── Nearby: List picker modal ── */}
    {showListPicker && (
      <View style={styles.listPickerOverlay}>
        <TouchableOpacity
          style={StyleSheet.absoluteFillObject}
          onPress={() => setShowListPicker(false)}
          activeOpacity={1}
        />
        <View style={styles.listPickerCard}>
          <Text style={styles.listPickerTitle}>Add to which list?</Text>
          <Text style={styles.listPickerSub}>Pick a list to add this item to</Text>

          {userLists.map(l => {
            const alreadyHasItem = !!itemOnListIds[l.id]
            return (
              <TouchableOpacity
                key={l.id}
                style={[
                  styles.listPickerRow,
                  alreadyHasItem && styles.listPickerRowDisabled,
                ]}
                onPress={() => !alreadyHasItem && addToList(l.id, l.title)}
                disabled={addingToList || alreadyHasItem}
                activeOpacity={alreadyHasItem ? 1 : 0.85}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[
                    styles.listPickerRowTitle,
                    alreadyHasItem && { color: MUTED },
                  ]}>
                    {l.title}
                  </Text>
                  <Text style={styles.listPickerRowSub}>
                    {alreadyHasItem ? '✓ Already on this list' : ''}
                  </Text>
                </View>
                {alreadyHasItem
                  ? <Text style={{ fontSize: 16, color: MUTED }}>✓</Text>
                  : addingToList
                    ? <ActivityIndicator color={AMBER} size="small" />
                    : <Text style={styles.listPickerChevron}>→</Text>
                }
              </TouchableOpacity>
            )
          })}

          <TouchableOpacity
            style={styles.listPickerCancel}
            onPress={() => setShowListPicker(false)}
          >
            <Text style={styles.listPickerCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    )}
      <Modal
        visible={!!memoryModal}
        transparent
        animationType="slide"
        onRequestClose={() => setMemoryModal(null)}
      >
        <KeyboardAvoidingView
          style={styles.memoryOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            activeOpacity={1}
            onPress={() => setMemoryModal(null)}
          />
          <View style={styles.memorySheet}>
            <Text style={styles.memoryTitle}>Make this yours</Text>
            <Text style={styles.memorySub}>
              Want to add where you did it or what made it memorable?
            </Text>

            <Text style={styles.memoryLabel}>{memoryModal?.placeLabel ?? 'Place or location'}</Text>
            <TextInput
              style={styles.memoryInput}
              placeholder="e.g. The Roosevelt Row location"
              placeholderTextColor="#A0A0AA"
              value={memoryPlace}
              onChangeText={setMemoryPlace}
              returnKeyType="next"
            />

            <Text style={styles.memoryLabel}>{memoryModal?.noteLabel ?? 'Any notes?'}</Text>
            <TextInput
              style={[styles.memoryInput, styles.memoryInputMulti]}
              placeholder="What made it memorable?"
              placeholderTextColor="#A0A0AA"
              value={memoryNote}
              onChangeText={setMemoryNote}
              multiline
              returnKeyType="done"
              blurOnSubmit
            />

            {memoryError ? (
              <Text style={styles.memoryErrorText}>{memoryError}</Text>
            ) : null}

            <TouchableOpacity
              style={styles.memorySaveBtn}
              onPress={saveMemory}
              disabled={memorySaving}
            >
              <Text style={styles.memorySaveBtnText}>
                {memorySaving ? 'Saving…' : 'Save memory'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.memorySkipBtn}
              onPress={() => {
                if ((memoryModal?.difficulty ?? 0) >= 5) {
                  notifyCrewCheckIn({
                    listItemId: memoryModal.listItemId,
                    itemBody:   memoryModal.itemBody   ?? '',
                    difficulty: memoryModal.difficulty ?? 5,
                    checkInId:  null,
                  }).catch(() => {})
                }
                setMemoryModal(null)
              }}
              disabled={memorySaving}
            >
              <Text style={styles.memorySkipBtnText}>Skip</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {tierUpgrade && (
        <TierUpgradeCelebrationModal
          tier={tierUpgrade.tier}
          newPoints={tierUpgrade.newPoints}
          onDismiss={() => setTierUpgrade(null)}
          onExploreInsider={() => {
            setTierUpgrade(null)
            navigation.navigate('ProfileTab', { screen: 'InsiderAccess' })
          }}
        />
      )}

      <PostCheckoffSheet
        data={postCheckoffData}
        onDismiss={() => setPostCheckoffData(null)}
        navigation={navigation}
      />
    </View>
  )
}

function createItemStyles({ BG, CARD, TEXT, MUTED, BORDER, SOFT, SOFT_2, AMBER, NAVY, GREEN, RED }) {
 return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },

  content: {
    padding: 20,
  },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BG,
  },

  errorText: {
    color: MUTED,
    fontSize: 14,
  },

  itemCard: {
    backgroundColor: CARD,
    borderRadius: 28,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1.2,
    borderColor: BORDER,
  },

  tagRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 14,
  },

  tag: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },

  tagText: {
    fontSize: 11,
    fontWeight: '700',
  },

  itemBody: {
    fontSize: 30,
    fontWeight: '800',
    color: TEXT,
    lineHeight: 40,
    marginBottom: 10,
  },

  locationLabel: {
    fontSize: 13,
    color: MUTED,
    fontWeight: '600',
  },


  // ── Nearby mode styles ──
  nearbyActionWrap: { gap: 10, marginBottom: 16 },
  nearbyAddBtn: { backgroundColor: CARD, borderRadius: 14, paddingVertical: 16, alignItems: 'center', borderWidth: 1.5, borderColor: AMBER },
  nearbyAddBtnText: { fontSize: 15, fontWeight: '800', color: AMBER },
  nearbyDoneBtn: { backgroundColor: '#243045', borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  nearbyDoneBtnChecked: { backgroundColor: GREEN },
  nearbyDoneBtnText: { fontSize: 15, fontWeight: '800', color: '#fff' },
  nearbyDoneBtnTextChecked: { color: '#fff' },
  listPickerOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end', zIndex: 100 },
  listPickerCard: { backgroundColor: CARD, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, gap: 8 },
  listPickerTitle: { fontSize: 18, fontWeight: '800', color: TEXT, marginBottom: 4 },
  listPickerSub: { fontSize: 13, color: MUTED, marginBottom: 12 },
  listPickerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, backgroundColor: SOFT_2, borderRadius: 14, borderWidth: 1, borderColor: BORDER, marginBottom: 8 },
  listPickerRowDisabled: { opacity: 0.5, backgroundColor: '#F4F0EC' },
  listPickerRowTitle: { fontSize: 15, fontWeight: '700', color: TEXT },
  listPickerRowSub: { fontSize: 11, color: MUTED, marginTop: 2 },
  listPickerChevron: { fontSize: 18, color: MUTED },
  listPickerCancel: { alignItems: 'center', paddingVertical: 14, marginTop: 4 },
  listPickerCancelText: { fontSize: 15, color: MUTED, fontWeight: '600' },

  checkBtn: {
    backgroundColor: NAVY,
    borderRadius: 24,
    paddingVertical: 20,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: NAVY,
  },

  checkBtnDone: {
    backgroundColor: AMBER,
    borderColor: AMBER,
  },

  checkBtnIcon: {
    fontSize: 20,
    color: '#fff',
  },

  checkBtnIconDone: {
    color: NAVY,
  },

  checkBtnText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
  },

  checkBtnTextDone: {
    color: NAVY,
  },

  checkedSub: {
    fontSize: 11,
    color: MUTED,
    textAlign: 'center',
    marginBottom: 16,
    fontWeight: '600',
  },

  quickRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },

  quickBtn: {
    flex: 1,
    backgroundColor: CARD,
    borderRadius: 22,
    paddingVertical: 18,
    paddingHorizontal: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER,
  },

  quickBtnIcon: {
    fontSize: 28,
    marginBottom: 8,
  },

  quickBtnText: {
    fontSize: 14,
    color: TEXT,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 4,
  },

  quickBtnSub: {
    fontSize: 12,
    color: MUTED,
    fontWeight: '600',
    textAlign: 'center',
  },

  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },

  actionBtn: {
    flex: 1,
    backgroundColor: SOFT,
    borderRadius: 22,
    paddingVertical: 20,
    alignItems: 'center',
    gap: 8,
    borderWidth: 1.2,
    borderColor: BORDER,
  },

  actionBtnIcon: {
    fontSize: 22,
    color: BLUE,
  },

  actionBtnText: {
    fontSize: 14,
    color: TEXT,
    fontWeight: '800',
  },

  inviteCard: {
    backgroundColor: CARD,
    borderRadius: 28,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1.2,
    borderColor: BORDER,
  },

  inviteHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
    gap: 12,
  },

  inviteHeaderLeft: {
    flex: 1,
  },

  inviteTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: TEXT,
    marginBottom: 6,
  },

  editChannelsBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: SOFT,
    borderWidth: 1.2,
    borderColor: '#E8C98E',
  },

  editChannels: {
    fontSize: 13,
    color: '#A16A00',
    fontWeight: '700',
  },

  inviteSub: {
    fontSize: 13,
    color: MUTED,
    lineHeight: 19,
  },

  smsPreview: {
    backgroundColor: SOFT_2,
    borderRadius: 18,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#DED3C5',
  },

  smsPreviewLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: MUTED,
    marginBottom: 8,
  },

  smsPreviewText: {
    fontSize: 13,
    color: TEXT,
    lineHeight: 20,
  },

  channelRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },

  channelBtn: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 82,
  },

  channelBtnText: {
    fontSize: 13,
    fontWeight: '800',
  },

  moreBtn: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: CARD,
    borderWidth: 1.2,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 96,
  },

  moreBtnText: {
    fontSize: 13,
    color: TEXT,
    fontWeight: '700',
  },

  partnerCard: {
    backgroundColor: SOFT,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#F0D29D',
  },

  partnerTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#A16A00',
    marginBottom: 5,
  },

  partnerSub: {
    fontSize: 12,
    color: '#7A6A52',
    lineHeight: 18,
  },

  pickerOverlay: {
    marginTop: 16,
    backgroundColor: CARD,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: BORDER,
  },

  pickerSheet: {
    backgroundColor: CARD,
    borderRadius: 24,
    padding: 20,
  },

  pickerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: TEXT,
    marginBottom: 6,
  },

  pickerSub: {
    fontSize: 13,
    color: MUTED,
    lineHeight: 18,
    marginBottom: 16,
  },

  pickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },

  pickerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: SOFT_2,
  },

  pickerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  pickerOptionText: {
    fontSize: 13,
    color: TEXT,
    fontWeight: '600',
  },

  pickerOptionTextOn: {
    color: TEXT,
    fontWeight: '700',
  },

  pickerCheck: {
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 2,
  },

  pickerActions: {
    flexDirection: 'row',
    gap: 10,
  },

  pickerCancel: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    backgroundColor: SOFT_2,
  },

  pickerCancelText: {
    fontSize: 14,
    color: MUTED,
    fontWeight: '700',
  },

  pickerSave: {
    flex: 2,
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: AMBER,
    alignItems: 'center',
  },

  pickerSaveText: {
    fontSize: 14,
    fontWeight: '800',
    color: NAVY,
  },

  flagBtn: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 4,
  },

  flagBtnText: {
    fontSize: 13,
    color: MUTED,
    fontWeight: '700',
  },

  flagDoneCard: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 4,
  },

  flagDoneText: {
    fontSize: 12,
    color: GREEN,
    fontWeight: '700',
  },

  flagSheet: {
    backgroundColor: CARD,
    borderRadius: 24,
    padding: 18,
    marginTop: 8,
    borderWidth: 1.2,
    borderColor: BORDER,
  },

  flagSheetTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: TEXT,
    marginBottom: 14,
  },

  flagGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },

  flagOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: SOFT_2,
  },

  flagOptionOn: {
    borderColor: RED,
    backgroundColor: '#FCECE7',
  },

  flagOptionIcon: {
    fontSize: 13,
  },

  flagOptionText: {
    fontSize: 12,
    color: MUTED,
    fontWeight: '600',
  },

  flagOptionTextOn: {
    color: RED,
    fontWeight: '700',
  },

  flagNoteInput: {
    backgroundColor: SOFT_2,
    borderRadius: 12,
    padding: 12,
    color: TEXT,
    fontSize: 12,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 12,
    minHeight: 48,
    textAlignVertical: 'top',
  },

  flagActions: {
    flexDirection: 'row',
    gap: 8,
  },

  flagCancel: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    backgroundColor: SOFT_2,
  },

  flagCancelText: {
    fontSize: 13,
    color: MUTED,
    fontWeight: '700',
  },

  flagSubmit: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: RED,
    alignItems: 'center',
  },

  flagSubmitText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#fff',
  },

  memoryOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  memorySheet: {
    backgroundColor: CARD,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 36,
  },
  memoryTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: TEXT,
    marginBottom: 6,
  },
  memorySub: {
    fontSize: 14,
    color: MUTED,
    marginBottom: 20,
    lineHeight: 20,
  },
  memoryLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  memoryInput: {
    backgroundColor: BG,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: TEXT,
    marginBottom: 16,
  },
  memoryInputMulti: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  memoryErrorText: {
    fontSize: 13,
    color: '#D85A30',
    marginBottom: 12,
  },
  memorySaveBtn: {
    backgroundColor: '#F5A623',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  memorySaveBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1A1A2E',
  },
  memorySkipBtn: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  memorySkipBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: MUTED,
  },
 })
}