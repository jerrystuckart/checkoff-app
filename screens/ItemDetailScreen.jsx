import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import {
  View,
  Text,
  Image,
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
import { LinearGradient } from 'expo-linear-gradient'
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
import { resolveCheckOffAttachment } from '../lib/checkOffAttachment'
import { cancelAtPlaceReminder } from '../lib/visitDetection/atPlaceReminder'
import { checkGeoFence, presentGeoFenceFailure } from '../lib/geoFence'
import * as Location from 'expo-location'
import { isAtPlace } from '../lib/whatsGoodAtPlace'
import { useCoverCandidateCTA } from '../lib/useCoverCandidateCTA'
import CoverCandidateCTA from '../components/CoverCandidateCTA'
import { fetchActiveCoverImageUrl, fetchDisplayEligibleImagePool } from '../lib/coverCandidates'
import PostCheckoffSheet from '../components/PostCheckoffSheet'
import DetailArtwork from '../components/itemDetail/DetailArtwork'
import { buildInviteMessage, buildInviteAskLine } from '../lib/inviteMessage'
import { useSavedItems } from '../lib/SavedItemsContext'
import BookmarkIcon from '../components/BookmarkIcon'
import { deriveTitlePresentation } from '../lib/detailTitlePresentation'

const AMBER = '#F5A623'
const NAVY = '#1A1A2E'
const GREEN = '#1D9E75'
const BLUE = '#378ADD'

const RED = '#D85A30'

const RING_COLORS = ['#1D9E75', '#378ADD', '#BA7517', '#D85A30']
const RING_LABELS = ['Core', 'Near', 'Metro', 'Destination']

// Item Detail Corrective Pass (2026-09-18) — the hero's localized
// left-to-right scrim falloff, shared by both theme's HERO_SCRIM_* color
// stops (lib/ThemeContext.js). Strong at x=0 (behind the text column),
// dropping steeply through 0.2, and fully clear (opacity 0) by 0.42 — well
// inside the "clear before the right 35-45%" requirement — then staying
// clear all the way to x=1 so the artwork's focal subject on the right
// never gets any dark wash.
const HERO_GRADIENT_LOCATIONS = [0, 0.2, 0.42, 1]

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
  const { isSaved, toggleSaved } = useSavedItems()
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
  // userLists / itemOnListId stay — they feed performNearbyDone's
  // resolveCheckOffAttachment call (real check-off business logic, see its
  // own comment below), NOT a rendered "Add to list" control. The rendered
  // control itself (Item Detail Corrective Pass, 2026-09-18) was removed —
  // list membership is managed from the Lists tab now (a24148d's
  // ListsScreen/SavedItemsScreen). itemOnListIds and the picker-only
  // showListPicker/addingToList state existed solely to grey out rows in
  // that now-removed picker UI, so they're removed along with it.
  const [userLists, setUserLists] = useState([])
  const [itemOnListId, setItemOnListId] = useState(null) // listItemId if item is on any user list
  const [listInviteCode, setListInviteCode] = useState(null)
  // Item Detail Corrective Pass (2026-09-18) — "Invite someone" opens this
  // on-demand channel sheet rather than the old permanently-inline channel
  // grid. Reuses the exact existing CHANNELS/shareVia/openNativeShare
  // logic below, just moved behind a tap.
  const [showInviteChannels, setShowInviteChannels] = useState(false)

  // Item Detail Corrective Pass (2026-09-19) — Goal 2: the rare "extreme"
  // title tier (lib/detailTitlePresentation.js) offers a "Read full thing"
  // action that opens this modal with the complete, untruncated item body.
  // Reset on item change (mirroring DetailArtwork.jsx's own photoFailed
  // reset on item?.id, for the same reason: this is local UI state tied to
  // ONE specific item, and must never carry over silently when the user
  // navigates from one Detail screen instance to the next item).
  const [showFullBodyModal, setShowFullBodyModal] = useState(false)
  useEffect(() => {
    setShowFullBodyModal(false)
  }, [item?.id])

  useEffect(() => {
    loadUser()
  }, [])

  // Community Cover Photos V1 — a one-shot, permission-check-only location
  // read (never requests; if the OS permission isn't already granted, this
  // silently stays null and the contribution CTA below just doesn't show —
  // matches this app's "never silently prompt" convention). Uses the same
  // existing, approved foreground presence rule as Home
  // (lib/whatsGoodAtPlace.js's isAtPlace, min(geo_radius_m, 150m)) — not a
  // new radius/dwell concept.
  const [detailUserLocation, setDetailUserLocation] = useState(null)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync()
        if (status !== 'granted') return
        const pos = await Location.getLastKnownPositionAsync({}).catch(() => null)
        if (!cancelled && pos?.coords) {
          setDetailUserLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude })
        }
      } catch {
        // location unavailable — contribution CTA simply won't show
      }
    })()
    return () => { cancelled = true }
  }, [])

  const isAtPlaceForItem = isAtPlace(item, detailUserLocation)

  // Final UI Pass Before Build 144 — item 3: one image truth regardless of
  // navigation source. `item` (route.params.item) only carries
  // activeCoverImageUrl when it came from HomeScreen's own enriched query;
  // this fetch fills the gap for Near You/Nearby, Lists, and
  // Profile/history entry points. `resolvedItem` (not `item`) is what
  // feeds both the eligibility check below and the image render further
  // down, so a selected cover is never missed and the "no contribution CTA
  // once a cover exists" rule holds no matter how this screen was reached.
  const [fetchedCoverUrl, setFetchedCoverUrl] = useState(null)
  useEffect(() => {
    let cancelled = false
    if (!item?.id) return undefined
    fetchActiveCoverImageUrl({ itemId: item.id }).then((url) => {
      if (!cancelled && url) setFetchedCoverUrl(url)
    })
    return () => { cancelled = true }
  }, [item?.id])

  // Multi-Image Rotation (2026-09-03) — fetch the full display-eligible
  // pool directly (fresh signed URLs), same reasoning as fetchedCoverUrl
  // above: an item navigated here from Near You/Lists/Profile never had
  // HomeScreen's own displayEligibleImages attach step run on it, and
  // even when it did, those signed URLs may be stale by the time this
  // screen mounts. This is the only source of truth this screen reads —
  // resolvedItemImage() below is called with the SAME (userId, dateKey)
  // context Home uses (see lib/rotationContext.js), so a multi-image item
  // renders the identical pick here as it just did on Home, within the
  // same session/day.
  const [fetchedImagePool, setFetchedImagePool] = useState(null)
  useEffect(() => {
    let cancelled = false
    if (!item?.id) return undefined
    fetchDisplayEligibleImagePool({ itemId: item.id }).then((pool) => {
      if (!cancelled && pool.length > 0) setFetchedImagePool(pool)
    })
    return () => { cancelled = true }
  }, [item?.id])

  const resolvedItem = {
    ...item,
    ...(fetchedCoverUrl ? { activeCoverImageUrl: fetchedCoverUrl } : null),
    ...(fetchedImagePool ? { displayEligibleImages: fetchedImagePool } : null),
  }

  // useCoverCandidateCTA already checks for an existing approved image
  // internally (lib/coverCandidateEligibility.js) — not re-checked here.
  const showCoverContributionCTA = useCoverCandidateCTA({ userId, item: resolvedItem, isAtPlace: isAtPlaceForItem })

  // Visit Reminder V1.5 — as soon as this item is checked off (any of the
  // checkoff paths below, tap/photo/etc. all funnel into setChecked(true)),
  // cancel any pending at-place reminder for it. No-op if none is pending
  // (e.g. the flag was off, or the item was never at-place).
  useEffect(() => {
    if (checked && item?.id) cancelAtPlaceReminder(item.id)
  }, [checked, item?.id])

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
      // Set first match as the listItemId for "I've done this" button —
      // this is the ONLY consumer of `existing` now that the "Add to
      // list"/"On your list" picker UI (which used to grey out rows here
      // via a listId->listItemId map) is gone (Item Detail Corrective
      // Pass, 2026-09-18). List membership is managed from the Lists tab.
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

  // "Do This Together" invitation copy (Item Detail redesign, 2026-09-18;
  // final copy corrected 2026-09-19) — the approved message leads with the
  // conversational opening, then the item's own COMPLETE body in quotes
  // (never truncated, never a separate "at {venue}" framing — item.body
  // already carries the venue naturally), then "You in?", then the
  // item-specific URL on its own line. Message text itself is built by the
  // pure lib/inviteMessage.js helper; this function just supplies the raw
  // itemBody/itemId + preserves existing list-mode URL fallback (used only
  // when itemId is missing/malformed — see buildItemDeepLinkUrl).
  function inviteMessage() {
    return buildInviteMessage({
      itemBody: item?.body,
      itemId: item?.id,
      listInviteCode,
    })
  }

  // Item Detail Corrective Pass (2026-09-18; copy corrected 2026-09-19) —
  // the short "ask" line shown on the compact "DO THIS TOGETHER" card
  // itself: a safely-clamped preview of the SAME conversational opening +
  // quoted body + "You in?" used in the real shared message (no URL shown
  // inline on the card — the URL is appended only when actually sharing).
  // Calls the same buildInviteAskLine() the pure helper exports, so the
  // visible card copy and the shared message's opening can never drift
  // apart; only this preview may be visually clamped for card compactness,
  // never the actual shared text (see inviteMessage() above, which is
  // never truncated).
  function inviteAskLine() {
    return buildInviteAskLine({ itemBody: item?.body })
  }

  // Item Detail Redesign (2026-09-18) — un-check confirmation gate. Purely
  // a UI gate in front of the existing delete branch inside
  // performCheckOff() below: the check-in data model, season/window
  // scoping, and fan-out logic are all untouched, byte-for-byte identical
  // to before this pass. Also the single call site for the new
  // 'item_checkoff_tap' analytics event (fires on every tap, regardless of
  // which direction the toggle goes, matching the existing tap-level
  // granularity of directions_click/url_click/dare_click).
  async function handleCheckOff() {
    if (!userId) {
      Alert.alert('Sign in first', 'You need an account to check off items.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign in', onPress: () => navigation.navigate('SignIn') },
      ])
      return
    }

    trackEvent('item_checkoff_tap', { itemId: item?.id, listId })

    if (checked) {
      Alert.alert(
        'Un-check this item?',
        'This removes your check-in for this item.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Un-check', style: 'destructive', onPress: () => { performCheckOff() } },
        ]
      )
      return
    }

    await performCheckOff()
  }

  async function performCheckOff() {
    // Started here, before the list-item lookup and geofence check (both of
    // which can take seconds on slow network/GPS — checkGeoFence alone races
    // a 6s GPS timeout), so the button shows its spinner the instant the
    // user taps instead of appearing frozen. Every early return between here
    // and the try block below must reset it explicitly since none of them
    // reach the try/finally's own reset.
    setSaving(true)

    let candidateListItemId = item?.listItemId

    if (!candidateListItemId) {
      // Resolves to a joined-list context if one exists; null otherwise.
      // A null result is NOT an error — item_id is the check-in's source
      // of truth, and list membership is never required to complete it
      // (product decision, 2026-08). The insert below falls back to a
      // standalone row (list_item_id: null) in that case.
      candidateListItemId = await getOrCreateListItemId(item?.id, userId)
    }

    // Photo-required items go to PhotoCheckInScreen — no tap shortcut,
    // matches the existing rule at ListScreen.jsx:902. Only applies when
    // checking ON; unchecking an already-checked item needs no photo.
    // PhotoCheckInScreen resolves this same candidate itself via
    // resolveCheckOffAttachment before it inserts.
    if (item?.photoRequired && !checked) {
      setSaving(false)
      navigation.navigate('PhotoCheckIn', { item, listItemId: candidateListItemId })
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
        // Check-ins are permanent across seasons — unchecking must only
        // remove the CURRENT window's row(s), never a prior season's
        // history. Uses this list's own dates when in list mode (matching
        // loadCheckedState's own window source here), or the global
        // season otherwise — same ternary, so "checked" and "what gets
        // deleted" can never disagree.
        const [{ data: allCheckins }, windowDates] = await Promise.all([
          supabase.from('check_ins').select('id, checked_at').eq('user_id', userId).eq('item_id', item?.id ?? null),
          listId
            ? supabase.from('lists').select('starts_at, ends_at').eq('id', listId).maybeSingle()
                .then(({ data: l }) => ({ starts_at: l?.starts_at ?? null, ends_at: l?.ends_at ?? null }))
            : getCurrentSeasonWindow(),
        ])
        const idsThisWindow = (allCheckins ?? [])
          .filter(ci => isWithinWindow(ci.checked_at, windowDates.starts_at, windowDates.ends_at))
          .map(ci => ci.id)
        // Global by item_id, not just this list's row — a check-off is a
        // fact about the user and the item, so unchecking must be too —
        // but only within the current window; prior seasons are untouched.
        if (idsThisWindow.length) {
          const { error } = await supabase.from('check_ins').delete().in('id', idsThisWindow)
          if (error) throw error
        }
        setChecked(false)
      } else {
        // points_awarded on the primary row — same difficulty * point_multiplier
        // formula as lib/useItems.js checkOff. Fan-out (lib/checkInFanOut.js)
        // deliberately leaves secondary rows at 0 to avoid double-counting.
        //
        // resolveCheckOffAttachment decides whether to actually use
        // candidateListItemId or fall back to standalone — a personal
        // (non-official) list's list_item_id never changes across
        // seasons, so reusing it here would collide with
        // check_ins_user_id_list_item_id_key the moment this item was
        // already checked off in a prior season. See lib/checkOffAttachment.js.
        const { listItemId, pointMultiplier } = await resolveCheckOffAttachment(candidateListItemId)
        const pointsAwarded = Math.round((item?.difficulty ?? 1) * pointMultiplier)

        // item_id is the canonical, always-available path to this check-in's
        // item — it survives list deletion (list_item_id goes null then).
        // list_item_id itself is null here when the item has no joined-list
        // context — a standalone check-in, valid on its own.
        //
        // Standalone check-ins are never season-scoped at the DB level (the
        // lifetime uniqueness constraint that used to enforce "once ever"
        // was dropped — see 20260806_drop_standalone_lifetime_unique.sql —
        // specifically so a prior-season check-in on this same item_id
        // doesn't block a new one). That means nothing left in the database
        // stops a same-season duplicate either, so this app-layer check
        // takes over: same isWithinWindow/getCurrentSeasonWindow logic the
        // UI's own checked-state already uses, so the two can never
        // disagree. Only guards the standalone path — list-attached
        // check-ins are already correctly scoped by their own list's fresh
        // list_item_id each season, no guard needed there.
        if (!listItemId) {
          const [{ data: priorCheckins }, season] = await Promise.all([
            supabase.from('check_ins').select('checked_at').eq('user_id', userId).eq('item_id', item?.id ?? null),
            getCurrentSeasonWindow(),
          ])
          const alreadyThisSeason = (priorCheckins ?? []).some(ci =>
            isWithinWindow(ci.checked_at, season.starts_at, season.ends_at)
          )
          if (alreadyThisSeason) {
            setChecked(true)
            return
          }
        }

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
            // collided with — only that a check-in matching the EXACT slot
            // we just tried to write (list_item_id if we sent one,
            // otherwise this exact item_id with list_item_id IS NULL) is
            // confirmed to exist is a success-equivalent outcome. Scoped
            // to the specific attempted slot rather than a bare item_id
            // match, and returns an array (not .maybeSingle()) so a
            // fanned-out item with several check_ins rows sharing this
            // item_id can't be misread as "no match" via a multi-row
            // PGRST116 error.
            const verifyQuery = supabase.from('check_ins').select('id').eq('user_id', userId)
            if (listItemId) {
              verifyQuery.eq('list_item_id', listItemId)
            } else {
              verifyQuery.eq('item_id', item?.id ?? null).is('list_item_id', null)
            }
            const { data: existingRows } = await verifyQuery
            if (existingRows?.length) {
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

  // Item Detail Corrective Pass (2026-09-18) — the old "openListPicker"/
  // "addToList" pair (formerly triggered from a compact "Add to
  // list"/"On your list" utility chip) has been removed along with that
  // chip's rendered UI (Goal 3: no legacy list-membership control remains
  // on Detail, in any mode). List membership is now managed exclusively
  // from the Lists tab (a24148d's ListsScreen/SavedItemsScreen). The
  // underlying capability this removed function used to expose — adding
  // an item to a user's own list via a `list_items` insert — is untouched
  // and still lives on ListScreen.jsx's own "add item to list" flow;
  // nothing here deleted that capability from the codebase, only its
  // now-redundant second entry point on Detail. `itemOnListId` (derived by
  // refreshItemListContext above) is NOT part of this removal — it is
  // real check-off business logic (resolveCheckOffAttachment's list
  // context for a standalone Nearby check-off), not UI, and stays exactly
  // as before.

  // ── Nearby mode: check off item that's already on a list ──
  // See handleCheckOff's own comment above — same un-check confirmation
  // gate and 'item_checkoff_tap' analytics call, applied to the Nearby-mode
  // path. performNearbyDone() below is byte-for-byte the original
  // handleNearbyDone body (minus the sign-in check, now owned by this
  // wrapper), untouched.
  async function handleNearbyDone() {
    if (!userId) {
      Alert.alert('Sign in first', 'You need an account to check off items.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign in', onPress: () => navigation.navigate('SignIn') },
      ])
      return
    }

    trackEvent('item_checkoff_tap', { itemId: item?.id })

    if (checked) {
      Alert.alert(
        'Un-check this item?',
        'This removes your check-in for this item.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Un-check', style: 'destructive', onPress: () => { performNearbyDone() } },
        ]
      )
      return
    }

    await performNearbyDone()
  }

  async function performNearbyDone() {
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
        // Check-ins are permanent across seasons — unchecking must only
        // remove the current (global) season's row(s), never a prior
        // season's history. Nearby mode has no listId, so the global
        // season window is the same source loadCheckedState used here.
        const [{ data: allCheckins }, season] = await Promise.all([
          supabase.from('check_ins').select('id, checked_at').eq('user_id', userId).eq('item_id', item?.id ?? null),
          getCurrentSeasonWindow(),
        ])
        const idsThisSeason = (allCheckins ?? [])
          .filter(ci => isWithinWindow(ci.checked_at, season.starts_at, season.ends_at))
          .map(ci => ci.id)
        // Global by item_id, not just this list's row — a check-off is a
        // fact about the user and the item, so unchecking must be too —
        // but only within the current season; prior seasons are untouched.
        if (idsThisSeason.length) {
          const { error } = await supabase.from('check_ins').delete().in('id', idsThisSeason)
          if (error) throw error
        }
        setChecked(false)
      } else {
        // points_awarded on the primary row — same difficulty * point_multiplier
        // formula as lib/useItems.js checkOff. Fan-out (lib/checkInFanOut.js)
        // deliberately leaves secondary rows at 0 to avoid double-counting.
        //
        // resolveCheckOffAttachment decides whether to actually use
        // itemOnListId or fall back to standalone — a personal
        // (non-official) list's list_item_id never changes across
        // seasons, so reusing it here would collide with
        // check_ins_user_id_list_item_id_key the moment this item was
        // already checked off in a prior season. See lib/checkOffAttachment.js.
        const { listItemId, pointMultiplier } = await resolveCheckOffAttachment(itemOnListId)
        const pointsAwarded = Math.round((item?.difficulty ?? 1) * pointMultiplier)

        // item_id is the canonical, always-available path to this check-in's
        // item — it survives list deletion (list_item_id goes null then).
        // list_item_id is null here when this item isn't on any of the
        // user's own lists — a standalone check-in, valid on its own.
        //
        // Standalone check-ins are never season-scoped at the DB level (the
        // lifetime uniqueness constraint that used to enforce "once ever"
        // was dropped — see 20260806_drop_standalone_lifetime_unique.sql —
        // specifically so a prior-season check-in on this same item_id
        // doesn't block a new one). That means nothing left in the database
        // stops a same-season duplicate either, so this app-layer check
        // takes over: same isWithinWindow/getCurrentSeasonWindow logic the
        // UI's own checked-state already uses, so the two can never
        // disagree. Only guards the standalone path — list-attached
        // check-ins are already correctly scoped by their own list's fresh
        // list_item_id each season, no guard needed there.
        if (!listItemId) {
          const [{ data: priorCheckins }, season] = await Promise.all([
            supabase.from('check_ins').select('checked_at').eq('user_id', userId).eq('item_id', item?.id ?? null),
            getCurrentSeasonWindow(),
          ])
          const alreadyThisSeason = (priorCheckins ?? []).some(ci =>
            isWithinWindow(ci.checked_at, season.starts_at, season.ends_at)
          )
          if (alreadyThisSeason) {
            setChecked(true)
            return
          }
        }

        const { error } = await supabase
          .from('check_ins')
          .insert({ user_id: userId, list_item_id: listItemId ?? null, item_id: item?.id ?? null, checkin_method: 'tap', points_awarded: pointsAwarded })
        if (error) {
          if (error.code !== '23505') throw error
          // A unique-constraint hit alone doesn't say WHICH row it
          // collided with — only that a check-in matching the EXACT slot
          // we just tried to write (list_item_id if we sent one, otherwise
          // this exact item_id with list_item_id IS NULL) is confirmed to
          // exist is a success-equivalent outcome. Scoped to the specific
          // attempted slot rather than a bare item_id match, and returns an
          // array (not .maybeSingle()) so a fanned-out item with several
          // check_ins rows sharing this item_id can't be misread as "no
          // match" via a multi-row PGRST116 error.
          const verifyQuery = supabase.from('check_ins').select('id').eq('user_id', userId)
          if (listItemId) {
            verifyQuery.eq('list_item_id', listItemId)
          } else {
            verifyQuery.eq('item_id', item?.id ?? null).is('list_item_id', null)
          }
          const { data: existingRows } = await verifyQuery
          if (!existingRows?.length) {
            Alert.alert('Could not check off', 'Something went wrong — please try again.')
            return
          }
        }
        // Sheet only presents once the insert is confirmed (or verified as
        // a genuine already-checked-off duplicate) — never before, so a
        // slow/failed/collided write can't show a false "Checked off"
        // moment.
        setChecked(true)
        setPostCheckoffData({ itemId: item?.id, listItemId, userId, item })
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
            listItemId,
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

  // Item Detail Corrective Pass (2026-09-18) — ONE shared derivation of
  // what to render (Goal 6), computed once here and fed to the single
  // hero/primary/utility/invite structure below. Nothing here differs
  // between list mode and Nearby mode — only the tap BEHAVIOR (which
  // handler fires) branches on `isNearbyMode`, never the visual shape.
  const ring = item.ring_weight ?? 0
  const ringColor = RING_COLORS[ring] ?? RING_COLORS[0]
  const hasLoc = item.maps_query || ((item.maps_lat ?? item.mapsLat) && (item.maps_lng ?? item.mapsLng))
  const hasWeb = !!item.website_url
  const isPartner = !!item.partner_id
  // Same +N pts convention as WhatsTheThingHero.jsx's pointsLabel — not a
  // new/fabricated field, item.difficulty always has this exact fallback.
  const heroPointsLabel = `+${item.difficulty ?? 1} pts`

  // Item Detail Corrective Pass (2026-09-18/19) — Goal 2: the old hard
  // numberOfLines={2} clamp truncated real item bodies mid-word/mid-
  // thought (e.g. "Find the door disguised as a painti…"), losing the
  // actual point of the experience. A later pass's below-hero
  // "continuation" fix then introduced its OWN bug (a title splitting into
  // a hero fragment plus an orphaned fragment below it — see physical-
  // device screenshots). deriveTitlePresentation (pure, unit-tested in
  // lib/detailTitlePresentation.test.js) now always renders the title
  // entirely inside the hero — never below it — expanding the hero's own
  // text-safe area and line allowance for longer bodies, and only for the
  // rare "extreme" outlier truncating (with a deliberate ellipsis) and
  // exposing a "Read full thing" action to a modal with the complete body.
  const titlePresentation = deriveTitlePresentation(item.body)

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
      {/* Item Detail Corrective Pass (2026-09-18) — Goal 1: ONE combined
          editorial hero card (artwork + content), replacing the prior
          separate full-bleed artwork block + separate title/tag card
          (which together consumed ~420dp before this pass: heroWrap's
          260dp + itemCard's own padding/tagRow/2-3-line title/location —
          the explicit bug this pass fixes). The new heroCard below caps at
          240dp (roughly 8:5 at typical phone content width, e.g. ~350dp
          wide / 1.6 ratio ≈ 219dp, so the 240dp cap is a ceiling for wider
          viewports, not the everyday height) plus, only for unusually long
          bodies, one compact continuation line beneath it — materially
          shorter in the common case, never taller than before.
          DetailArtwork itself is untouched (same contract, same
          photo->archetype->generic priority via useCardArtwork/
          ArchetypeArtwork/resolveArtworkTier) — only WHERE it's composed
          changes: it now fills this single rounded, border-less hero
          container as an absolute-fill background layer, with a new
          left-to-right scrim (added here, not inside DetailArtwork/
          ArchetypeArtwork, since ArchetypeArtwork's own built-in gradient
          is a fixed top-to-bottom treatment for bottom-anchored text on
          other cards — its contract is intentionally left unchanged) so
          the artwork's focal subject (the archetype asset convention's own
          right 40-45%) stays visible on the right while text reads clearly
          on the left. */}
      <View style={[styles.heroCard, { maxHeight: titlePresentation.heroHeightHint }]}>
        <DetailArtwork item={resolvedItem} userId={userId} colors={colors} style={StyleSheet.absoluteFillObject} />
        {/* Localized left-to-right scrim (Item Detail Corrective Pass,
            2026-09-18) — replaces the prior version of this same gradient,
            which used only 3 stops (0 / 0.55 / 1) and stayed at 0.45
            opacity all the way to the 55% mark, so roughly half the
            artwork's width read as dimmed regardless of where the text
            actually sat. This version is strongest at x=0 (behind the
            text), then falls off steeply and is fully clear by
            HERO_GRADIENT_LOCATIONS' third stop (0.42) — comfortably inside
            the "clear well before the right 35-45%" requirement — so the
            artwork's focal subject on the right stays fully colorful.
            Root cause of the OLD "whole image looks dark" bug wasn't only
            this gradient's own shallow falloff — see DetailArtwork.jsx's
            own comment on why ArchetypeArtwork's separate, full-width
            top-to-bottom scrim (gradient={false} there now) was stacking
            with this one. HERO_SCRIM_STRONG/SOFT/CLEAR are theme tokens
            (lib/ThemeContext.js) — light mode uses a lower peak opacity
            and a warm-navy base rather than dark mode's near-black
            values. */}
        <LinearGradient
          colors={[colors.HERO_SCRIM_STRONG, colors.HERO_SCRIM_SOFT, colors.HERO_SCRIM_CLEAR, colors.HERO_SCRIM_CLEAR]}
          locations={HERO_GRADIENT_LOCATIONS}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFillObject}
          pointerEvents="none"
        />

        {/* Accessibility: one grouped element reading title -> venue ->
            meta in order, rather than a screen reader hitting each
            absolutely-laid-out overlay Text separately. Decorative
            artwork above is already hidden from the tree by
            ArchetypeArtwork's own accessibilityElementsHidden. */}
        <View
          style={styles.heroContent}
          accessible
          accessibilityLabel={[
            item.body,
            item.neighborhoodName,
            heroPointsLabel,
            item.dist_label ?? item.distance_label ?? null,
          ].filter(Boolean).join('. ')}
          importantForAccessibility="no-hide-descendants"
        >
          <View style={styles.heroPillRow}>
            <View style={[styles.heroPill, { borderColor: 'rgba(255,255,255,0.4)' }]}>
              <Text style={[styles.heroPillText, { color: ringColor }]}>
                {RING_LABELS[ring] ?? 'Core'}
              </Text>
            </View>
            {item.categoryName && (
              <View style={[styles.heroPill, { borderColor: 'rgba(255,255,255,0.4)' }]}>
                <Text style={styles.heroPillText}>{item.categoryName}</Text>
              </View>
            )}
            {isPartner && (
              <View style={[styles.heroPill, { borderColor: 'rgba(255,255,255,0.4)' }]}>
                <Text style={[styles.heroPillText, { color: AMBER }]}>Partner</Text>
              </View>
            )}
          </View>

          <Text
            style={[styles.heroTitle, { fontSize: titlePresentation.heroFontSize, lineHeight: titlePresentation.heroLineHeight }]}
            numberOfLines={titlePresentation.heroNumberOfLines}
          >
            {titlePresentation.heroLines}
          </Text>

          {/* Extreme-tier-only escape hatch (Item Detail Corrective Pass,
              2026-09-19) — visually secondary, inside the hero itself
              (never a second block below it). Opens a modal with the
              complete, untruncated body — heroContent's own grouped
              accessibilityLabel above already announces that same
              complete body once, so this control's own label names the
              action, not the text it reveals. */}
          {titlePresentation.showFullTextAction ? (
            <TouchableOpacity
              style={styles.heroReadFullBtn}
              onPress={() => setShowFullBodyModal(true)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Read full thing"
              accessibilityHint="Opens the complete description in a sheet"
            >
              <Text style={styles.heroReadFullBtnText}>Read full thing</Text>
            </TouchableOpacity>
          ) : null}

          {item.neighborhoodName ? (
            <Text style={styles.heroVenue} numberOfLines={1}>{item.neighborhoodName}</Text>
          ) : null}

          <View style={styles.heroMetaRow}>
            <Text style={styles.heroMetaText}>{heroPointsLabel}</Text>
            {(item.dist_label ?? item.distance_label) ? (
              <Text style={styles.heroMetaText}>· {item.dist_label ?? item.distance_label}</Text>
            ) : null}
          </View>
        </View>
      </View>

      {/* Full-body modal (Item Detail Corrective Pass, 2026-09-19) — the
          extreme tier's only escape hatch, reached via the in-hero "Read
          full thing" action above. Renders titlePresentation.fullText
          verbatim — the exact, complete original item body, never
          re-truncated or paraphrased. Follows this app's own established
          Modal + bottom-sheet pattern (see the "Invite via" sheet just
          below, and components/PostCheckoffSheet.jsx) rather than a new
          one. The sheet's own ScrollView may scroll for an exceptionally
          long body — it is the HERO itself that must never nest a
          scrolling region, and this modal is entirely outside the hero. */}
      <Modal
        visible={showFullBodyModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowFullBodyModal(false)}
        statusBarTranslucent
      >
        <View style={styles.fullBodyOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            activeOpacity={1}
            onPress={() => setShowFullBodyModal(false)}
          />
          <View style={styles.fullBodySheet}>
            <View style={styles.handleWrap}>
              <View style={styles.handle} />
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.fullBodyText} accessibilityRole="header">
                {titlePresentation.fullText}
              </Text>
            </ScrollView>
            <TouchableOpacity
              style={styles.fullBodyCloseBtn}
              onPress={() => setShowFullBodyModal(false)}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Text style={styles.fullBodyCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {showCoverContributionCTA ? (
        <View style={styles.topContributionWrap}>
          <Text style={styles.coverContributionTitle}>Help locals see the thing</Text>
          <CoverCandidateCTA item={resolvedItem} navigation={navigation} colors={colors} compact />
        </View>
      ) : null}

      {/* Item Detail Corrective Pass (2026-09-18) — Goal 6: ONE shared
          primary-action structure across list and Nearby mode. Both
          branches render the exact same primaryActionRow shape (Done/
          DONE ✓ button + Photo Check-in, side by side) — only the Done
          button's onPress handler differs by mode (handleNearbyDone vs
          handleCheckOff), never the visual hierarchy. The old dedicated
          list-membership button (formerly a two-word "Add to" + "list"/
          "On your" + "list" toggle) that used to occupy this primary
          position in Nearby mode is gone (Goal 3) — that capability lives
          only in the Lists tab now. */}
      <View style={styles.primaryActionRow}>
        <TouchableOpacity
          style={[styles.primaryDoneBtn, checked && styles.primaryDoneBtnChecked]}
          onPress={isNearbyMode ? handleNearbyDone : handleCheckOff}
          disabled={saving}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={checked ? `${item.body}, done — tap to un-check` : `Mark ${item.body} as done`}
          accessibilityState={{ checked, disabled: saving, busy: saving }}
        >
          {saving ? (
            <ActivityIndicator color={checked ? '#fff' : NAVY} />
          ) : (
            <Text style={[styles.primaryDoneBtnText, checked && styles.primaryDoneBtnTextChecked]}>
              {checked ? 'DONE ✓' : "I'VE DONE THIS"}
            </Text>
          )}
        </TouchableOpacity>

        {/* Photo Check-in is a PRIMARY action (side by side with Done),
            not a utility action — Item Detail Corrective Pass addendum,
            2026-09-18. It must never move into the utilityRow below.
            Gets the stronger outline per the approved visual language.
            Same list-context resolution as before this pass
            (item?.listItemId ?? itemOnListId, falling back to
            getOrCreateListItemId) — untouched business logic, only its
            container moved. */}
        <TouchableOpacity
          style={styles.primaryPhotoBtn}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Photo check-in"
          onPress={async () => {
            if (!userId) {
              Alert.alert('Sign in first', 'You need an account to check off items.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Sign in', onPress: () => navigation.navigate('SignIn') },
              ])
              return
            }
            trackEvent('photo_checkin_tap', { itemId: item?.id, listId })
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
          <Text style={styles.primaryPhotoBtnText}>Photo check-in</Text>
        </TouchableOpacity>
      </View>

      {/* Item Detail Corrective Pass (2026-09-18) — Goal 3 fix: the prior
          pass's marginLeft-auto pin on Save was structurally correct
          (Save always rendered trailing) but, per physical-device
          screenshots, produced a large awkward empty gap whenever Website
          or Directions was absent — `auto` margin reserves whatever space
          those siblings WOULD have used rather than letting the remaining
          controls actually fill the row. Fixed here by giving every
          VISIBLE control `flex: 1` (utilityBtn) inside a plain
          `flexDirection: 'row'` container, rendering ONLY the
          actually-present controls, with NO placeholder/invisible spacer
          elements. flex:1 on however many siblings are actually present
          naturally produces "N equal-width controls filling the row" —
          Directions+Website+Save fill it as three, Directions+Save (or
          Website+Save) as two, Save alone fills it completely — all
          without any index/hasLoc/hasWeb-based positioning logic. Save
          stays the always-last, always-rightmost control purely because
          it is the last one written in this JSX, not because of any
          margin trick. */}
      {userId && (
        <View style={styles.utilityRow}>
          {hasLoc && (
            <TouchableOpacity
              style={styles.utilityBtn}
              onPress={openDirections}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Get directions"
            >
              <Text style={styles.utilityBtnIcon}>⌖</Text>
              <Text style={styles.utilityBtnText}>Directions</Text>
            </TouchableOpacity>
          )}
          {hasWeb && (
            <TouchableOpacity
              style={styles.utilityBtn}
              onPress={openWebsite}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Visit website"
            >
              <Text style={styles.utilityBtnIcon}>↗</Text>
              <Text style={styles.utilityBtnText}>Website</Text>
            </TouchableOpacity>
          )}
          {/* Save — always rendered last among the present controls, so it
              is always the trailing/rightmost one. No marginLeft-auto trick,
              no separate "Save" style variant — it gets the exact same
              utilityBtn flex:1 treatment as Directions/Website, so it
              never looks different whether it's alone or accompanied. */}
          <TouchableOpacity
            style={styles.utilityBtn}
            onPress={() => toggleSaved(item.id, navigation)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={{ selected: isSaved(item.id) }}
            accessibilityLabel={isSaved(item.id) ? `Remove ${item.body} from Saved` : `Save ${item.body}`}
          >
            <BookmarkIcon filled={isSaved(item.id)} color={AMBER} size={18} />
            <Text style={styles.utilityBtnText}>{isSaved(item.id) ? 'Saved' : 'Save'}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Item Detail Corrective Pass (2026-09-18) — Goal 4: ONE compact
          "DO THIS TOGETHER" card, the same in every mode. Replaces the
          previously-always-inline message preview, always-inline "Edit"
          button, and always-inline channel grid (which is what was
          actually still rendering the "legacy UI leaks through" bug — see
          the final report's Goal 4 root-cause section) with just a title,
          the short venue-aware ask copy, and a single "Invite someone"
          action. Tapping it opens the channel chooser (showInviteChannels
          below) rather than that chooser being permanently on the page.
          The Dare feature/screen/logic itself is untouched elsewhere in
          this codebase — only its old oversized default entry point on
          Detail, already gone before this pass, stays gone. */}
      <View style={styles.inviteCard}>
        <Text style={styles.inviteTitle}>DO THIS TOGETHER</Text>
        <Text style={styles.inviteAsk}>{inviteAskLine()}</Text>

        <TouchableOpacity
          style={styles.inviteSoloBtn}
          onPress={() => {
            trackEvent('invite_item_tap', { itemId: item?.id, listId })
            setShowInviteChannels(true)
          }}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Invite someone"
        >
          <Text style={styles.inviteSoloBtnText}>Invite someone</Text>
        </TouchableOpacity>
      </View>

      {/* On-demand channel chooser (Goal 4) — the existing channel-
          specific tiles + native "More" share, and the message preview,
          all reused byte-for-byte from before this pass, just moved from
          permanently inline into this Modal, reached only via "Invite
          someone" above. The channel-preference "Edit" control (the old
          always-visible button's real purpose) is reachable from inside
          here instead of inline on the page. */}
      <Modal
        visible={showInviteChannels}
        transparent
        animationType="fade"
        onRequestClose={() => setShowInviteChannels(false)}
      >
        <View style={styles.inviteChannelOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            activeOpacity={1}
            onPress={() => setShowInviteChannels(false)}
          />
          <View style={styles.inviteChannelSheet}>
            <View style={styles.inviteHeaderRow}>
              <Text style={styles.inviteChannelTitle}>Invite via</Text>
              <TouchableOpacity
                style={styles.editChannelsBtn}
                onPress={() => {
                  setShowInviteChannels(false)
                  openChannelPicker()
                }}
                accessibilityRole="button"
                accessibilityLabel="Edit invitation message channels"
              >
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
                    onPress={() => {
                      trackEvent('invite_item_tap', { itemId: item?.id, listId })
                      shareVia(key)
                      setShowInviteChannels(false)
                    }}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel={`Invite via ${ch.label}`}
                  >
                    <Text style={[styles.channelBtnText, { color: ch.textColor ?? '#fff' }]}>
                      {ch.label}
                    </Text>
                  </TouchableOpacity>
                )
              })}

              <TouchableOpacity
                style={styles.moreBtn}
                onPress={() => {
                  trackEvent('invite_item_tap', { itemId: item?.id, listId })
                  openNativeShare()
                  setShowInviteChannels(false)
                }}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="More sharing options"
              >
                <Text style={styles.moreBtnText}>More ···</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.inviteChannelCancel}
              onPress={() => setShowInviteChannels(false)}
            >
              <Text style={styles.inviteChannelCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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

  // Item Detail Corrective Pass (2026-09-18/19) — Goal 1: ONE combined
  // editorial hero card (artwork + overlaid content), replacing the prior
  // separate full-bleed heroWrap (260dp) + separate itemCard (padding +
  // tagRow + 2-3-line title + location, ~140-160dp more) — ~400-420dp
  // combined before this pass. aspectRatio 8:5 (1.6) sizes the hero from
  // the available width (roughly 350dp at typical phone content width ->
  // ~219dp tall); maxHeight is now driven per-render from
  // titlePresentation.heroHeightHint (lib/detailTitlePresentation.js) —
  // 240/280dp for short/medium titles, up to the firm
  // HERO_MAX_HEIGHT_DP cap (420dp) for long/extreme titles — this literal
  // 240 is only the style's own fallback default. The 2026-09-19 pass
  // removed the prior below-hero "continuation" escape hatch entirely: a
  // long title now always grows the hero itself (bounded by that same firm
  // cap) rather than spilling a second text block underneath it.
  // Deliberately no borderWidth — "no heavy border around the hero" per
  // the approved visual language, unchanged from the prior pass. Radius 24
  // matches this app's own established primary-card convention (see
  // components/home/WhatsTheThingHero.jsx's imageCard: borderRadius 24).
  heroCard: {
    width: '100%',
    aspectRatio: 8 / 5,
    maxHeight: 240,
    borderRadius: 24,
    marginBottom: 16,
    overflow: 'hidden',
    backgroundColor: NAVY,
  },

  // Content sits on the left ~72% of the hero (within the task's 68-74%
  // band), overlaid on the localized left-to-right scrim added in the
  // render (not inside DetailArtwork/ArchetypeArtwork — see the render's
  // own comment on why). Anchored toward the bottom of the hero
  // (justifyContent: flex-end) so it reads as a caption block over the
  // art, same convention as WhatsTheThingHero's own on-image text layer.
  heroContent: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: 18,
    maxWidth: '72%',
  },

  heroPillRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
    marginBottom: 8,
  },

  heroPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },

  heroPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },

  // Title readability rule (Goal 2) — fontSize/lineHeight are now
  // overridden per-render from titlePresentation.heroFontSize/
  // heroLineHeight (lib/detailTitlePresentation.js); this style only owns
  // the weight/color/spacing that don't vary by tier — same editorial-
  // headline treatment as before this pass, just no longer a single fixed
  // size for every title length.
  heroTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#fff',
    lineHeight: 27,
    marginBottom: 4,
  },

  heroVenue: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.85)',
    marginBottom: 6,
  },

  heroMetaRow: {
    flexDirection: 'row',
    gap: 6,
  },

  heroMetaText: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.75)',
  },

  // "Read full thing" action (Item Detail Corrective Pass, 2026-09-19) —
  // the extreme tier's only escape hatch, INSIDE the hero itself (never a
  // second text block below it, replacing the prior pass's now-removed
  // below-hero continuation styles). Deliberately visually secondary
  // (small, muted-amber, low-emphasis) — the title itself stays the
  // dominant element even in this rare tier.
  heroReadFullBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 3,
    marginBottom: 6,
  },

  heroReadFullBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: AMBER,
    textDecorationLine: 'underline',
  },

  // Full-body modal (Item Detail Corrective Pass, 2026-09-19) — same
  // overlay/sheet/handle convention as the "Invite via" sheet just below
  // (inviteChannelOverlay/inviteChannelSheet) and components/
  // PostCheckoffSheet.jsx's own sheet, rather than a new modal pattern.
  fullBodyOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },

  fullBodySheet: {
    backgroundColor: CARD,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 4,
    paddingHorizontal: 24,
    paddingBottom: 36,
    maxHeight: '75%',
  },

  handleWrap: {
    paddingVertical: 12,
    alignItems: 'center',
  },

  handle: {
    width: 64,
    height: 6,
    borderRadius: 3,
    backgroundColor: BORDER,
  },

  // The complete, untruncated body, rendered verbatim — never re-truncated
  // or paraphrased. accessibilityRole="header" gives assistive tech a
  // sensible entry point into the sheet's content.
  fullBodyText: {
    fontSize: 17,
    fontWeight: '700',
    color: TEXT,
    lineHeight: 24,
    paddingBottom: 12,
  },

  fullBodyCloseBtn: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 4,
  },

  fullBodyCloseBtnText: {
    fontSize: 15,
    color: MUTED,
    fontWeight: '700',
  },

  // Contribution CTA now lives in the TOP area (see the render above) —
  // this wrapper gives it the same intentional spacing the old
  // below-the-card block had.
  topContributionWrap: {
    marginBottom: 16,
  },
  coverContributionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: MUTED,
    marginBottom: 4,
  },

  // Item Detail Corrective Pass (2026-09-18) — Goal 2 addendum: Done/
  // DONE ✓ and Photo Check-in are PRIMARY actions, side by side in one
  // shared row/container across both list and Nearby mode (Goal 6 — same
  // structure, only the Done button's handler differs by mode). flex:1 +
  // minWidth reuses this screen's own existing flexWrap+minWidth
  // responsive pattern (already established for utilityBtn below) so the
  // two buttons sit at ~50% width each on ordinary phone widths and stack
  // (in the same order) only when a narrow width or large Dynamic Type
  // makes that necessary — never a fixed pixel width that would just clip
  // instead of reflowing.
  primaryActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 8,
  },

  primaryDoneBtn: {
    flex: 1,
    minWidth: 150,
    backgroundColor: AMBER,
    borderRadius: 24,
    paddingVertical: 20,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: AMBER,
  },

  primaryDoneBtnChecked: {
    backgroundColor: GREEN,
    borderColor: GREEN,
  },

  primaryDoneBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: NAVY,
    textAlign: 'center',
  },

  primaryDoneBtnTextChecked: {
    color: '#fff',
  },

  // Photo Check-in keeps the stronger outline per the approved visual
  // language (warm-cream in dark mode / deep-navy in light mode — BORDER
  // is already themed to exactly that in lib/ThemeContext.js), now sized
  // to match primaryDoneBtn's own footprint since they're side by side.
  primaryPhotoBtn: {
    flex: 1,
    minWidth: 150,
    backgroundColor: SOFT,
    borderRadius: 24,
    paddingVertical: 20,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: BORDER,
  },

  primaryPhotoBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: TEXT,
    textAlign: 'center',
  },

  // Item Detail Corrective Pass (2026-09-18) — Goal 3 fix: Directions/
  // Website/Save only (Photo Check-in lives in primaryActionRow above;
  // "Add to list"/"On your list" removed). Every VISIBLE control gets
  // `flex: 1` (see utilityBtn below) inside this plain
  // `flexDirection: 'row'` container, with only the actually-present
  // controls rendered (no placeholder/spacer elements) — flex:1 on
  // however many siblings exist naturally fills the row proportionally,
  // whether that's three controls, two, or Save alone. flexWrap is kept
  // (mirroring primaryActionRow's own established flex:1 + minWidth +
  // flexWrap pattern above) purely as a Dynamic-Type safety valve — at
  // ordinary text sizes these always fit on one row; only very large
  // Dynamic Type stacks them, still in the same Directions -> Website ->
  // Save order since that's just JSX order, never index-based.
  utilityRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    marginBottom: 20,
  },

  // flex:1 + minWidth is what replaces the prior marginLeft-auto fix —
  // every present control (Directions/Website/Save) gets this exact same
  // style, so none of them ever looks different depending on how many of
  // its siblings are present. Save is the trailing/rightmost control
  // purely because it's written last in the JSX above, never because of
  // any index/hasLoc/hasWeb-based positioning rule here.
  utilityBtn: {
    flex: 1,
    minWidth: 100,
    backgroundColor: SOFT,
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 14,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.2,
    borderColor: BORDER,
  },

  utilityBtnIcon: {
    fontSize: 20,
    color: BLUE,
  },

  utilityBtnText: {
    fontSize: 13,
    color: TEXT,
    fontWeight: '800',
    textAlign: 'center',
  },

  // Item Detail Corrective Pass (2026-09-18) — Goal 4: the compact
  // "DO THIS TOGETHER" card itself. No permanent message preview, no
  // permanent Edit button, no permanent channel grid — those all moved
  // into inviteChannelSheet below, reached only via inviteSoloBtn.
  // Item Detail Corrective Pass (2026-09-18) — Goal 6: modest vertical-
  // density tightening (padding 18->16, inviteTitle's bottom margin 6->4,
  // inviteAsk's bottom margin 14->10). Card structure/copy/single-action
  // shape are unchanged — inviteSoloBtn below still keeps its full
  // paddingVertical: 16 (~50pt tall with its text), comfortably above the
  // ~44pt touch-target floor.
  inviteCard: {
    backgroundColor: CARD,
    borderRadius: 28,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1.2,
    borderColor: BORDER,
  },

  inviteTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: TEXT,
    marginBottom: 4,
  },

  inviteAsk: {
    fontSize: 14,
    color: MUTED,
    lineHeight: 20,
    marginBottom: 10,
  },

  // Reused inside inviteChannelSheet (below) for its own title + "Edit"
  // row — same row shape the old always-visible card header used.
  inviteHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    gap: 12,
  },

  inviteChannelTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: TEXT,
  },

  inviteChannelOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
    zIndex: 100,
  },

  inviteChannelSheet: {
    backgroundColor: CARD,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },

  inviteChannelCancel: { alignItems: 'center', paddingVertical: 14, marginTop: 4 },
  inviteChannelCancelText: { fontSize: 15, color: MUTED, fontWeight: '600' },

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

  // Item Detail Redesign (2026-09-18) — the single "Invite someone"
  // primary action on the refined "DO THIS TOGETHER" card (replaces the
  // old giant Dare-a-Friend tile and the old separate, larger invite
  // section — this is the one card both were superseded by). The existing
  // channel-specific row + native "More" share below remain as secondary,
  // preserving the existing sharing mechanism unchanged.
  inviteSoloBtn: {
    backgroundColor: AMBER,
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 14,
  },

  inviteSoloBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: NAVY,
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