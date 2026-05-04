import React, { useState, useEffect, useRef } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, ActivityIndicator, FlatList, Share, Linking, Platform,
} from 'react-native'
import Clipboard from '@react-native-clipboard/clipboard'
import DateTimePicker from '@react-native-community/datetimepicker'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Location from 'expo-location'
import { supabase } from '../lib/supabase'
import { fetchCuratedListItems } from '../lib/useItems'

const AMBER = '#F5A623'
const NAVY  = '#1A1A2E'
const GREEN = '#1D9E75'

const BG = '#FFF9F2'
const CARD = '#FFFFFF'
const TEXT = '#243045'
const MUTED = '#6F7785'
const BORDER = '#E6D8C7'
const SOFT_2 = '#F8F3EC'
const SUCCESS_BG = '#EAF8F2'
const SUCCESS_BORDER = '#BFE7D7'
const RED = '#D85A30'

export default function CreateListScreen({ navigation, route }) {
  const insets = useSafeAreaInsets()

  // Legacy adoption mode: list already exists in the DB before arriving here.
  // Kept for backward compatibility; new curated flow uses curatedListId instead.
  const {
    adoptedListId  = null,
    adoptedTitle   = '',
    adoptedItemIds = [],
    // Curated template mode — list is NOT yet in the DB. User sets name + date
    // on Step 1, customises items on Step 2, then we create everything on save.
    curatedListId  = null,
    defaultTitle   = '',
    groupEmoji     = null,
    curatedCityId  = null,
    curatedMetroId = null,
  } = route?.params ?? {}

  const isCuratedMode  = !!curatedListId
  const isAdoptionMode = !!adoptedListId

  // Template item IDs — populated async; stored in ref so loadItems can read
  // the latest value without the closure going stale.
  const templateItemIdsRef = useRef(new Set())

  const [step, setStep]   = useState(isAdoptionMode ? 2 : 1)
  const [title, setTitle] = useState(isCuratedMode ? defaultTitle : adoptedTitle)
  const [endsAt, setEndsAt] = useState('')
  const [metros, setMetros] = useState([])
  const [metroId, setMetroId] = useState(null)
  const [items, setItems] = useState([])
  const [selected, setSelected] = useState(
    adoptedItemIds.length > 0 ? new Set(adoptedItemIds) : new Set()
  )
  const [filterCat, setFilterCat] = useState('All')
  const [categories, setCategories] = useState([])
  const [saving, setSaving] = useState(false)
  const [createdList, setCreatedList] = useState(null)
  const [searchText, setSearchText] = useState('')
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)

  // Auth gate: check immediately on mount before user does any work.
  // If not signed in, prompt and redirect to SignIn rather than letting
  // them build a list and hit a wall at save.
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data?.user) {
        Alert.alert(
          'Sign in first',
          'Create an account or sign in to build your list, invite your crew, and track progress.',
          [
            {
              text: 'Sign in',
              onPress: () => navigation.replace('SignIn'),
            },
            {
              text: 'Cancel',
              style: 'cancel',
              onPress: () => navigation.goBack(),
            },
          ]
        )
      } else {
        setAuthChecked(true)
      }
    })
  }, [])

  useEffect(() => {
    loadMetrosAndCategories()
  }, [])

  // Sync selected items when arriving in legacy adoption mode.
  useEffect(() => {
    if (adoptedItemIds?.length > 0) {
      setSelected(new Set(adoptedItemIds))
      setStep(2)
      setTitle(adoptedTitle)
    }
  }, [adoptedListId])

  // Curated mode: fetch all template item IDs and pre-select them.
  // Runs once on mount; loadItems may race but won't clear our selection
  // because we guard the clear with !isCuratedMode below.
  useEffect(() => {
    if (!curatedListId) return
    fetchCuratedListItems(curatedListId).then(({ data }) => {
      const ids = new Set((data ?? []).map(li => li.items?.id).filter(Boolean))
      templateItemIdsRef.current = ids
      setSelected(new Set(ids))
    })
  }, [curatedListId])

  useEffect(() => {
    const unsubscribe = navigation.addListener('blur', () => {
      if (createdList) {
        resetForm()
      }
    })
    return unsubscribe
  }, [navigation, createdList])

  function resetForm() {
    setStep(isAdoptionMode ? 2 : 1)
    setTitle(isAdoptionMode ? adoptedTitle : '')
    setEndsAt('')
    setSelected(adoptedItemIds.length > 0 ? new Set(adoptedItemIds) : new Set())
    setFilterCat('All')
    setSaving(false)
    setCreatedList(null)
    setSearchText('')
    setShowDatePicker(false)
  }

  // Use local date — toISOString() returns UTC which can be the wrong
  // calendar day for users in negative-offset timezones late at night.
  function localDateString(d = new Date()) {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  function todayString() {
    return localDateString()
  }

  function formatDateForInput(date) {
    return localDateString(date)
  }

  function formatDatePretty(value) {
    if (!value) return 'No end date'
    const d = new Date(`${value}T12:00:00`)
    if (Number.isNaN(d.getTime())) return value
    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  function getTomorrowDate() {
    const d = new Date()
    d.setHours(12, 0, 0, 0)
    d.setDate(d.getDate() + 1)
    return d
  }

  function isValidDateFormat(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
    const d = new Date(`${value}T12:00:00`)
    if (Number.isNaN(d.getTime())) return false
    return formatDateForInput(d) === value
  }

  function validateEndDate(value) {
    if (!value?.trim()) return { ok: true }

    if (!isValidDateFormat(value)) {
      return { ok: false, message: 'End date must be a real date.' }
    }

    const selectedDate = new Date(`${value}T12:00:00`)
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const selectedOnly = new Date(selectedDate)
    selectedOnly.setHours(0, 0, 0, 0)

    if (selectedOnly <= today) {
      return { ok: false, message: 'Please choose a future date. Today or past dates are not allowed.' }
    }

    return { ok: true }
  }

  function maybeAdvanceToStep2() {
    if (!title.trim()) {
      Alert.alert('Give your list a name')
      return
    }

    const validation = validateEndDate(endsAt)
    if (!validation.ok) {
      Alert.alert('Invalid end date', validation.message)
      return
    }

    setStep(2)
  }

  async function loadMetrosAndCategories() {
    const [{ data: metroData }, { data: catData }] = await Promise.all([
      supabase.from('metro_areas').select('id, name, state').eq('is_active', true).order('name'),
      supabase.from('categories').select('id, name, color_hex').order('name'),
    ])

    setMetros(metroData ?? [])
    setCategories(catData ?? [])

    // Detect the user's metro from GPS so Milwaukee users see Milwaukee items
    // and Phoenix users see Phoenix items by default. Falls back to first metro
    // if location permission is denied or unavailable.
    let detectedMetro = null
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status === 'granted') {
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        })
        const { latitude, longitude } = pos.coords

        // Approximate center coordinates for each metro
        const METRO_CENTERS = {
          'Phoenix':   [33.4484, -112.0740],
          'Milwaukee': [43.0389, -87.9065],
        }

        let closestMetro = null
        let closestDist  = Infinity

        for (const metro of (metroData ?? [])) {
          const key = Object.keys(METRO_CENTERS).find(k => metro.name.includes(k))
          if (!key) continue
          const [mlat, mlng] = METRO_CENTERS[key]
          const dist = Math.sqrt((latitude - mlat) ** 2 + (longitude - mlng) ** 2)
          if (dist < closestDist) {
            closestDist  = dist
            closestMetro = metro
          }
        }
        detectedMetro = closestMetro
      }
    } catch (e) {
      // Location unavailable — fall through to first metro
    }

    // Use detected metro, or fall back to first available
    const defaultMetro = detectedMetro ?? (metroData ?? [])[0]
    if (defaultMetro) {
      setMetroId(defaultMetro.id)
      await loadItems(defaultMetro.id)
    }
  }

  async function loadItems(mId) {
    if (!mId) return

    const { data: hoodData, error: hoodErr } = await supabase
      .from('neighborhoods')
      .select('id')
      .eq('metro_id', mId)
      .eq('is_active', true)

    if (hoodErr) {
      Alert.alert('Error loading neighborhoods', hoodErr.message)
      return
    }

    const hoodIds = (hoodData ?? []).map(h => h.id)

    const { data: universalItems, error: univErr } = await supabase
      .from('items')
      .select('id, body, is_universal, ring_weight, neighborhood_id, category_id, categories(name, color_hex), neighborhoods!items_neighborhood_id_fkey(name)')
      .eq('is_active', true)
      .eq('is_approved', true)
      .eq('is_universal', true)
      .order('body')

    if (univErr) {
      Alert.alert('Error loading items', univErr.message)
      return
    }

    let hoodItems = []
    if (hoodIds.length > 0) {
      const { data: hd, error: hdErr } = await supabase
        .from('items')
        .select('id, body, is_universal, ring_weight, neighborhood_id, category_id, categories(name, color_hex), neighborhoods!items_neighborhood_id_fkey(name)')
        .eq('is_active', true)
        .eq('is_approved', true)
        .eq('is_universal', false)
        .in('neighborhood_id', hoodIds)
        .order('body')

      if (hdErr) {
        Alert.alert('Error loading local items', hdErr.message)
        return
      }
      hoodItems = hd ?? []
    }

    const seen = new Set()
    const combined = [...(universalItems ?? []), ...hoodItems]
      .filter(i => {
        if (seen.has(i.id)) return false
        seen.add(i.id)
        return true
      })
      .sort((a, b) => a.body.localeCompare(b.body))

    setItems(combined)
    if (isCuratedMode) {
      // Re-apply template selection so a metro switch doesn't wipe pre-selected items
      if (templateItemIdsRef.current.size > 0) {
        setSelected(new Set(templateItemIdsRef.current))
      }
      // else: template fetch hasn't finished yet — it will call setSelected itself
    } else if (!adoptedListId) {
      setSelected(new Set())
    }
  }

  function toggleItem(id) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function selectAll() {
    const visible = filteredItems()
    setSelected(prev => {
      const next = new Set(prev)
      visible.forEach(i => next.add(i.id))
      return next
    })
  }

  function clearAll() {
    setSelected(new Set())
  }

  function filteredItems() {
    return items.filter(i => {
      if (filterCat !== 'All' && i.categories?.name !== filterCat) return false
      if (searchText && !i.body.toLowerCase().includes(searchText.toLowerCase())) return false
      return true
    })
  }

  function handleDateChange(_event, pickedDate) {
    if (!pickedDate) {
      if (Platform.OS !== 'ios') setShowDatePicker(false)
      return
    }

    const normalized = new Date(pickedDate)
    normalized.setHours(12, 0, 0, 0)

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const selectedOnly = new Date(normalized)
    selectedOnly.setHours(0, 0, 0, 0)

    if (selectedOnly <= today) {
      Alert.alert('Invalid end date', 'Please choose a future date. Today or past dates are not allowed.')
      if (Platform.OS !== 'ios') setShowDatePicker(false)
      return
    }

    setEndsAt(formatDateForInput(normalized))

    if (Platform.OS !== 'ios') {
      setShowDatePicker(false)
    }
  }

  async function createList() {
    if (!title.trim()) {
      Alert.alert('Give your list a name')
      return
    }

    const validation = validateEndDate(endsAt)
    if (!validation.ok) {
      Alert.alert('Invalid end date', validation.message)
      return
    }

    if (selected.size === 0) {
      Alert.alert('Pick at least one item')
      return
    }

    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      Alert.alert('Sign in first')
      setSaving(false)
      return
    }

    // ── CURATED MODE: create a new list from a template ──────
    if (isCuratedMode) {
      const inviteCode = Math.random().toString(36).slice(2, 9).toUpperCase()
      const { data: list, error: listErr } = await supabase
        .from('lists')
        .insert({
          creator_id:  user.id,
          title:       title.trim(),
          city_id:     curatedCityId  ?? null,
          metro_id:    curatedMetroId ?? null,
          starts_at:   todayString(),
          ends_at:     endsAt || null,
          is_public:   false,
          is_official: false,
          cover_emoji: groupEmoji ?? '📋',
          invite_code: inviteCode,
        })
        .select('id, title, invite_code')
        .single()

      if (listErr) {
        Alert.alert('Error creating list', listErr.message)
        setSaving(false)
        return
      }

      const listItemRows = [...selected].map((itemId, i) => ({
        list_id:    list.id,
        item_id:    itemId,
        sort_order: i,
      }))

      if (listItemRows.length) {
        const { error: liErr } = await supabase.from('list_items').insert(listItemRows)
        if (liErr) {
          Alert.alert('Error adding items', liErr.message)
          setSaving(false)
          return
        }
      }

      setSaving(false)
      setCreatedList(list)
      setStep(3)
      return
    }

    // ── ADOPTION MODE: list already exists, update it ────────
    if (isAdoptionMode) {
      // 1. Update the list title and end date
      const { error: updateErr } = await supabase
        .from('lists')
        .update({
          title: title.trim(),
          ends_at: endsAt || null,
          starts_at: todayString(),
        })
        .eq('id', adoptedListId)
        .eq('creator_id', user.id)

      if (updateErr) {
        Alert.alert('Error updating list', updateErr.message)
        setSaving(false)
        return
      }

      // 2. Delete all existing list_items for this list and replace with selected
      const { error: deleteErr } = await supabase
        .from('list_items')
        .delete()
        .eq('list_id', adoptedListId)

      if (deleteErr) {
        Alert.alert('Error updating items', deleteErr.message)
        setSaving(false)
        return
      }

      const listItemRows = [...selected].map((itemId, i) => ({
        list_id: adoptedListId,
        item_id: itemId,
        sort_order: i,
      }))

      const { error: liErr } = await supabase
        .from('list_items')
        .insert(listItemRows)

      setSaving(false)

      if (liErr) {
        Alert.alert('Error saving items', liErr.message)
        return
      }

      // Fetch the updated list to use in Step 3 share screen
      const { data: updatedList } = await supabase
        .from('lists')
        .select('id, title, invite_code')
        .eq('id', adoptedListId)
        .single()

      setCreatedList(updatedList)
      setStep(3)
      return
    }

    // ── NORMAL MODE: create a new list ───────────────────────
    const inviteCode = Math.random().toString(36).slice(2, 9).toUpperCase()
    const { data: list, error: listErr } = await supabase
      .from('lists')
      .insert({
        creator_id: user.id,
        title: title.trim(),
        starts_at: todayString(),
        ends_at: endsAt || null,
        is_public: true,
        invite_code: inviteCode,
      })
      .select()
      .single()

    if (listErr) {
      Alert.alert('Error creating list', listErr.message)
      setSaving(false)
      return
    }

    const listItemRows = [...selected].map((itemId, i) => ({
      list_id: list.id,
      item_id: itemId,
      sort_order: i,
    }))

    const { error: liErr } = await supabase
      .from('list_items')
      .insert(listItemRows)

    setSaving(false)

    if (liErr) {
      Alert.alert('Error adding items', liErr.message)
      return
    }

    setCreatedList(list)
    setStep(3)
  }

  function inviteMessage() {
    const link = `https://getcheckoff.com/join/${createdList?.invite_code}`
    return `Hey! Join my CheckOff list "${createdList?.title}" — ${selected.size} things to check off together. Download the app and join here: ${link}`
  }

  async function sendSMS() {
    const encoded = encodeURIComponent(inviteMessage())
    const url = `sms:?body=${encoded}`
    const ok = await Linking.canOpenURL(url)
    Linking.openURL(ok ? url : `sms:`)
  }

  async function openNativeShare() {
    try {
      await Share.share({ message: inviteMessage(), title: createdList?.title })
    } catch (e) {
      /* user cancelled */
    }
  }

  async function shareViaSnapchat() {
    Clipboard.setString(inviteMessage())
    const ok = await Linking.canOpenURL('snapchat://')
    if (ok) {
      Alert.alert(
        'Copied to clipboard',
        'Message copied — open a Snap chat and paste it',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Snapchat', onPress: () => Linking.openURL('snapchat://') },
        ]
      )
    } else {
      Alert.alert('Snapchat not installed', 'Install Snapchat to share this way.')
    }
  }

  async function shareViaInstagram() {
    Clipboard.setString(inviteMessage())
    const ok = await Linking.canOpenURL('instagram://direct-inbox')
    if (ok) {
      Alert.alert(
        'Copied to clipboard',
        'Message copied — paste it into your Instagram DM',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Instagram', onPress: () => Linking.openURL('instagram://direct-inbox') },
        ]
      )
    } else {
      Linking.openURL('https://www.instagram.com/direct/inbox/')
    }
  }

  // Don't render anything until auth check resolves — prevents flash of
  // create UI before the sign-in alert fires for unauthenticated users
  if (!authChecked && !isAdoptionMode) return null

  if (step === 1) {
    const dateValidation = validateEndDate(endsAt)
    const pickerDate = endsAt ? new Date(`${endsAt}T12:00:00`) : getTomorrowDate()

    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroCard}>
          <Text style={styles.stepLabel}>Step 1 of 2</Text>
          <Text style={styles.heading}>
            {isCuratedMode ? 'Name your list' : 'Create your list'}
          </Text>
          <Text style={styles.heroSub}>
            {isCuratedMode
              ? 'Your template items are ready to go. Edit the name, pick an end date, and we\'ll pre-fill everything.'
              : 'Give it a name, choose a city, and set an optional future end date.'}
          </Text>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.fieldLabel}>Title</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Peoria Summer Challenge"
            placeholderTextColor="#98A2B3"
            autoFocus
            returnKeyType="next"
          />

          <Text style={styles.fieldLabel}>Metro area</Text>
          <View style={styles.pillRow}>
            {metros.map(m => (
              <TouchableOpacity
                key={m.id}
                style={[styles.pill, metroId === m.id && styles.pillOn]}
                onPress={async () => {
                  setMetroId(m.id)
                  await loadItems(m.id)
                }}
                activeOpacity={0.85}
              >
                <Text style={[styles.pillText, metroId === m.id && styles.pillTextOn]}>
                  {m.name.replace(' Metro', '')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.fieldLabel}>
            End date <Text style={styles.optional}>(optional)</Text>
          </Text>

          <TouchableOpacity
            style={[
              styles.dateTrigger,
              !dateValidation.ok && endsAt.trim() ? styles.inputError : null,
            ]}
            onPress={() => setShowDatePicker(v => !v)}
            activeOpacity={0.85}
          >
            <View>
              <Text style={styles.dateTriggerLabel}>Selected date</Text>
              <Text style={styles.dateTriggerValue}>
                {endsAt ? formatDatePretty(endsAt) : 'No end date'}
              </Text>
            </View>
            <Text style={styles.dateTriggerIcon}>{showDatePicker ? '▴' : '▾'}</Text>
          </TouchableOpacity>

          {showDatePicker && (
            <View style={styles.pickerWrap}>
              <DateTimePicker
                value={pickerDate}
                mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                minimumDate={getTomorrowDate()}
                onChange={handleDateChange}
                themeVariant="light"
                style={styles.datePicker}
              />
            </View>
          )}

          {!dateValidation.ok && endsAt.trim() ? (
            <Text style={styles.errorHint}>{dateValidation.message}</Text>
          ) : (
            <Text style={styles.hint}>
              Leave blank for an open-ended list. Today and past dates are blocked.
            </Text>
          )}
        </View>

        <TouchableOpacity
          style={[styles.nextBtn, !title.trim() && styles.nextBtnDisabled]}
          onPress={maybeAdvanceToStep2}
          disabled={!title.trim()}
          activeOpacity={0.88}
        >
          <Text style={styles.nextBtnText}>Pick items →</Text>
        </TouchableOpacity>
      </ScrollView>
    )
  }

  if (step === 2) {
    const cats = ['All', ...categories.map(c => c.name)]
    const filtered = filteredItems()

    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.step2Header}>
          <TouchableOpacity
            onPress={() => isAdoptionMode ? navigation.goBack() : setStep(1)}
            activeOpacity={0.85}
          >
            <Text style={styles.backBtn}>← Back</Text>
          </TouchableOpacity>

          <View style={{ alignItems: 'center' }}>
            <Text style={styles.stepLabelDark}>
              {(isAdoptionMode || isCuratedMode) ? 'Customize your list' : 'Step 2 of 2'}
            </Text>
            {(isAdoptionMode || isCuratedMode) ? (
              <TextInput
                style={[styles.selectedCount, { borderBottomWidth: 1, borderBottomColor: '#E6D8C7', minWidth: 140, textAlign: 'center', paddingBottom: 2 }]}
                value={title}
                onChangeText={setTitle}
                placeholder="Name your list"
                placeholderTextColor="#98A2B3"
              />
            ) : (
              <Text style={styles.selectedCount}>{selected.size} selected</Text>
            )}
          </View>

          <View style={{ gap: 4 }}>
            <TouchableOpacity onPress={selectAll} activeOpacity={0.85}>
              <Text style={styles.selectAllBtn}>Select all</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={clearAll} activeOpacity={0.85}>
              <Text style={styles.clearBtn}>Clear</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.searchWrap}>
          <TextInput
            style={styles.searchInput}
            value={searchText}
            onChangeText={setSearchText}
            placeholder="Search items..."
            placeholderTextColor="#98A2B3"
            returnKeyType="search"
            blurOnSubmit={false}
            autoCorrect={false}
          />
        </View>

        <FlatList
          horizontal
          data={cats}
          keyExtractor={c => c}
          showsHorizontalScrollIndicator={false}
          style={styles.filterRow}
          contentContainerStyle={styles.filterContent}
          renderItem={({ item: cat }) => (
            <TouchableOpacity
              style={[styles.filterPill, filterCat === cat && styles.filterPillOn]}
              onPress={() => setFilterCat(cat)}
              activeOpacity={0.85}
            >
              <Text style={[styles.filterPillText, filterCat === cat && styles.filterPillTextOn]}>
                {cat}
              </Text>
            </TouchableOpacity>
          )}
        />

        <Text style={styles.itemCount}>
          {filtered.length} items · {items.length} total in this metro
        </Text>

        <FlatList
          data={filtered}
          keyExtractor={i => String(i.id)}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.itemRow}
              onPress={() => toggleItem(item.id)}
              activeOpacity={0.85}
            >
              <View style={[styles.checkbox, selected.has(item.id) && styles.checkboxOn]}>
                {selected.has(item.id) && <Text style={styles.checkmark}>✓</Text>}
              </View>

              <View style={{ flex: 1 }}>
                <Text style={styles.itemText} numberOfLines={2}>
                  {item.body}
                </Text>

                <View style={styles.itemMetaRow}>
                  {item.categories && (
                    <View
                      style={[
                        styles.miniTag,
                        {
                          backgroundColor: `${item.categories.color_hex}18`,
                          borderColor: `${item.categories.color_hex}30`,
                        },
                      ]}
                    >
                      <Text style={[styles.itemCat, { color: item.categories.color_hex }]}>
                        {item.categories.name}
                      </Text>
                    </View>
                  )}

                  {item.neighborhoods && (
                    <Text style={styles.itemHood}>{item.neighborhoods.name}</Text>
                  )}

                  {item.is_universal && (
                    <Text style={styles.itemUniversal}>Everywhere</Text>
                  )}
                </View>
              </View>
            </TouchableOpacity>
          )}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>No items match</Text>
            </View>
          }
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
        />

        <View style={[styles.createBtnWrap, { paddingBottom: insets.bottom + 16 }]}>
          <TouchableOpacity
            style={[styles.createBtn, (selected.size === 0 || saving) && styles.createBtnDisabled]}
            onPress={createList}
            disabled={selected.size === 0 || saving}
            activeOpacity={0.88}
          >
            {saving ? (
              <ActivityIndicator color={NAVY} />
            ) : (
              <Text style={styles.createBtnText}>
                {isAdoptionMode
                  ? `Save list with ${selected.size} item${selected.size !== 1 ? 's' : ''} →`
                  : `Create list with ${selected.size} item${selected.size !== 1 ? 's' : ''} →`
                }
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.successContent, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 40 }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.successIcon}>
        <Text style={{ fontSize: 34, color: GREEN }}>✓</Text>
      </View>

      <Text style={styles.successTitle}>{createdList?.title}</Text>
      <Text style={styles.successSub}>
        {selected.size} items ready · invite your crew and see who checks off the most
      </Text>

      <View style={styles.previewBox}>
        <Text style={styles.previewLabel}>Invite message</Text>
        <Text style={styles.previewText}>{inviteMessage()}</Text>
      </View>

      <TouchableOpacity style={styles.smsBtn} onPress={sendSMS} activeOpacity={0.88}>
        <Text style={styles.smsBtnText}>Send text message</Text>
      </TouchableOpacity>

      <View style={styles.socialRow}>
        <TouchableOpacity style={styles.snapBtn} onPress={shareViaSnapchat} activeOpacity={0.88}>
          <Text style={styles.snapBtnText}>Snapchat</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.instaBtn} onPress={shareViaInstagram} activeOpacity={0.88}>
          <Text style={styles.instaBtnText}>Instagram</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.shareBtn} onPress={openNativeShare} activeOpacity={0.88}>
        <Text style={styles.shareBtnText}>More options ···</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.viewListBtn}
        onPress={() => navigation.navigate('List', {
          listId: createdList?.id,
          title: createdList?.title,
        })}
        activeOpacity={0.88}
      >
        <Text style={styles.viewListBtnText}>View my list →</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.homeBtn}
        onPress={() => {
          const parent = navigation.getParent()
          if (parent) parent.navigate('HomeTab')
          else navigation.navigate('Home')
        }}
        activeOpacity={0.85}
      >
        <Text style={styles.homeBtnText}>Back to home</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },

  content: {
    paddingHorizontal: 20,
    paddingBottom: 60,
  },

  successContent: {
    paddingHorizontal: 24,
    alignItems: 'center',
  },

  heroCard: {
    backgroundColor: CARD,
    borderRadius: 24,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1.2,
    borderColor: BORDER,
  },

  sectionCard: {
    backgroundColor: CARD,
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: BORDER,
  },

  stepLabel: {
    fontSize: 11,
    color: MUTED,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 6,
    fontWeight: '700',
  },

  stepLabelDark: {
    fontSize: 11,
    color: MUTED,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 4,
    fontWeight: '700',
  },

  heading: {
    fontSize: 28,
    fontWeight: '800',
    color: TEXT,
    marginBottom: 6,
  },

  heroSub: {
    fontSize: 14,
    color: MUTED,
    lineHeight: 20,
  },

  fieldLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: MUTED,
    marginBottom: 8,
    marginTop: 18,
  },

  optional: {
    fontWeight: '500',
    color: '#98A2B3',
  },

  inputError: {
    borderColor: RED,
    backgroundColor: '#FFF3F0',
  },

  hint: {
    fontSize: 12,
    color: MUTED,
    marginTop: 7,
    lineHeight: 17,
  },

  errorHint: {
    fontSize: 12,
    color: RED,
    marginTop: 7,
    lineHeight: 17,
    fontWeight: '600',
  },

  dateTrigger: {
    backgroundColor: '#FFFDF9',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: BORDER,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  dateTriggerLabel: {
    fontSize: 11,
    color: MUTED,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },

  dateTriggerValue: {
    fontSize: 15,
    color: TEXT,
    fontWeight: '700',
  },

  dateTriggerIcon: {
    fontSize: 18,
    color: MUTED,
    fontWeight: '700',
  },

  pickerWrap: {
    marginTop: 10,
    minHeight: Platform.OS === 'ios' ? 320 : 0,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#FFFDF9',
    justifyContent: 'center',
    paddingTop: Platform.OS === 'ios' ? 8 : 0,
  },

  pillRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },

  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
  },

  pillOn: {
    backgroundColor: AMBER,
    borderColor: AMBER,
  },

  pillText: {
    fontSize: 13,
    color: TEXT,
    fontWeight: '700',
  },

  pillTextOn: {
    color: NAVY,
    fontWeight: '800',
  },

  nextBtn: {
    backgroundColor: AMBER,
    borderRadius: 18,
    paddingVertical: 17,
    alignItems: 'center',
    marginTop: 20,
  },

  nextBtnDisabled: {
    opacity: 0.45,
  },

  nextBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: NAVY,
  },

  step2Header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: BG,
  },

  backBtn: {
    fontSize: 15,
    color: TEXT,
    fontWeight: '700',
  },

  selectedCount: {
    fontSize: 13,
    fontWeight: '800',
    color: '#A16A00',
  },

  selectAllBtn: {
    fontSize: 12,
    color: GREEN,
    textAlign: 'right',
    fontWeight: '700',
  },

  clearBtn: {
    fontSize: 12,
    color: MUTED,
    textAlign: 'right',
    fontWeight: '700',
  },

  searchWrap: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },

  searchInput: {
    backgroundColor: CARD,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: TEXT,
    fontSize: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },

  filterRow: {
  flexGrow: 0,
  marginBottom: 6,
  minHeight: 56,
},

