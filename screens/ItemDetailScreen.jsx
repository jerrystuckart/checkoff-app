import React, { useState, useMemo, useEffect, useCallback } from 'react'
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
import * as Location from 'expo-location'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect } from '@react-navigation/native'
import { supabase } from '../lib/supabase'
import { completeDare } from '../lib/completeDare'
import { notifyCrewCheckIn } from '../lib/notifyCrewCheckIn'
import { updateUserLifetimePoints } from '../lib/points'
import { useTheme } from '../lib/ThemeContext'

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
  // Deferred flag: fire triggerPostCheckinDiscover after memory modal closes (Fix 5)
  const [pendingDiscover, setPendingDiscover] = useState(false)

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

  // Fire discover navigation after memory modal is dismissed (Fix 5)
  useEffect(() => {
    if (!memoryModal && pendingDiscover) {
      setPendingDiscover(false)
      triggerPostCheckinDiscover()
    }
  }, [memoryModal, pendingDiscover])

  useFocusEffect(
    useCallback(() => {
      if (userId) {
        loadCheckedState()
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

      // Fetch invite code for the current list so share message includes the join link
      if (listId) {
        supabase
          .from('lists')
          .select('invite_code')
          .eq('id', listId)
          .single()
          .then(({ data: listData }) => {
            if (listData?.invite_code) setListInviteCode(listData.invite_code)
          })
      }

      // In Nearby mode, load user's active lists for the "Add to list" picker
      if (!listId) {
        const { data: members } = await supabase
          .from('list_members')
          .select('lists(id, title, ends_at, is_official)')
          .eq('user_id', uid)

        const lists = (members ?? [])
          .map(m => m.lists)
          .filter(Boolean)
          .filter(l => {
            if (l.is_official) return false
            if (!l.ends_at) return true
            return new Date(l.ends_at) >= new Date()
          })
          .sort((a, b) => a.title.localeCompare(b.title))

        setUserLists(lists)

        // Check which of user's lists already have this item
        const listIds = lists.map(l => l.id)
        if (listIds.length && item?.id) {
          const { data: existing } = await supabase
            .from('list_items')
            .select('id, list_id')
            .eq('item_id', item.id)
            .in('list_id', listIds)

          if (existing?.length) {
            // Build map of listId → listItemId for greying out in picker
            const map = {}
            existing.forEach(li => { map[li.list_id] = li.id })
            setItemOnListIds(map)
            // Set first match as the listItemId for "I've done this" button
            setItemOnListId(existing[0].id)
          }
        }
      }
    }
  }

  async function loadCheckedState(passedUid = null) {
    let uid = passedUid ?? userId
    if (!uid) {
      const { data: authData } = await supabase.auth.getUser()
      uid = authData?.user?.id ?? null
    }
    if (!uid || !item) return

    try {
      let listItemId = item?.listItemId

      if (!listItemId && item?.id) {
        listItemId = await getOrCreateListItemId(item.id, uid)
      }

      if (!listItemId) {
        setChecked(false)
        return
      }

      const { data, error } = await supabase
        .from('check_ins')
        .select('id')
        .eq('user_id', uid)
        .eq('list_item_id', listItemId)
        .limit(1)

      if (error) throw error

      setChecked(!!data?.length)
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

  function haversineMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000
    const toRad = d => (d * Math.PI) / 180
    const dLat = toRad(lat2 - lat1)
    const dLng = toRad(lng2 - lng1)
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  }

  async function triggerPostCheckinDiscover() {
    const itemLat = item?.maps_lat ?? item?.mapsLat ?? null
    const itemLng = item?.maps_lng ?? item?.mapsLng ?? null

    console.log('[postCheckin] item location:', itemLat, itemLng)

    if (!itemLat || !itemLng || !item?.id) {
      console.log('[postCheckin] skip: no coordinates for item', item?.id)
      return
    }

    // Distance gate: only navigate if user is within 3200m of the item
    let userLat = null
    let userLng = null
    try {
      const pos = await Location.getLastKnownPositionAsync({})
      userLat = pos?.coords?.latitude ?? null
      userLng = pos?.coords?.longitude ?? null
    } catch {
      // ignore — treated as unavailable below
    }

    console.log('[postCheckin] user location:', userLat, userLng)

    if (!userLat || !userLng) {
      console.log('[postCheckin] skip: user location unavailable')
      return
    }

    const distM = haversineMeters(userLat, userLng, itemLat, itemLng)
    const withinRange = distM <= 3200
    console.log('[postCheckin] distance to item:', Math.round(distM), 'm')
    console.log('[postCheckin] within range:', withinRange)

    if (!withinRange) {
      console.log('[postCheckin] skip: user not near item (dist:', Math.round(distM) + 'm)')
      return
    }

    supabase
      .from('item_tags')
      .select('tag_id, tags!inner(name)')
      .eq('item_id', item.id)
      .limit(10)
      .then(({ data, error }) => {
        if (error) {
          console.log('[postCheckin] tags fetch failed:', error.message)
        }
        const checkinTags = (data ?? []).map(r => r.tags?.name).filter(Boolean)
        console.log('[postCheckin] tags:', checkinTags)
        console.log('[postCheckin] fired for item:', item.id)
        navigation.navigate('NearbyTab', {
          screen: 'Nearby',
          params: { mode: 'post_checkin', checkinLat: itemLat, checkinLng: itemLng, checkinItemId: item.id, checkinTags },
        })
      })
      .catch(e => {
        console.log('[postCheckin] skip: exception', e?.message)
      })
  }

  async function handleCheckOff() {
    if (!userId) {
      Alert.alert('Sign in first', 'You need an account to check off items.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign in', onPress: () => navigation.navigate('SignIn') },
      ])
      return
    }

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setSaving(true)

    try {
      let listItemId = item?.listItemId

      if (!listItemId) {
        listItemId = await getOrCreateListItemId(item?.id, userId)
      }

      if (!listItemId) {
        Alert.alert('Join a list first', 'Go to Home and join a seasonal list to start checking off items.')
        return
      }

      if (checked) {
        const { error } = await supabase
          .from('check_ins')
          .delete()
          .eq('user_id', userId)
          .eq('list_item_id', listItemId)

        if (error) throw error
        setChecked(false)
      } else {
        const { error } = await supabase
          .from('check_ins')
          .insert({
            user_id: userId,
            list_item_id: listItemId,
            checkin_method: 'tap',
          })

        if (error) {
          if (error.code === '23505') {
            setChecked(true)
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

        setChecked(true)
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        supabase.functions.invoke('update-streak', {
          body: { user_id: userId },
        }).catch(() => {/* non-critical */})
        updateUserLifetimePoints(userId).catch(() => {})
        if (item?.id) completeDare(userId, item.id).catch(() => {})

        const difficulty = item?.difficulty ?? 0
        if (item?.allowsPersonalNote) {
          setMemoryPlace('')
          setMemoryNote('')
          setMemoryError(null)
          setMemoryModal({
            listItemId: listItemId,
            placeLabel:  item.personalPlaceLabel  ?? 'Place or location',
            noteLabel:   item.personalPromptLabel ?? 'Any notes?',
            itemBody:    item.body ?? '',
            difficulty,
          })
          // Defer discover until modal is dismissed (Fix 5)
          setPendingDiscover(true)
        } else {
          if (difficulty >= 5) {
            notifyCrewCheckIn({ listItemId, itemBody: item?.body ?? '', difficulty, checkInId: null }).catch(() => {})
          }
          triggerPostCheckinDiscover()
        }
      }
    } catch (e) {
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

    if (!itemOnListId) {
      // Item not on any list — prompt to add
      if (userLists.length === 0) {
        Alert.alert(
          'No lists yet',
          'Create a list first to start tracking your check-offs.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Create a list', onPress: () => navigation.navigate('CreateList') },
          ]
        )
      } else {
        setShowListPicker(true)
      }
      return
    }

    // Item is on a list — check it off there
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setSaving(true)
    try {
      if (checked) {
        const { error } = await supabase
          .from('check_ins')
          .delete()
          .eq('user_id', userId)
          .eq('list_item_id', itemOnListId)
        if (error) throw error
        setChecked(false)
      } else {
        const { error } = await supabase
          .from('check_ins')
          .insert({ user_id: userId, list_item_id: itemOnListId, checkin_method: 'tap' })
        if (error && error.code !== '23505') throw error
        setChecked(true)
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        supabase.functions.invoke('update-streak', {
          body: { user_id: userId },
        }).catch(() => {/* non-critical */})
        updateUserLifetimePoints(userId).catch(() => {})
        if (item?.id) completeDare(userId, item.id).catch(() => {})

        const difficulty = item?.difficulty ?? 0
        if (item?.allowsPersonalNote) {
          setMemoryPlace('')
          setMemoryNote('')
          setMemoryError(null)
          setMemoryModal({
            listItemId: itemOnListId,
            placeLabel:  item.personalPlaceLabel  ?? 'Place or location',
            noteLabel:   item.personalPromptLabel ?? 'Any notes?',
            itemBody:    item.body ?? '',
            difficulty,
          })
          setPendingDiscover(true)
        } else {
          if (difficulty >= 5) {
            notifyCrewCheckIn({ listItemId: itemOnListId, itemBody: item?.body ?? '', difficulty, checkInId: null }).catch(() => {})
          }
          triggerPostCheckinDiscover()
        }
      }
    } catch (e) {
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
    if (item?.website_url) Linking.openURL(item.website_url).catch(() => {})
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
      const { data: updatedCI, error } = await supabase
        .from('check_ins')
        .update({ personal_place: place || null, personal_note: note || null })
        .eq('user_id', userId)
        .eq('list_item_id', memoryModal.listItemId)
        .select('id')
        .single()
      if (error) throw error
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

      {userId && listId && (
        <View style={styles.quickRow}>
          <TouchableOpacity
            style={styles.quickBtn}
            onPress={() => navigation.navigate('Dare', { item, listId })}
          >
            <Text style={styles.quickBtnIcon}>😈</Text>
            <Text style={styles.quickBtnText}>Dare a friend</Text>
            <Text style={styles.quickBtnSub}>Make it more fun</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickBtn}
            onPress={async () => {
              let listItemId = item?.listItemId

              if (!listItemId) {
                listItemId = await getOrCreateListItemId(item?.id, userId)
              }

              if (!listItemId) {
                Alert.alert('Join a list first', 'Go to Home and join a seasonal list to start checking off items.')
                return
              }

              navigation.navigate('PhotoCheckIn', {
                item: { ...item, is_secret: item.is_secret ?? item.isSecret ?? false },
                listItemId,
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