filterContent: {
  paddingHorizontal: 16,
  gap: 8,
  paddingTop: 6,
  paddingBottom: 10,
  alignItems: 'center',
},

  filterPill: {
  minHeight: 40,
  paddingHorizontal: 16,
  paddingVertical: 10,
  borderRadius: 999,
  borderWidth: 1,
  borderColor: BORDER,
  backgroundColor: CARD,
  alignItems: 'center',
  justifyContent: 'center',
},

filterPillOn: {
  backgroundColor: AMBER,
  borderColor: AMBER,
},

filterPillText: {
  fontSize: 13,
  lineHeight: 16,
  color: TEXT,
  fontWeight: '700',
},

filterPillTextOn: {
  color: NAVY,
  fontWeight: '800',
},

  itemCount: {
    fontSize: 12,
    color: MUTED,
    paddingHorizontal: 16,
    marginBottom: 8,
    fontWeight: '600',
  },

  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: CARD,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
  },

  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#CABFB1',
    marginTop: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    backgroundColor: '#fff',
  },

  checkboxOn: {
    backgroundColor: AMBER,
    borderColor: AMBER,
  },

  checkmark: {
    fontSize: 11,
    color: NAVY,
    fontWeight: '800',
  },

  itemText: {
    fontSize: 14,
    color: TEXT,
    lineHeight: 20,
    fontWeight: '700',
  },

  itemMetaRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 5,
    flexWrap: 'wrap',
    alignItems: 'center',
  },

  miniTag: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
  },

  itemCat: {
    fontSize: 10,
    fontWeight: '700',
  },

  itemHood: {
    fontSize: 10,
    color: MUTED,
    fontWeight: '600',
  },

  itemUniversal: {
    fontSize: 10,
    color: GREEN,
    fontWeight: '700',
  },

  sep: {
    height: 10,
  },

  createBtnWrap: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: BG,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },

  createBtn: {
    backgroundColor: AMBER,
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: 'center',
  },

  createBtnDisabled: {
    opacity: 0.45,
  },

  createBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: NAVY,
  },

  emptyWrap: {
    padding: 40,
    alignItems: 'center',
  },

  emptyText: {
    color: MUTED,
    fontSize: 14,
    fontWeight: '600',
  },

  successIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: SUCCESS_BG,
    borderWidth: 1,
    borderColor: SUCCESS_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },

  successTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: TEXT,
    marginBottom: 10,
    textAlign: 'center',
  },

  successSub: {
    fontSize: 14,
    color: MUTED,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },

  previewBox: {
    width: '100%',
    backgroundColor: SOFT_2,
    borderRadius: 16,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#DED3C5',
  },

  previewLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: MUTED,
    marginBottom: 6,
  },

  previewText: {
    fontSize: 12,
    color: TEXT,
    lineHeight: 18,
  },

  smsBtn: {
    width: '100%',
    backgroundColor: GREEN,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 10,
  },

  smsBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#fff',
  },

  socialRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },

  snapBtn: {
    flex: 1,
    backgroundColor: '#FFFC00',
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
  },

  snapBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#000',
  },

  instaBtn: {
    flex: 1,
    backgroundColor: '#C13584',
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
  },

  instaBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
  },

  shareBtn: {
    width: '100%',
    backgroundColor: CARD,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 24,
  },

  shareBtnText: {
    fontSize: 14,
    color: TEXT,
    fontWeight: '700',
  },

  viewListBtn: {
    width: '100%',
    backgroundColor: AMBER,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12,
  },

  viewListBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: NAVY,
  },

  homeBtn: {
    paddingVertical: 12,
  },

  homeBtnText: {
    fontSize: 14,
    color: MUTED,
    fontWeight: '700',
  },

  datePicker: {
    height: Platform.OS === 'ios' ? 320 : undefined,
  },
})