import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, StatusBar, ActivityIndicator, Alert,
  RefreshControl, Modal, ImageBackground, useWindowDimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Location from 'expo-location'
import { LinearGradient } from 'expo-linear-gradient'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../lib/supabase'
import { fetchCuratedLists } from '../lib/useItems'
import { useCrewInvite } from '../lib/useCrewInvite'
import { useLeaderboard } from '../lib/useLeaderboard'
import { getTierByName } from '../lib/tiers'
import { useTheme } from '../lib/ThemeContext'
import ExperiencesRail from '../components/ExperiencesRail'
import * as Sentry from '@sentry/react-native'
import { haversineMeters } from '../lib/distance'
import { getSessionDensityTier } from '../lib/densityTier'
import { isWithinWindow, getCurrentSeasonWindow } from '../lib/seasonWindow'
import { filterMaskedBonusDrops } from '../lib/bonusDrops'
import { isItemInSeason } from '../lib/seasonFilter'
import { useWhatsGood } from '../lib/useWhatsGood'
import { useCurrentLocation } from '../lib/currentLocation'
import { resolveHomeMetro, nearestMetroWithinBoundary } from '../lib/metroSelection'
import { attachActiveCoverImages, attachDisplayEligibleImagePools } from '../lib/coverCandidates'
import { useAtPlaceReminder } from '../lib/visitDetection/useAtPlaceReminder'
import { deriveHomeHeroLayout } from '../lib/homeHeroLayout'
import { selectNearYouCompactRows } from '../lib/nearYouCompact'
import { selectHomeNearbyCandidates } from '../lib/homeNearYou'
import { fetchAllRows } from '../lib/supabasePagination'
import CompactHomeHeader from '../components/home/CompactHomeHeader'
import DestinationHero from '../components/home/DestinationHero'
import CityPickerModal from '../components/home/CityPickerModal'
import NearYouCompact from '../components/home/NearYouCompact'
import WhatsTheThingHero from '../components/home/WhatsTheThingHero'
import WhatsGoodDiscovery from '../components/home/WhatsGoodDiscovery'

const PURPLE = '#7A4DB3'

// Persisted key for the user's last EXPLICIT metro choice (via the city
// picker / switchMetro below) — see resolveHomeMetro in
// lib/resolveDefaultMetro.js for the full precedence this enforces. An
// explicit choice here always wins over a fresh GPS-based nearest-metro
// calculation on the next app open; it is never silently overwritten by
// location resolution.
const SELECTED_METRO_SLUG_KEY = 'checkoff_selected_metro_slug'

// Per-list ACCENT COLOR (not a gradient) for the "More [Metro] lists" rail
// — used only when a list has no hero_image_url set. A photo + the shared
// dark scrim is the primary look (matches the seasonal hero); this is
// strictly the no-photo fallback, so it stays a single flat color rather
// than a second competing color language. Matched by title so it survives
// across metros/seasons without depending on a specific list id. Falls
// back to a stable hash-based pick from FALLBACK_ACCENTS for anything not
// named here (a future themed list, another metro's list, before its photo
// is uploaded) so a card never looks unstyled.
const THEMED_LIST_ACCENTS = {
  'patio season':          '#D97B29',
  'hidden bars':           '#3D2B56',
  'kid-friendly weekends': '#2E9BD6',
  'first date spots':      '#E0588F',
  'roosevelt row':         '#1D9E75',
  'worth the splurge':     '#D4AF37',
  'tucson hidden bars':    '#3D2B56',
  'mercado district':      '#C4520A',
}
const FALLBACK_ACCENTS = ['#378ADD', '#7A4DB3', '#D85A30', '#E8A020']
function themedListAccent(title, id) {
  const key = (title ?? '').toLowerCase().trim()
  if (THEMED_LIST_ACCENTS[key]) return THEMED_LIST_ACCENTS[key]
  let hash = 0
  for (const c of id ?? '') hash = (hash * 31 + c.charCodeAt(0)) >>> 0
  return FALLBACK_ACCENTS[hash % FALLBACK_ACCENTS.length]
}

export default function HomeScreen({ navigation }) {
  const insets = useSafeAreaInsets()
  const { width: windowWidth } = useWindowDimensions()
  // Below this width, "This Week" yields first so the CheckOff wordmark
  // never has to compete for space and can't get squeezed into truncating.
  const isNarrowHeader = windowWidth < 380
  const { colors, isDark, toggleTheme } = useTheme()
  const { BG, CARD, TEXT, MUTED, LABEL, BORDER, SOFT, SOFT_2, AMBER, NAVY, GREEN, RED,
          SUCCESS_BG, SUCCESS_BORDER, ENDED_BG, ENDED_BORDER, ENDED_TEXT, CARD_URGENT, STATUS_BAR } = colors

  const styles = useMemo(() => createStyles({
    BG, CARD, TEXT, MUTED, LABEL, BORDER, SOFT, SOFT_2, AMBER, NAVY, GREEN,
    SUCCESS_BG, SUCCESS_BORDER, ENDED_BG, ENDED_BORDER, ENDED_TEXT, CARD_URGENT,
  }), [BG, CARD, TEXT, MUTED, LABEL, BORDER, SOFT, SOFT_2, AMBER, NAVY, GREEN,
       SUCCESS_BG, SUCCESS_BORDER, ENDED_BG, ENDED_BORDER, ENDED_TEXT, CARD_URGENT])

  const [metros, setMetros] = useState([])
  const [metroPickerVisible, setMetroPickerVisible] = useState(false)
  const [selectedMetro, setSelectedMetro] = useState(null)
  // Set when resolveHomeMetro returns reason: 'needs_selection' — no
  // explicit persisted choice AND location denied/unavailable/timed out.
  // Distinct from the initial loading window: `loading` covers "still
  // figuring out what to show," this covers "figured it out — there is
  // genuinely no metro to show until the user picks one." Never a reason
  // to silently render any metro's (e.g. Phoenix's) content — see the
  // render guard below and switchMetro(), the only thing that clears it.
  const [needsMetroSelection, setNeedsMetroSelection] = useState(false)
  const [season, setSeason] = useState(null)
  // Resolved inside loadForMetro (keyed on the metroId param directly, NOT
  // selectedMetro state — loadForMetro can run before setSelectedMetro's
  // update has committed, e.g. on cold start, so reading selectedMetro
  // here would risk a stale/null read). Defaults to America/Phoenix,
  // matching every call site's prior hardcoded behavior until this is
  // set for real.
  const [metroTimezone, setMetroTimezone] = useState('America/Phoenix')

  const [lists, setLists] = useState([])
  const [officialLists, setOfficialLists] = useState([])

  const [joinedIds, setJoinedIds] = useState(new Set())
  const [user, setUser] = useState(null)
  const [curatedGroups, setCuratedGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [listMemberMap, setListMemberMap] = useState({})
  const [userStreak, setUserStreak] = useState(0)
  const [userLifetimePts, setUserLifetimePts] = useState(0)
  const [userInsiderTier, setUserInsiderTier] = useState('Starter')
  const [nextTenList, setNextTenList] = useState(null)
  const [nextTenDismissed, setNextTenDismissed] = useState(false)
  const [heroImage, setHeroImage] = useState(null)
  const [recapModal, setRecapModal] = useState(null) // { count, pts, streak, weekStartIso }
  const [featuredCreators, setFeaturedCreators] = useState([])
  const [nearbyZone, setNearbyZone] = useState(null)
  const [zoneBannerDismissed, setZoneBannerDismissed] = useState(false)

  // "Near you right now" rail — userLocation comes from the shared
  // lib/currentLocation.js store (not its own one-shot fetch): this is what
  // lets a Home pull-to-refresh force a real GPS re-fix, and what lets the
  // app-wide 5-minute foreground-stale check update this rail automatically
  // after the user has traveled while the app was backgrounded. See
  // requestFreshLocation() call in the RefreshControl below.
  const { location: userLocation, refreshLocation: refreshUserLocation } = useCurrentLocation()
  const [sessionTier, setSessionTier] = useState(null)
  const [rawNearbyItems, setRawNearbyItems] = useState([]) // unsorted candidate pool
  const [checkedItemIds, setCheckedItemIds] = useState(new Set())
  const [nearbyLoading, setNearbyLoading] = useState(false)
  const [seasonalCounts, setSeasonalCounts] = useState({ checked: 0, total: 0 })
  const [crewListId, setCrewListId] = useState(null)
  const [themedLists, setThemedLists] = useState([])

  const { savedCrew } = useCrewInvite()

  useEffect(() => {
    init()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      try {
        const authUser = session?.user ?? null
        setUser(authUser)
        if (selectedMetro) {
          loadForMetro(selectedMetro.id, authUser?.id, selectedMetro.slug)
        }
      } catch (e) {
        Sentry.captureException(e)
      }
    })
    return () => subscription.unsubscribe()
  }, []) // eslint-disable-line

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      if (selectedMetro) {
        loadForMetro(selectedMetro.id, user?.id, selectedMetro.slug)
      }
    })
    return unsubscribe
  }, [navigation, selectedMetro, user])

  // Check dismiss state whenever a new nextTenList loads (keyed by list id)
  useEffect(() => {
    if (!nextTenList) return
    const key = `next10_dismissed_${nextTenList.id}`
    AsyncStorage.getItem(key).then(val => {
      if (val === 'true') setNextTenDismissed(true)
    })
  }, [nextTenList?.id])

  async function init() {
    let authUser = null
    try {
      const { data } = await supabase.auth.getUser()
      authUser = data?.user ?? null
    } catch (e) {
      console.warn('HomeScreen getUser error:', e.message)
    }
    setUser(authUser)

    try {
      // Fetch metros, the Next 10 banner, and any persisted EXPLICIT metro
      // choice in parallel — banner never blocks the screen, and the
      // persisted choice (if present) short-circuits the GPS lookup below
      // entirely, per resolveHomeMetro's precedence.
      const [{ data: metroData }, { data: n10Data }, persistedSlug] = await Promise.all([
        supabase
          .from('metro_areas')
          .select('id, name, state, slug, center_lat, center_lng')
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('curated_lists')
          .select('id, title')
          .eq('audience_group', 'the-next-10')
          .eq('is_active', true)
          .maybeSingle(),
        AsyncStorage.getItem(SELECTED_METRO_SLUG_KEY).catch(() => null),
      ])

      setNextTenList(n10Data ?? null)
      setMetros(metroData ?? [])
      const metros = metroData ?? []

      let locationResult = null
      let locationState = 'unavailable'

      // ALWAYS attempt a real GPS fix now, even when a persisted explicit
      // choice already exists — this used to be skipped entirely
      // whenever persistedSlug was set (an explicit selection "wins
      // regardless of location," so the round-trip was considered
      // pointless). That was the actual mechanism behind the Munich
      // field-test bug: a device with an old persisted Vienna/Phoenix
      // slug never even checked live location on a later app open, so
      // resolveHomeMetro's new location-wins-when-ready precedence (see
      // lib/metroSelection.js) had nothing to compare against and the
      // stale slug won by default every time. NOTE: nothing here special-
      // cases network/connectivity type — expo-location's permission +
      // fix acquisition works independently of whether the device has
      // cellular data (WiFi-only/airplane-mode-with-WiFi devices still get
      // GPS/WiFi-positioning fixes); a device being WiFi-only must never
      // be treated as "no location."
      try {
        const { status } = await Location.requestForegroundPermissionsAsync()
        if (status === 'granted') {
          // Waits for a real fix before giving up — matches
          // lib/currentLocation.js's own 8s device-fetch timeout so a
          // slower (e.g. WiFi-positioning-only, no cellular assist) GPS
          // fix isn't mistaken for "unavailable" and doesn't trigger an
          // early fallback. The `loading` state stays true for this
          // whole window, so the screen shows a loading state rather
          // than jumping to a default while this is in flight.
          locationResult = await Promise.race([
            (async () => {
              const pos = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Low,
              })
              return { latitude: pos.coords.latitude, longitude: pos.coords.longitude }
            })(),
            new Promise(resolve => setTimeout(() => resolve(null), 8000)),
          ])
          locationState = locationResult ? 'ready' : 'unavailable'
        } else {
          // Permission denied — genuinely unavailable, not pending, no
          // point waiting further.
          locationState = 'unavailable'
        }
      } catch (e) {
        /* GPS optional */
        locationState = 'unavailable'
      }

      // Single precedence-aware resolution: a genuinely 'ready' live
      // location within an active metro's boundary wins first (even over a
      // persisted choice for a DIFFERENT metro — the Munich fix), else the
      // explicit persisted choice wins, else — when location is genuinely
      // pending/denied/unavailable/timed out and there's no persisted
      // choice — an explicit needs_selection state (no metro picked at
      // all; see lib/metroSelection.js's resolveHomeMetro docstring). This
      // replaces the old hardcoded Phoenix/Milwaukee-by-latitude special
      // case, the later alphabetical-metro fallback that replaced it, AND
      // the "explicit choice always wins regardless of location" rule that
      // replaced THAT — each was rejected in turn as still being a silent,
      // arbitrary (or, for the "always wins" rule, permanently stale)
      // metro default.
      const { metro: defaultMetro, reason: metroReason } = resolveHomeMetro({
        persistedSlug,
        metros,
        location: locationResult,
        locationState,
      })

      // Destination zone check — only meaningful with a real fix, and only
      // when we actually looked one up (skipped entirely for an explicit
      // persisted metro choice, same as above).
      if (locationResult) {
        const { latitude: uLat, longitude: uLng } = locationResult
        try {
          let zoneQuery = supabase
            .from('destination_zones')
            // destinations(hero_image_url) added for the 2026 redesign's
            // DestinationHero — additive only, legacy zoneBanner ignores
            // it. Investigate + Restore Destination Hub Hero (2026-09-03):
            // this previously (incorrectly) embedded curated_lists
            // (hero_image_url), a column that does not exist on
            // curated_lists at all — the embed made the WHOLE query
            // throw a 400, silently swallowed by the catch below, so
            // nearbyZone never got set regardless of any admin toggle.
            // The Destination's hero image actually lives on
            // destinations.hero_image_url (see the admin tool's
            // Destinations tab image upload) — destination_zones has
            // exactly one FK to destinations, so no embed hint is needed.
            .select('id, name, slug, banner_title, banner_subtitle, center_lat, center_lng, radius_km, destination_id, is_active, curated_list_id, destinations(hero_image_url)')
          if (!__DEV__) {
            zoneQuery = zoneQuery.eq('is_active', true)
          }
          const { data: zones } = await zoneQuery

          const hit = (zones ?? []).find(z =>
            haversineMeters(uLat, uLng, z.center_lat, z.center_lng) <= z.radius_km * 1000
          )

          if (hit) {
            // Dismissal is session-only (zoneBannerDismissed local state) —
            // no persisted flag to check here, so the banner always shows
            // on a fresh cold launch while the user is still in range.
            if (__DEV__ && !hit.is_active) {
              console.log('[DEBUG] destination zone bypass — showing INACTIVE zone in dev build:', hit.name, hit.id)
            }
            setNearbyZone(hit)
          }
        } catch (e) {
          /* zone check optional */
        }
      }

      // A 'needs_selection' resolution (location genuinely denied/
      // unavailable/timed out, no persisted choice) means NO metro is
      // selected — not Phoenix, not any other metro. Nothing is persisted
      // to AsyncStorage here (SELECTED_METRO_SLUG_KEY stays untouched), so
      // a later successful location resolution or explicit user pick via
      // switchMetro() can still resolve normally on the next app open.
      // Surface the existing city-picker mechanism instead of guessing.
      if (defaultMetro) {
        setSelectedMetro(defaultMetro)
        await loadForMetro(defaultMetro.id, authUser?.id, defaultMetro.slug)
        // Live location just won over a DIFFERENT (stale) persisted slug —
        // update AsyncStorage to match so the stale value stops fighting
        // every future resolution (requirement: stale persisted selections
        // are cleared/updated automatically, no reinstall/manual-clear
        // needed). Only writes when something actually changed, and only
        // ever overwrites with the metro real GPS just resolved to — never
        // an arbitrary/guessed value.
        if (metroReason === 'nearest' && persistedSlug &&
            String(persistedSlug).toLowerCase() !== (defaultMetro.slug ?? '').toLowerCase()) {
          try {
            await AsyncStorage.setItem(SELECTED_METRO_SLUG_KEY, defaultMetro.slug)
          } catch (e) {
            /* persistence optional — resolution still correct for this session */
          }
        }
      } else if (metroReason === 'needs_selection') {
        setNeedsMetroSelection(true)
      }
    } catch (e) {
      console.warn('HomeScreen init error:', e.message)
    } finally {
      setLoading(false)
    }
  }

  function handleDestinationZoneTap(zone) {
    // Just opens the Hub — no join/upsert happens here anymore. That now
    // fires from HubScreen, only when the user taps a specific list, so
    // browsing the Hub itself never requires being signed in.
    navigation.navigate('Hub', { destinationId: zone.destination_id })
    // Intentionally does not dismiss the banner — the user should still see
    // it on the next cold launch while they remain inside the zone's radius.
  }

  async function loadForMetro(metroId, userId, citySlug) {
  // Derive slug from the currently selected metro if not passed explicitly
  // so Milwaukee (or any future city) always gets the correct slug
  const slug = citySlug
    ?? selectedMetro?.slug
    ?? selectedMetro?.name?.toLowerCase().replace(/\s+metro/i, '').trim()
    ?? 'phoenix'
  // Fire and forget — non-critical dressing, shouldn't delay the rest of
  // Home's render. Populates rawNearbyItems/checkedItemIds whenever ready.
  // Deliberately not passed metroId — see loadNearbyRail's own comment;
  // it's metro-independent by design, called here only to keep the same
  // refresh cadence (mount, focus, pull-to-refresh, metro switch) so
  // checkedItemIds stays current, not because the results vary by metro.
  loadNearbyRail(userId)

  try {
    const today = new Date().toISOString().split('T')[0]

    // .maybeSingle() never throws — returns null if no season matches
    const { data: seasonData } = await supabase
      .from('seasons')
      .select('*')
      .lte('starts_at', today)
      .gte('ends_at', today)
      .maybeSingle()                          // ← was .single()

    setSeason(seasonData)

    const { data: metroImg } = await supabase
      .from('metro_areas')
      .select('hero_images, timezone')
      .eq('id', metroId)
      .maybeSingle()
    const imgs = metroImg?.hero_images ?? []
    setHeroImage(imgs.length > 0 ? imgs[Math.floor(Math.random() * imgs.length)] : null)
    // Resolved once per loadForMetro call, from the metroId param this
    // call was actually invoked with — not from selectedMetro, which may
    // not have caught up yet. metro_areas.timezone is NOT NULL as of
    // supabase/migrations/20260821_metro_timezone_platform_fix.sql, so a
    // missing metroImg row (bad metroId) is the only null case; default
    // preserves prior hardcoded behavior for that edge case.
    const resolvedTimezone = metroImg?.timezone ?? 'America/Phoenix'
    setMetroTimezone(resolvedTimezone)

    const { data: offLists } = await supabase
      .from('lists')
      .select('id, title, starts_at, ends_at, cover_emoji, metro_id, hero_image_url')
      .eq('is_official', true)
      .eq('is_public', true)
      .eq('metro_id', metroId)
      .order('created_at', { ascending: false })

    setOfficialLists(offLists ?? [])

    // Seasonal card "N of M" progress — folded into this single reload
    // path (rather than a separate effect keyed on currentOnHome's own
    // id/starts_at/ends_at, which never change on a plain check-off, so
    // that effect never refired on return to Home even though the count
    // itself had changed) so it refreshes on every loadForMetro call —
    // mount, metro switch, and every focus, via the
    // navigation.addListener('focus', ...) listener below that already
    // calls loadForMetro on every return to Home. Uses offLists (the
    // just-fetched array) directly rather than the officialLists state
    // var, which hasn't committed yet at this point in the function.
    // Mirrors the bucketing rule at activeOfficial/endedOfficial below
    // (kept separate/inlined rather than shared, since render-time also
    // needs upcomingOfficial/pastOfficialLists from that same pass and
    // this is the only part of it this fetch needs).
    {
      const freshOfficial = offLists ?? []
      const freshActive = freshOfficial
        .filter(l => !isEnded(l.ends_at) && (!l.starts_at || new Date(`${l.starts_at}T00:00:00`) <= new Date()))
        .sort((a, b) => new Date(a.ends_at || '9999-12-31') - new Date(b.ends_at || '9999-12-31'))
      const freshEnded = freshOfficial
        .filter(l => isEnded(l.ends_at))
        .sort((a, b) => new Date(b.ends_at) - new Date(a.ends_at))
      const freshCurrentOnHome = freshActive[0] ?? freshEnded[0] ?? null

      if (!freshCurrentOnHome?.id || isEnded(freshCurrentOnHome?.ends_at)) {
        setSeasonalCounts({ checked: 0, total: 0 })
      } else {
        // Bonus Drops are excluded from this count entirely — a 30-item
        // list with 2 drops always reads "X of 30", never "of 31"/"of 32".
        const { data: liRows } = await supabase
          .from('list_items')
          .select('item_id, is_bonus_drop')
          .eq('list_id', freshCurrentOnHome.id)
        const nonDropRows = (liRows ?? []).filter(li => !li.is_bonus_drop)
        const total = nonDropRows.length
        let checked = 0
        if (userId && total > 0) {
          const itemIds = nonDropRows.map(li => li.item_id).filter(Boolean)
          // Season-scoped to THIS list's own window — without this,
          // Fall's card would count every item already checked off
          // during Summer, inflating "N of M" past the list's own
          // item count.
          const { data: checkins } = await supabase
            .from('check_ins')
            .select('item_id, checked_at')
            .eq('user_id', userId)
            .in('item_id', itemIds)
          const inWindow = (checkins ?? []).filter(c =>
            isWithinWindow(c.checked_at, freshCurrentOnHome.starts_at, freshCurrentOnHome.ends_at, resolvedTimezone)
          )
          checked = new Set(inWindow.map(c => c.item_id)).size
        }
        setSeasonalCounts({ checked, total })
      }
    }

    const { data: curatedData } = await fetchCuratedLists(slug)
    setCuratedGroups((curatedData ?? []).slice(0, 6))

    // Fetch creators with a featured-eligible list in this metro for the Creators tile
    const { data: creatorListRows } = await supabase
      .from('lists')
      .select('checkoff_creator_id')
      .eq('metro_id', metroId)
      .eq('is_featured_eligible', true)
      .not('goes_public_at', 'is', null)
      .not('checkoff_creator_id', 'is', null)

    const featuredCreatorIds = [...new Set((creatorListRows ?? []).map(l => l.checkoff_creator_id).filter(Boolean))]
    if (featuredCreatorIds.length > 0) {
      const { data: creatorRows } = await supabase
        .from('creators')
        .select('id, handle, display_name, avatar_url')
        .in('id', featuredCreatorIds)
        .eq('is_active', true)
        .order('display_name')
      setFeaturedCreators(creatorRows ?? [])
    } else {
      setFeaturedCreators([])
    }

    if (userId) {
      const { data: memberLists } = await supabase
        .from('list_members')
        .select('lists(id, title, starts_at, ends_at, is_public, is_official, creator_id, cover_emoji, checkoff_creator_id, is_featured_eligible)')
        .eq('user_id', userId)

      const all = (memberLists ?? []).map(m => m.lists).filter(Boolean)
      const joinedSet = new Set(all.filter(l => l.is_official).map(l => l.id))
      setJoinedIds(joinedSet)
      const userLists = all.filter(l => !l.is_official)

      // Fetch streak in parallel with member map
      const [memberships, streakRes] = await Promise.all([
        userLists.length > 0
          ? supabase
              .from('list_members')
              .select('list_id, user_id, users(id, display_name)')
              .in('list_id', userLists.map(l => l.id))
              .neq('user_id', userId)
          : Promise.resolve({ data: [] }),
        supabase
          .from('users')
          .select('current_streak, lifetime_points, insider_tier')
          .eq('id', userId)
          .single(),
      ])

      setUserStreak(streakRes.data?.current_streak ?? 0)
      setUserLifetimePts(streakRes.data?.lifetime_points ?? 0)
      setUserInsiderTier(streakRes.data?.insider_tier ?? 'Starter')

      // Load crew members for each list (up to 4 avatars per list)
      if (userLists.length > 0) {
        // Fetch creator handles for any creator lists in a separate query
        const creatorIds = [...new Set(userLists.map(l => l.checkoff_creator_id).filter(Boolean))]
        const creatorHandleMap = {}
        if (creatorIds.length > 0) {
          const { data: creatorRows } = await supabase
            .from('creators')
            .select('id, handle')
            .in('id', creatorIds)
          ;(creatorRows ?? []).forEach(c => { creatorHandleMap[c.id] = c.handle })
        }

        const memberMap = {}
        const memberCountMap = {}
        ;(memberships.data ?? []).forEach(m => {
          memberCountMap[m.list_id] = (memberCountMap[m.list_id] ?? 0) + 1
          if (!memberMap[m.list_id]) memberMap[m.list_id] = []
          if (memberMap[m.list_id].length < 4) {
            memberMap[m.list_id].push({
              id:      m.user_id,
              initial: (m.users?.display_name ?? '?')[0].toUpperCase(),
            })
          }
        })
        setListMemberMap(memberMap)
        setLists(userLists.map(l => ({
          ...l,
          memberCount:   (memberCountMap[l.id] ?? 0) + 1,
          creatorHandle: creatorHandleMap[l.checkoff_creator_id] ?? null,
        })))
      } else {
        setLists([])
      }
    } else {
      setJoinedIds(new Set())
      setLists([])
      setListMemberMap({})
      setUserStreak(0)
    }
  } catch (e) {
    // ← Silent fail
  }
}

// Candidate item pool for the "Near you right now" rail — mirrors
// useNearby.js's precedent (is_active/is_approved items are the general
// discoverability boundary, independent of list membership) but, unlike
// Nearby, includes universal items and applies no ring/distance cap —
// proximitySort's Home config handles interleaving.
//
// Deliberately NOT scoped to the selected metro. The metro selector is a
// browse control for the seasonal card and curated lists below it — it
// must not affect a proximity rail, which has to answer "what's near the
// user right now" regardless of what they happen to have picked in a
// dropdown. Confirmed on device: with the metro set to Milwaukee while
// physically in Arizona, a metro-scoped rail returned Milwaukee items at
// 1,300+ miles under "Near you right now." Fetches every qualifying
// located item system-wide (519 rows total as of this writing — small
// enough to fetch in full; no bounding-box prefilter needed) and lets
// proximitySort do the actual distance sorting/interleaving against the
// user's real coordinates.
// Flattens a raw items-table row into the same shape ItemDetailScreen
// reads from every other entry point (useItems.js / DiscoverScreen.jsx's
// augmentWithDistance) — camelCase fields ItemDetailScreen reads directly
// (categoryName, photoRequired, isSecret, allowsPersonalNote, ...), not
// just the raw snake_case columns. Rail items must be shape-complete
// before reaching the detail screen, not just column-complete — several
// of ItemDetailScreen's reads have no snake_case fallback.
function mapRailItem(item) {
  return {
    id:                  item.id,
    body:                item.body,
    checkin_type:        item.checkin_type,
    checkinType:         item.checkin_type,
    is_universal:        item.is_universal ?? false,
    isUniversal:         item.is_universal ?? false,
    difficulty:          item.difficulty ?? 1,
    photo_required:      item.photo_required ?? false,
    photoRequired:       item.photo_required ?? false,
    maps_lat:            item.maps_lat ?? null,
    maps_lng:            item.maps_lng ?? null,
    geo_radius_m:        item.geo_radius_m ?? null,
    is_secret:           item.is_secret ?? false,
    isSecret:            item.is_secret ?? false,
    secret_reveal_text:  item.secret_reveal_text ?? null,
    website_url:         item.website_url ?? null,
    maps_query:          item.maps_query ?? null,
    partner_id:          item.partner_id ?? null,
    partnerName:         item.partners?.business_name ?? null,
    // 2026 redesign image audit: neither items nor partners currently has
    // photo_url populated for any live row (0/4 partners as of this
    // audit) — this field exists so the new home/*.jsx card components
    // have a real path forward the moment photos are added, without
    // another data-plumbing change. Every card gracefully falls back to a
    // solid-color initial glyph when this is null (see
    // components/home/WhatsGoodDiscovery.jsx).
    photo_url:           item.partners?.photo_url ?? null,
    // Community Cover Photos V1 — the item's admin-selected cover, if any
    // (see lib/coverCandidates.js's resolveActiveCoverUrl). Resolved to a
    // real signed activeCoverImageUrl just below, in resolveActiveCoverImages
    // — this raw id is the input to that resolution, not consumed directly
    // by any card component.
    activeCoverCandidateId: item.active_cover_candidate_id ?? null,
    has_alcohol:         item.has_alcohol ?? false,
    season_tag:          item.season_tag ?? null,
    allowsPersonalNote:  item.allows_personal_note ?? false,
    personalPromptLabel: item.personal_prompt_label ?? null,
    personalPlaceLabel:  item.personal_place_label ?? null,
    categoryName:        item.categories?.name ?? 'Misc',
    categoryColor:       item.categories?.color_hex ?? '#888780',
    neighborhoodId:      item.neighborhoods?.id ?? null,
    neighborhoodName:    item.neighborhoods?.name ?? null,
    // Archetype Fallback Artwork V1 (2026-09-17) — optional per-item
    // override consumed by lib/fallbackArtSource.js's resolver (see
    // components/home/useCardArtwork.js). Snake->camel mapping mirrors
    // every other field in this function; null is the common case and
    // means "use the category default archetype."
    fallbackArtKey:      item.fallback_art_key ?? null,
  }
}

async function loadNearbyRail(userId) {
  setNearbyLoading(true)
  try {
    const itemCols = `
      id, body, checkin_type, is_universal, difficulty, photo_required,
      maps_lat, maps_lng, geo_radius_m, is_secret, secret_reveal_text,
      website_url, maps_query, partner_id, has_alcohol, season_tag,
      allows_personal_note, personal_prompt_label, personal_place_label,
      active_cover_candidate_id, fallback_art_key,
      categories(name, color_hex),
      neighborhoods!items_neighborhood_id_fkey(id, name),
      partners!items_partner_id_fkey(business_name, photo_url)
    `

    // Paginated (see lib/supabasePagination.js) — an unbounded .select() here
    // silently truncates at PostgREST's default 1000-row cap once the global
    // eligible-item count crosses it (confirmed: 1465 rows for the located-
    // items filter alone), dropping real candidates from the Near-You rail's
    // pool before distance is ever computed — the same root cause as the
    // Nearby "All" tab bug in lib/useNearby.js. .order('id') makes paging
    // deterministic (required for stable .range() pagination in Postgres).
    const [{ data: universalItems }, { data: locatedItems }] = await Promise.all([
      fetchAllRows(() => supabase
        .from('items')
        .select(itemCols)
        .eq('is_active', true)
        .eq('is_approved', true)
        .eq('is_universal', true)
        .order('id')),
      fetchAllRows(() => supabase
        .from('items')
        .select(itemCols)
        .eq('is_active', true)
        .eq('is_approved', true)
        .eq('is_universal', false)
        .not('maps_lat', 'is', null)
        .not('maps_lng', 'is', null)
        .order('id')),
    ])

    const allRawItems = [...(universalItems ?? []), ...(locatedItems ?? [])]
      .map(mapRailItem)
      .filter(isItemInSeason)
    // Locked Bonus Drops must not leak here — they only exist inside their
    // own list until unlocked. Masked unconditionally unless this user has
    // already checked the item off, at which point it's a normal item.
    const maskedItems = await filterMaskedBonusDrops(allRawItems, userId)
    // Community Cover Photos V1 — resolve any item with a real selected
    // cover (items.active_cover_candidate_id) to a signed
    // activeCoverImageUrl. Cheap in practice: only items an admin has
    // actually selected a cover for ever have a truthy
    // activeCoverCandidateId, so this is a no-op fast-path for the vast
    // majority of items today.
    const withActiveCover = await attachActiveCoverImages(maskedItems)
    // Multi-Image Rotation (2026-09-03) — also attach the full
    // display-eligible pool where one exists, so resolvedItemImages()/
    // resolvedItemImage(item, context) can rotate rather than always
    // showing the single activeCoverImageUrl above. Kept as a separate
    // attach step (not merged into attachActiveCoverImages) so that
    // function's existing single-image contract is untouched for any
    // other caller relying on it.
    const rawItems = await attachDisplayEligibleImagePools(withActiveCover)
    setRawNearbyItems(rawItems)

    if (userId && rawItems.length > 0) {
      const itemIds = rawItems.map(i => i.id)
      // Season-scoped, not all-time: the rail is about resurfacing things to
      // do, so a check-off from a prior season must not permanently suppress
      // an item here. Queried independently rather than reading the `season`
      // state var — this fires before loadForMetro's own season fetch
      // resolves, so relying on that state would race. No metro filter: the
      // seasons table is a single global calendar (no metro/city column),
      // same as the theming lookup below.
      const [{ data: checkins }, seasonWindow] = await Promise.all([
        supabase
          .from('check_ins')
          .select('item_id, checked_at')
          .eq('user_id', userId)
          .in('item_id', itemIds),
        getCurrentSeasonWindow(),
      ])
      const inWindow = (checkins ?? []).filter(c =>
        isWithinWindow(c.checked_at, seasonWindow.starts_at, seasonWindow.ends_at)
      )
      setCheckedItemIds(new Set(inWindow.map(c => c.item_id)))
    } else {
      setCheckedItemIds(new Set())
    }
  } catch (e) {
    console.warn('loadNearbyRail error:', e.message)
  } finally {
    setNearbyLoading(false)
  }
}

  async function switchMetro(metro) {
    setSelectedMetro(metro)
    // An actual user pick always resolves the needs_selection state, same
    // as any other explicit choice.
    setNeedsMetroSelection(false)
    // Persist the explicit choice so it wins over GPS-based resolution on
    // every future app open (see SELECTED_METRO_SLUG_KEY / resolveHomeMetro)
    // — an intentional user override must stick until they change it again.
    const slug = metro?.slug ?? metro?.name?.toLowerCase().replace(/\s+metro/i, '').trim()
    if (slug) {
      try {
        await AsyncStorage.setItem(SELECTED_METRO_SLUG_KEY, slug)
      } catch (e) {
        /* persistence optional — selection still works for this session */
      }
    }
    await loadForMetro(metro.id, user?.id, metro.slug)
  }

  async function handleNext10Dismiss() {
    if (!nextTenList) return
    const key = `next10_dismissed_${nextTenList.id}`
    await AsyncStorage.setItem(key, 'true')
    setNextTenDismissed(true)
  }

  // Live tick so countdowns re-render every minute
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60000)
    return () => clearInterval(id)
  }, [])

  // Initial fix for the "Near you right now" rail comes from the shared
  // lib/currentLocation.js store (force:false — reuses another screen's
  // recent-enough fix if one already exists, matching this effect's old
  // "patient" long-race + getLastKnownPositionAsync-fallback behavior when
  // a fresh device fetch is actually needed). init()'s own separate 3s-race
  // fetch (metro auto-selection, zone-banner detection) is untouched — that
  // one has its own reasons to stay fast and is out of scope here.
  useEffect(() => {
    refreshUserLocation(false)
  }, []) // eslint-disable-line

  // Foreground-return / travel re-check for the HOME metro (distinct from
  // the proximity-only rail above) — lib/currentLocation.js's own AppState
  // listener already refreshes the shared userLocation automatically on a
  // background->foreground transition (subject to its 5-minute staleness
  // policy), so this effect just needs to react whenever that shared fix
  // changes: if it now resolves (within MAX_METRO_BOUNDARY_M) to a
  // DIFFERENT active metro than the one currently selected, physical
  // location wins per resolveHomeMetro's precedence, same as at cold
  // start (case 1) — the user has genuinely traveled, so update Home/
  // What's Good's metro and refresh the persisted slug to match, rather
  // than leaving them anchored to wherever they were when the app was
  // last opened.
  //
  // Only triggers on a CHANGE in the physically-nearest metro (tracked via
  // lastResolvedNearestMetroIdRef), never merely on nearest !== selectedMetro
  // — that distinction is what keeps a same-session manual City Picker pick
  // (requirement: session-scoped remote browsing must not be fought against
  // mid-session) intact: picking Vienna while physically in Munich makes
  // nearest !== selectedMetro on every subsequent location tick, but nearest
  // itself (Munich) hasn't changed, so this effect stays quiet. It only acts
  // when the user has genuinely moved to a new physical metro since the last
  // time this ran — including mid-session, matching how Nearby/Right Here
  // already track real position live.
  //
  // Guarded on metros/selectedMetro already being loaded so this only ever
  // fires as a RE-check after init()'s own first resolution, never racing
  // it. No extra hysteresis margin beyond the boundary cutoff itself —
  // every active metro in this dataset (Phoenix/Milwaukee/Denver/Vienna/
  // Munich/Florence) is hundreds to thousands of km from every other one,
  // so ordinary GPS jitter (tens of meters) cannot flip the nearest-metro
  // result near a boundary the way it could for two closely-spaced metros;
  // if metros are ever launched close enough together for that to become a
  // real risk, add a margin then.
  const lastResolvedNearestMetroIdRef = useRef(null)
  useEffect(() => {
    if (!userLocation || metros.length === 0 || !selectedMetro) return
    const nearest = nearestMetroWithinBoundary(userLocation, metros)
    if (!nearest) return
    const nearestChanged = lastResolvedNearestMetroIdRef.current !== null &&
      lastResolvedNearestMetroIdRef.current !== nearest.id
    lastResolvedNearestMetroIdRef.current = nearest.id
    if (!nearestChanged || nearest.id === selectedMetro.id) return
    setSelectedMetro(nearest)
    loadForMetro(nearest.id, user?.id, nearest.slug)
    AsyncStorage.setItem(SELECTED_METRO_SLUG_KEY, nearest.slug).catch(() => {
      /* persistence optional — resolution still correct for this session */
    })
  }, [userLocation, metros, selectedMetro, user])

  // Density tier for the "Near you right now" rail — session-cached by
  // getSessionDensityTier, computed against the full item candidate set
  // (not just what this rail happens to show). See lib/densityTier.js.
  useEffect(() => {
    if (!userLocation) return
    let cancelled = false
    getSessionDensityTier(userLocation).then(result => {
      if (!cancelled && result) setSessionTier(result)
    })
    return () => { cancelled = true }
  }, [userLocation])

  // Nearest 5 unchecked items — recomputed (no re-fetch) whenever location
  // resolves/changes, so a late GPS fix (or a real trip to a new metro)
  // re-sorts the already-loaded candidate pool against the CURRENT fix, not
  // whatever was available at mount. FIX (2026-09-21): this used to call
  // proximitySort directly with includeUniversal:true/maxDistance:null/
  // interleave:true — deliberately mixing in generic, no-coordinate
  // Universal items as "Near You," and (via proximitySort's null-location
  // fallback branch) showing that same generic pool, entirely unsorted,
  // during the window before GPS resolves. selectHomeNearbyCandidates
  // (lib/homeNearYou.js) gives Home the same hasUsableCoordinates +
  // MAX_NEARBY_RADIUS_M guarantees Nearby already has, and returns an
  // honest empty list (no fallback filler) while userLocation is still
  // pending — see that module's doc for the full before/after.
  const nearbyRailItems = useMemo(() => {
    const sorted = selectHomeNearbyCandidates(rawNearbyItems, userLocation)
    return sorted.filter(item => !checkedItemIds.has(item.id)).slice(0, 5)
  }, [rawNearbyItems, userLocation, checkedItemIds])

  // What's Good V1 / "What's the Thing" — behind the `whats_good_v1`
  // feature flag (disabled globally). Now reads the same shared
  // lib/currentLocation.js location as userLocation above (previously its
  // own independent fetch — see lib/useWhatsGood.js's module doc), so a
  // Home pull-to-refresh or the 5-minute foreground-stale check updates it
  // too. No effect on existing Home Rail behavior when the flag is off.
  const homeRailItemIds = useMemo(() => nearbyRailItems.map(item => item.id), [nearbyRailItems])
  const whatsGood = useWhatsGood({
    userId: user?.id ?? null,
    rawNearbyItems,
    homeRailItemIds,
    // 2026-09-21 follow-up field fix — the CURRENT authoritative resolved
    // metro (kept in sync with lib/metroSelection.js's
    // nearestMetroWithinBoundary() by the effect above), so the session
    // cache can be invalidated on resolved-metro-identity mismatch, not
    // merely raw GPS distance. See lib/whatsGoodSessionCache.js.
    currentMetroId: selectedMetro?.id ?? null,
    // 2026-09-22 coverage-mode policy fix — reuses this screen's own
    // location classification rather than duplicating it: `userLocation`
    // present means the shared lib/currentLocation.js store already has a
    // real fix ('ready'); `needsMetroSelection` is exactly this screen's
    // own "location denied/unavailable AND no explicit choice" signal (see
    // its declaration above); `selectedMetro` set with neither of those
    // true means an explicit persisted choice is standing in for GPS
    // ('unavailable', passed below as explicitMetroChoice so What's Good
    // can evaluate THAT city's own coverage instead of showing nothing).
    locationState: userLocation ? 'ready' : (selectedMetro || needsMetroSelection ? 'unavailable' : 'pending'),
    explicitMetroChoice: selectedMetro,
    navigation,
  })

  // Visit Reminder V1.5 — behind the separate `at_place_checkoff_reminders`
  // flag (disabled globally). Reuses whatsGood.atPlaceItem (the existing
  // approved foreground presence rule) and this screen's own season-scoped
  // checkedItemIds rather than re-deriving either. See
  // lib/visitDetection/useAtPlaceReminder.js.
  useAtPlaceReminder({
    userId: user?.id ?? null,
    atPlaceItem: whatsGood.atPlaceItem,
    isCheckedOff: whatsGood.atPlaceItem ? checkedItemIds.has(whatsGood.atPlaceItem.id) : false,
  })

  // Monday recap trigger — fires once on mount, entirely fire-and-forget
  useEffect(() => {
    async function checkMondayRecap() {
      try {
        // Only run on Monday (local time)
        if (new Date().getDay() !== 1) return

        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        const uid = user.id

        // Last week: Monday 00:00 → Sunday 23:59 local time
        const now = new Date()
        const lastMonday = new Date(now)
        lastMonday.setDate(now.getDate() - 7)
        lastMonday.setHours(0, 0, 0, 0)
        const lastSunday = new Date(lastMonday)
        lastSunday.setDate(lastMonday.getDate() + 6)
        lastSunday.setHours(23, 59, 59, 999)
        const weekStartDate = lastMonday.toISOString().split('T')[0]

        // Check if already viewed or dismissed this recap
        const { data: existing } = await supabase
          .from('user_recap_views')
          .select('id')
          .eq('user_id', uid)
          .eq('recap_week_start', weekStartDate)
          .maybeSingle()
        if (existing) return

        // Check for check-ins last week
        const { data: lastWeekCIs } = await supabase
          .from('check_ins')
          .select('id, points_awarded, item_id')
          .eq('user_id', uid)
          .gte('checked_at', lastMonday.toISOString())
          .lte('checked_at', lastSunday.toISOString())
        if (!lastWeekCIs?.length) return

        // points_awarded is the sole source of truth, matching lib/points.js
        // getUserLifetimePoints/getWeeklyPoints exactly (and ProfileScreen's
        // weekly recap). A difficulty*multiplier fallback here double-counts:
        // every fan-out row (lib/checkInFanOut.js) deliberately carries a
        // null/zero points_awarded to avoid inflating the total.
        const pts = lastWeekCIs.reduce((sum, ci) => sum + (ci.points_awarded ?? 0), 0)

        const { data: streakRow } = await supabase
          .from('users')
          .select('current_streak')
          .eq('id', uid)
          .single()
        const streakVal = streakRow?.current_streak ?? 0

        // Mark as viewed
        await supabase.from('user_recap_views').insert({
          user_id:           uid,
          recap_week_start:  weekStartDate,
          viewed_at:         new Date().toISOString(),
        })

        // Show modal after short delay so home screen renders first.
        // count is distinct items checked, not rows — fan-out
        // (lib/checkInFanOut.js) mirrors one check-in into every other
        // active list containing the item, inflating raw row count.
        const distinctCount = new Set(lastWeekCIs.map(ci => ci.item_id).filter(id => id != null)).size
        setTimeout(() => {
          setRecapModal({
            count:        distinctCount,
            pts,
            streak:       streakVal,
            weekStartIso: lastMonday.toISOString(),
            viewRowWeekStart: weekStartDate,
            uid,
          })
        }, 500)
      } catch {
        // Fail silently — never block app load
      }
    }
    checkMondayRecap()
  }, []) // eslint-disable-line

  // Calendar-day comparison — how many full days remain including the end date itself
  function calDaysLeft(endsAt) {
    if (!endsAt) return null
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const end   = new Date(`${endsAt}T00:00:00`); end.setHours(0, 0, 0, 0)
    return Math.round((end - today) / (1000 * 60 * 60 * 24))
  }

  // Returns a formatted time-left string; null if ended
  function timeLeft(endsAt) {
    if (!endsAt) return null
    const days = calDaysLeft(endsAt)
    if (days < 0) return null
    if (days === 0) {
      // Ending today — hour/minute countdown to end of day
      const endOfDay = new Date(`${endsAt}T23:59:59`)
      const msLeft   = endOfDay - new Date()
      if (msLeft <= 0) return 'Ends tonight'
      const h = Math.floor(msLeft / 3600000)
      const m = Math.floor((msLeft % 3600000) / 60000)
      return h > 0 ? `${h}h ${m}m left` : `${m}m left`
    }
    if (days === 1) return '1 day left'
    return `${days} days left`
  }

  // True when a list is ending within N days (for highlighting)
  function isUrgent(endsAt, withinDays = 7) {
    if (!endsAt) return false
    const days = calDaysLeft(endsAt)
    return days !== null && days >= 0 && days <= withinDays
  }

  function isEnded(endsAt) {
    if (!endsAt) return false
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const end   = new Date(`${endsAt}T00:00:00`); end.setHours(0, 0, 0, 0)
    return end < today
  }

  function formatEndedDate(endsAt) {
    if (!endsAt) return 'Ended'
    const d = new Date(`${endsAt}T12:00:00`)
    return `Ended ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
  }

  // Derived metro values — always computed from selectedMetro, never hardcoded
  const metroSlug = selectedMetro?.slug
    ?? selectedMetro?.name?.toLowerCase().replace(/\s+metro/i, '').trim()
    ?? 'phoenix'
  const metroDisplayName = selectedMetro?.name?.replace(' Metro', '') ?? 'Phoenix'

  const now = new Date()

  // Official lists bucketed into three states. Start-date cutoff is
  // midnight (T00:00:00), matching isEnded()'s own midnight cutoff below —
  // a T12:00:00 (noon) cutoff previously meant a list starting "today"
  // didn't count as started until local noon, showing "Coming soon" all
  // morning on its actual launch day.
  const activeOfficial = officialLists
    .filter(l => !isEnded(l.ends_at) && (!l.starts_at || new Date(`${l.starts_at}T00:00:00`) <= now))
    .sort((a, b) => new Date(a.ends_at || '9999-12-31') - new Date(b.ends_at || '9999-12-31'))

  const upcomingOfficial = officialLists
    .filter(l => l.starts_at && new Date(`${l.starts_at}T00:00:00`) > now)
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))

  const endedOfficial = officialLists
    .filter(l => isEnded(l.ends_at))
    .sort((a, b) => new Date(b.ends_at) - new Date(a.ends_at))

  // Home shows at most 2 official lists: current (or most recently ended) + next upcoming
  const currentOnHome  = activeOfficial[0] ?? endedOfficial[0] ?? null
  const upcomingOnHome = upcomingOfficial[0] ?? null
  const homeOfficialLists = [currentOnHome, upcomingOnHome].filter(Boolean)
  const homeOfficialIds   = new Set(homeOfficialLists.map(l => l.id))

  // Past official = all ended ones not shown on home
  const pastOfficialLists = endedOfficial.filter(l => !homeOfficialIds.has(l.id))

  const activeLists     = lists.filter(l => !isEnded(l.ends_at))
  const endedLists      = lists.filter(l => isEnded(l.ends_at))
  const totalPastCount  = endedLists.length + pastOfficialLists.length

  // Seasonal card progress ("N of M") — computed inside loadForMetro now
  // (see the fold-in right after setOfficialLists above), not here. A
  // separate effect keyed on currentOnHome's own id/starts_at/ends_at
  // never re-fires on a plain check-off (those values don't change), so
  // the count went stale on every return to Home despite loadForMetro
  // itself re-running via the focus listener below. Folding the fetch
  // into that one existing reload path means it now refreshes wherever
  // loadForMetro already does, with nothing new to keep in sync.

  // Seasonal card rank — reuses useLeaderboard as-is (not modifying it, per
  // instruction). NOTE: this mounts useLeaderboard's Realtime check_ins
  // subscription for this list onto Home — the most-opened screen in the
  // app, which carried no such subscription before B1. Accepted since the
  // hook is the only interface to rank; flagging here so it's findable if
  // connection churn or battery use ever becomes a question.
  const { entries: seasonalLbEntries } = useLeaderboard(currentOnHome?.id ?? null)
  const seasonalRank = (() => {
    if (!user?.id) return null
    const idx = seasonalLbEntries.findIndex(e => e.userId === user.id)
    return idx >= 0 ? idx + 1 : null
  })()

  // ── Crew line — the one personal/crew list with other members, picked by
  // member count first (a bigger crew is a stronger rivalry signal than one
  // where the user is nearly alone), then most-recent check-in activity as
  // a tiebreaker among lists sharing the top member count. Solo lists
  // (memberCount === 1) and joined official lists never qualify — rivalry
  // only reads as real when it's people you actually invited. ─────────────
  useEffect(() => {
    const candidates = activeLists.filter(l => l.memberCount > 1)
    if (!candidates.length) { setCrewListId(null); return }

    const maxMembers  = Math.max(...candidates.map(l => l.memberCount))
    const topByMembers = candidates.filter(l => l.memberCount === maxMembers)
    if (topByMembers.length === 1) { setCrewListId(topByMembers[0].id); return }

    let cancelled = false
    ;(async () => {
      const ids = topByMembers.map(l => l.id)
      const { data } = await supabase
        .from('check_ins')
        .select('checked_at, list_items!inner(list_id)')
        .in('list_items.list_id', ids)
        .order('checked_at', { ascending: false })
        .limit(1)
      if (cancelled) return
      setCrewListId(data?.[0]?.list_items?.list_id ?? topByMembers[0].id)
    })()
    return () => { cancelled = true }
  }, [activeLists])

  const crewList = lists.find(l => l.id === crewListId) ?? null
  const { entries: crewEntries } = useLeaderboard(crewListId)

  // Every branch here is a genuine rivalry status, never a title+countdown
  // repeat of the Lists tab. Rank #1 and a tie both used to fall through to
  // null (hiding the whole card) — but those are exactly the states a
  // brand-new or lightly-used crew list sits in most of the time, so that
  // hid the card for legitimately good crew lists, not just the redundant-
  // countdown case it was meant to catch. Only returns null when there's
  // truly no one to compare against yet (entries haven't loaded).
  function crewRivalryLine(list) {
    if (!list || !crewEntries.length) return null

    if (crewEntries.every(e => (e.score ?? 0) === 0)) {
      return 'Be the first to check something off'
    }

    const idx = crewEntries.findIndex(e => e.userId === user?.id)
    if (idx < 0) return null
    if (idx === 0) return "You're in the lead"

    const ahead = crewEntries[idx - 1]
    const aheadName = (ahead?.displayName ?? '').split(' ')[0] || ahead?.displayName || 'them'
    const gap = (ahead?.score ?? 0) - (crewEntries[idx]?.score ?? 0)
    return gap > 0 ? `You're ${gap} behind ${aheadName}` : `Tied with ${aheadName}`
  }
  const crewRivalryText = crewRivalryLine(crewList)

  // ── "More [Metro] lists" — the metro's other live official lists, minus
  // whatever's already shown as the seasonal hero/upcoming card above.
  // Batch item-count + season-window-aware progress in one pass each,
  // same pattern as CreatorProfileScreen's checked-state query. ───────────
  useEffect(() => {
    const currentId  = currentOnHome?.id ?? null
    const upcomingId = upcomingOnHome?.id ?? null
    // Not gated on starts_at — a themed list that hasn't started yet still
    // belongs here (marked "Starts {date}"), same as the hero card's own
    // upcoming state. Excluding not-yet-started lists meant every one of
    // Phoenix's Fall lists — all sharing the same start date as Fall
    // itself — was invisible right up until the day it went live,
    // regardless of whether it already had items.
    const candidates = officialLists.filter(l =>
      l.id !== currentId && l.id !== upcomingId && !isEnded(l.ends_at)
    )
    if (!candidates.length) { setThemedLists([]); return }
    let cancelled = false
    ;(async () => {
      const ids = candidates.map(l => l.id)
      // Bonus Drops excluded from every count/rank below — "X of M" for a
      // themed list must match what the list itself shows once opened.
      const { data: allLiRows } = await supabase.from('list_items').select('list_id, item_id, is_bonus_drop').in('list_id', ids)
      const liRows = (allLiRows ?? []).filter(li => !li.is_bonus_drop)
      const countMap = {}
      liRows.forEach(li => { countMap[li.list_id] = (countMap[li.list_id] ?? 0) + 1 })

      const checkedMap = {}
      const rankMap = {}
      if (user?.id) {
        const itemIds = [...new Set(liRows.map(li => li.item_id).filter(Boolean))]
        if (itemIds.length) {
          // Rank is by raw check-in count, not the streak-bonus effective-
          // points formula LeaderboardScreen/useLeaderboard use — computing
          // the full formula for six lists in a batch would mean a second,
          // parallel leaderboard engine outside that hook. Good enough for
          // a secondary rail badge; can occasionally differ from the real
          // leaderboard for the same list.
          const [{ data: checkins }, { data: members }] = await Promise.all([
            supabase.from('check_ins').select('user_id, item_id, checked_at').in('item_id', itemIds),
            supabase.from('list_members').select('list_id, user_id').in('list_id', ids),
          ])
          candidates.forEach(l => {
            const listItemIds = new Set(liRows.filter(li => li.list_id === l.id).map(li => li.item_id))
            // `candidates` is officialLists filtered client-side (see the
            // useEffect above) — officialLists itself is always the
            // result of loadForMetro's own .eq('metro_id', metroId) query,
            // so every `l` here shares the metro whose timezone was just
            // resolved into metroTimezone state by that same load.
            const inWindow = (checkins ?? []).filter(c => listItemIds.has(c.item_id) && isWithinWindow(c.checked_at, l.starts_at, l.ends_at, metroTimezone))

            const mine = new Set(inWindow.filter(c => c.user_id === user.id).map(c => c.item_id))
            checkedMap[l.id] = mine.size

            if (mine.size > 0) {
              const memberIds = (members ?? []).filter(m => m.list_id === l.id).map(m => m.user_id)
              // Count distinct items per user (matches "N of M" semantics,
              // not raw check-in rows).
              const itemsByUser = {}
              inWindow.forEach(c => {
                if (!itemsByUser[c.user_id]) itemsByUser[c.user_id] = new Set()
                itemsByUser[c.user_id].add(c.item_id)
              })
              const myCount = itemsByUser[user.id]?.size ?? 0
              const ahead = memberIds.filter(uid => uid !== user.id && (itemsByUser[uid]?.size ?? 0) > myCount).length
              rankMap[l.id] = ahead + 1
            }
          })
        }
      }

      if (cancelled) return
      const today = new Date()
      setThemedLists(candidates.map(l => ({
        ...l,
        itemCount: countMap[l.id] ?? 0,
        joined:    joinedIds.has(l.id),
        checked:   checkedMap[l.id] ?? 0,
        rank:      rankMap[l.id] ?? null,
        upcoming:  !!(l.starts_at && new Date(`${l.starts_at}T00:00:00`) > today),
      })))
    })()
    return () => { cancelled = true }
  }, [officialLists, currentOnHome?.id, upcomingOnHome?.id, user?.id, joinedIds])

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={AMBER} size="large" />
      </View>
    )
  }

  // No persisted choice AND location denied/unavailable/timed out — there
  // is genuinely no metro to show. Render an honest "choose your city"
  // prompt rather than falling through to the normal render below, which
  // reads selectedMetro?.name via `?? 'Phoenix'`/`?? 'your city'` fallbacks
  // in a few places (see metroDisplayName) — those are fine as display-only
  // labels once a real metro is loading, but must never be reached with no
  // metro selected at all, since that would effectively show Phoenix's
  // branding with none of its actual content loaded. Reuses the existing
  // CityPickerModal / switchMetro() mechanism used everywhere else in this
  // screen for manual metro changes — no new picker UI.
  if (needsMetroSelection && !selectedMetro) {
    return (
      <View style={styles.center}>
        <StatusBar barStyle={STATUS_BAR} />
        <Text style={{ color: TEXT, fontSize: 18, fontWeight: '600', textAlign: 'center', paddingHorizontal: 32 }}>
          Choose your city
        </Text>
        <Text style={{ color: MUTED, fontSize: 14, textAlign: 'center', paddingHorizontal: 32, marginTop: 8, marginBottom: 20 }}>
          We couldn't find your location. Pick a city to see local lists and events.
        </Text>
        <TouchableOpacity
          onPress={() => setMetroPickerVisible(true)}
          style={{ backgroundColor: AMBER, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 24 }}
        >
          <Text style={{ color: '#1a1a1a', fontWeight: '700', fontSize: 15 }}>Choose your city</Text>
        </TouchableOpacity>
        <CityPickerModal
          visible={metroPickerVisible}
          metros={metros}
          colors={colors}
          onSelect={(metro) => { setMetroPickerVisible(false); switchMetro(metro) }}
          onClose={() => setMetroPickerVisible(false)}
        />
      </View>
    )
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ ...styles.content, paddingTop: insets.top + 12 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            // Manual refresh always forces a fresh device GPS fix first —
            // never just re-runs queries against whatever coords happen to
            // be cached. userLocation updating (from the shared store)
            // cascades into nearbyRailItems/sessionTier/What's Good
            // automatically since they're all derived from it.
            setRefreshing(true)
            const refreshes = [refreshUserLocation(true)]
            if (selectedMetro) {
              refreshes.push(loadForMetro(selectedMetro.id, user?.id, selectedMetro.slug))
            }
            Promise.all(refreshes).finally(() => setRefreshing(false))
          }}
          tintColor={AMBER}
        />
      }
      showsVerticalScrollIndicator={false}
    >
      <StatusBar barStyle={STATUS_BAR} />

      {/* ══════════════════════════════════════════════════════════════
          Home — the single top-of-Home experience for every user,
          authenticated or anonymous (the old flag-gated legacy branch was
          removed; see lib/useWhatsGood.js's module doc). See
          lib/homeHeroLayout.js for the hero-priority rule (destination >
          at-place > none) that decides what renders here on any given load.
          ══════════════════════════════════════════════════════════════ */}
      {(() => {
        const tier2       = getTierByName(userInsiderTier)
        const tierIdx2     = ['Starter', 'Explorer', 'Local', 'Insider', 'Legend'].indexOf(userInsiderTier)
        const filledDots2 = tierIdx2 < 0 ? 1 : tierIdx2 + 1
        const metroLabel2 = selectedMetro?.name?.replace(' Metro', '') ?? '—'
        const multiMetro2 = metros.length > 1

        function openMetroPicker2() {
          if (!multiMetro2) return
          setMetroPickerVisible(true)
        }

        const heroLayout = deriveHomeHeroLayout({
          hasDestination: Boolean(nearbyZone && !zoneBannerDismissed),
          hasAtPlace: Boolean(whatsGood.atPlaceItem),
        })
        const nearYouCompactItems = selectNearYouCompactRows(nearbyRailItems, undefined, whatsGood.atPlaceItem?.id ?? null)

        return (
          <View>
            <CompactHomeHeader
              colors={colors}
              isDark={isDark}
              onToggleTheme={toggleTheme}
              userStreak={userStreak}
              showThisWeek={Boolean(user) && !isNarrowHeader}
              onThisWeekPress={() => navigation.navigate('WeeklyRecap')}
              metroLabel={metroLabel2}
              multiMetro={multiMetro2}
              onMetroPress={openMetroPicker2}
              userInsiderTier={userInsiderTier}
              tierColor={tier2.text}
              tierProgressFilledDots={filledDots2}
              onProfilePress={() => navigation.navigate('ProfileTab')}
              showProfileStatus={Boolean(user)}
            />

            {heroLayout.primaryHero === 'destination' && (
              <DestinationHero
                zone={nearbyZone}
                colors={colors}
                onPress={() => handleDestinationZoneTap(nearbyZone)}
                onDismiss={() => setZoneBannerDismissed(true)}
              />
            )}

            {heroLayout.primaryHero === 'at_place' && (
              <WhatsTheThingHero item={whatsGood.atPlaceItem} navigation={navigation} colors={colors} userId={user?.id ?? null} />
            )}

            {heroLayout.showAtPlaceCompact && whatsGood.atPlaceItem && (
              <WhatsTheThingHero item={whatsGood.atPlaceItem} navigation={navigation} colors={colors} compact />
            )}

            {heroLayout.showNearYouCompact && (
              <NearYouCompact
                items={nearYouCompactItems}
                colors={colors}
                userId={user?.id ?? null}
                navigation={navigation}
                onItemPress={(item) => navigation.navigate('ItemDetail', { item })}
                onSeeAllPress={() => navigation.navigate('NearbyTab')}
              />
            )}

            <WhatsGoodDiscovery items={whatsGood.items} navigation={navigation} colors={colors} userId={user?.id ?? null} />
          </View>
        )
      })()}

      {homeOfficialLists.length > 0 && (
        <>
          <View style={styles.sectionHeaderBlock}>
            <Text style={styles.sectionLabel}>Seasonal lists</Text>
          </View>

          {homeOfficialLists.map(list => {
            const joined   = joinedIds.has(list.id)
            const ended    = isEnded(list.ends_at)
            const upcoming = !ended && list.starts_at && new Date(`${list.starts_at}T00:00:00`) > now

            if (ended) {
              return (
                <TouchableOpacity
                  key={list.id}
                  style={styles.endedOfficialCard}
                  onPress={() => navigation.navigate('List', { listId: list.id, title: list.title })}
                  activeOpacity={0.88}
                >
                  <View style={styles.endedOfficialLeft}>
                    <Text style={styles.officialEmoji}>{list.cover_emoji ?? '🏁'}</Text>
                  </View>
                  <View style={styles.officialCardBody}>
                    <Text style={styles.officialTitle}>{list.title}</Text>
                    <Text style={styles.endedMeta}>{formatEndedDate(list.ends_at)}</Text>
                  </View>
                  <View style={styles.endedBadge}>
                    <Text style={styles.endedBadgeText}>Results →</Text>
                  </View>
                </TouchableOpacity>
              )
            }

            if (upcoming) {
              const startLabel = new Date(`${list.starts_at}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              return (
                <TouchableOpacity
                  key={list.id}
                  style={styles.upcomingOfficialCard}
                  // Deliberately never joins or navigates in here — the old
                  // behavior auto-joined a non-member and opened the full,
                  // fully-revealed item list before the list had even
                  // started. An upcoming list stays a preview until its own
                  // start date; this is just an informative tap, not an entry.
                  onPress={() => Alert.alert(
                    list.title,
                    `This list opens ${startLabel} — check back then!`
                  )}
                  activeOpacity={0.88}
                >
                  <View style={styles.upcomingOfficialLeft}>
                    <Text style={styles.officialEmoji}>{list.cover_emoji ?? '📋'}</Text>
                  </View>
                  <View style={styles.officialCardBody}>
                    <Text style={styles.officialTitle}>{list.title}</Text>
                    <Text style={styles.upcomingMeta}>
                      Starts {startLabel}
                    </Text>
                  </View>
                  <View style={styles.upcomingBadge}>
                    <Text style={styles.upcomingBadgeText}>Coming soon</Text>
                  </View>
                </TouchableOpacity>
              )
            }

            return (
              <TouchableOpacity
                key={list.id}
                style={styles.heroCard}
                // Always navigate, never auto-join — a non-joined tap must
                // stay read-only (join gate belongs at first check-off
                // attempt, not here; auto-inserting list_members on tap
                // also pollutes membership data used for activation
                // measurement).
                onPress={() => navigation.navigate('List', { listId: list.id, title: list.title, heroImage: heroImage ?? undefined })}
                activeOpacity={0.92}
              >
                {heroImage ? (
                  <ImageBackground
                    source={{ uri: heroImage }}
                    style={styles.heroCardImageBg}
                    borderRadius={20}
                  >
                    <LinearGradient
                      colors={['rgba(0,0,0,0.15)', 'rgba(0,0,0,0.72)']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 0, y: 1 }}
                      style={styles.heroCardGradient}
                    >
                      <Text style={styles.heroCardLabel}>SEASONAL LIST</Text>
                      <Text style={styles.heroCardTitle}>{list.title}</Text>
                      <View style={styles.heroCardPillRow}>
                        {list.ends_at && (
                          <View style={styles.heroCardPill}>
                            <Text style={styles.heroCardPillText}>{timeLeft(list.ends_at)}</Text>
                          </View>
                        )}
                        {/* TODO: item count */}
                      </View>
                    </LinearGradient>
                  </ImageBackground>
                ) : (
                  <LinearGradient
                    colors={[season?.gradient_start ?? '#1A1A2E', season?.gradient_end ?? '#2E1A4A']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.heroCardGradient}
                  >
                    <Text style={styles.heroCardLabel}>SEASONAL LIST</Text>
                    <Text style={styles.heroCardTitle}>{list.title}</Text>
                    <View style={styles.heroCardPillRow}>
                      {list.ends_at && (
                        <View style={styles.heroCardPill}>
                          <Text style={styles.heroCardPillText}>{timeLeft(list.ends_at)}</Text>
                        </View>
                      )}
                      {/* TODO: item count */}
                    </View>
                  </LinearGradient>
                )}

                <View style={styles.heroCardCTA}>
                  <Text style={styles.heroCardCTAText}>
                    {joined
                      ? (seasonalCounts.total > 0 && seasonalCounts.checked >= seasonalCounts.total)
                        ? `${seasonalCounts.checked} of ${seasonalCounts.total} — you finished ${list.title.replace(/\s—\s.+$/, '')}`
                        : [
                            `${seasonalCounts.checked} of ${seasonalCounts.total}`,
                            timeLeft(list.ends_at),
                            seasonalRank ? `#${seasonalRank} in ${metroDisplayName}` : null,
                          ].filter(Boolean).join(' · ')
                      : 'See the list →'}
                  </Text>
                </View>
              </TouchableOpacity>
            )
          })}
        </>
      )}

      {/* ── Crew line — rivalry visible without navigating away. Only for a
          list with other real members and only when there's an actual gap
          to report; solo lists, joined official lists, and a rank-#1/tied
          state all render nothing here (list management and plain
          title+countdown both already live in the Lists tab). ── */}
      {crewList && crewRivalryText && (
        <>
          <View style={styles.sectionHeaderBlock}>
            <Text style={styles.sectionLabel}>With your crew</Text>
          </View>
          <TouchableOpacity
            style={styles.crewLineCard}
            onPress={() => navigation.navigate('List', { listId: crewList.id, title: crewList.title })}
            activeOpacity={0.85}
          >
            <View style={styles.crewAvatarStack}>
              {(listMemberMap[crewList.id] ?? []).slice(0, 4).map(m => (
                <View key={m.id} style={styles.crewAvatarMini}>
                  <Text style={styles.crewAvatarMiniText}>{m.initial}</Text>
                </View>
              ))}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.crewLineTitle} numberOfLines={1}>{crewList.title}</Text>
              <Text style={styles.crewLineSub}>{crewRivalryText}</Text>
            </View>
            <Text style={styles.listChevron}>→</Text>
          </TouchableOpacity>
        </>
      )}

      {/* ── "More [Metro] lists" — the metro's other live official lists,
          minus whatever's already the seasonal hero/upcoming card above.
          Hidden entirely when the metro has none yet. ── */}
      {themedLists.length > 0 && (
        <>
          <View style={styles.sectionHeaderBlock}>
            <Text style={styles.sectionLabel}>More {metroDisplayName} lists</Text>
            <Text style={styles.sectionSub}>Pick a smaller challenge</Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.themedRailContent}
          >
            {themedLists.map(list => {
              const startLabel = list.starts_at
                ? new Date(`${list.starts_at}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                : null
              const footerText = list.joined
                ? [
                    `${list.checked} of ${list.itemCount}`,
                    (list.checked > 0 && list.rank) ? `#${list.rank} in ${metroDisplayName}` : null,
                  ].filter(Boolean).join(' · ')
                : `${list.itemCount} item${list.itemCount === 1 ? '' : 's'}`

              // hero_image_url is selected in the officialLists query above
              // (themedLists is derived from it) and renders below whenever
              // an admin has set one for this list; falls back to a solid
              // accent card otherwise.
              const cardBody = (
                <>
                  <View style={styles.themedCardTitleBlock}>
                    <Text style={styles.themedCardTitle} numberOfLines={2}>{list.title}</Text>
                  </View>
                  <View style={styles.themedCardFooterRow}>
                    {list.upcoming ? (
                      <View style={styles.themedCardUpcomingBadge}>
                        <Text style={styles.themedCardUpcomingBadgeText}>Starts {startLabel}</Text>
                      </View>
                    ) : (
                      <Text style={styles.themedCardMeta} numberOfLines={1}>{footerText}</Text>
                    )}
                    <Text style={styles.themedCardChevron}>›</Text>
                  </View>
                </>
              )

              return (
                <TouchableOpacity
                  key={list.id}
                  style={styles.themedCardWrap}
                  activeOpacity={0.88}
                  onPress={() => list.upcoming
                    ? Alert.alert(list.title, `This list opens ${startLabel} — check back then!`)
                    : navigation.navigate('List', { listId: list.id, title: list.title })
                  }
                >
                  {list.hero_image_url ? (
                    <ImageBackground source={{ uri: list.hero_image_url }} style={styles.themedCard}>
                      <LinearGradient
                        colors={['rgba(0,0,0,0.15)', 'rgba(0,0,0,0.72)']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 0, y: 1 }}
                        style={styles.themedCardScrim}
                      >
                        {cardBody}
                      </LinearGradient>
                    </ImageBackground>
                  ) : (
                    <View style={[styles.themedCard, styles.themedCardScrim, { backgroundColor: themedListAccent(list.title, list.id) }]}>
                      {cardBody}
                    </View>
                  )}
                </TouchableOpacity>
              )
            })}
          </ScrollView>
        </>
      )}

      {/* ── 2×2 navigation grid (always 2×2, bottom-right swaps on creator availability) ── */}
      <View style={styles.navGrid}>
        <View style={styles.navGridRow}>
          <TouchableOpacity
            style={styles.navTileWrap}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('BrowseLists', { citySlug: metroSlug, metroName: metroDisplayName })}
          >
            <View style={styles.navTile}>
              <View style={[styles.navTileIconWrap, { backgroundColor: '#378ADD' }]}>
                <Text style={styles.navTileIconEmoji}>📋</Text>
              </View>
              <View style={styles.navTileFooterRow}>
                <Text style={styles.navTileLabel} numberOfLines={1}>List Templates</Text>
                <Text style={styles.navTileChevron}>›</Text>
              </View>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.navTileWrap}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('Destinations', { metro: selectedMetro })}
          >
            <View style={styles.navTile}>
              <View style={[styles.navTileIconWrap, { backgroundColor: '#D85A30' }]}>
                <Text style={styles.navTileIconEmoji}>📍</Text>
              </View>
              <View style={styles.navTileFooterRow}>
                <Text style={styles.navTileLabel} numberOfLines={1}>Destinations</Text>
                <Text style={styles.navTileChevron}>›</Text>
              </View>
            </View>
          </TouchableOpacity>
        </View>
        <View style={styles.navGridRow}>
          {featuredCreators.length > 0 ? (
            <TouchableOpacity
              style={styles.navTileWrap}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('CreatorList', { metro: selectedMetro })}
            >
              <View style={styles.navTile}>
                <View style={[styles.navTileIconWrap, { backgroundColor: '#7A4DB3' }]}>
                  <Text style={styles.navTileIconEmoji}>✨</Text>
                </View>
                <View style={styles.navTileFooterRow}>
                  <Text style={styles.navTileLabel} numberOfLines={1}>Creators</Text>
                  <Text style={styles.navTileChevron}>›</Text>
                </View>
              </View>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.navTileWrap}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('NearbyTab')}
            >
              <View style={styles.navTile}>
                <View style={[styles.navTileIconWrap, { backgroundColor: '#1D9E75' }]}>
                  <Text style={styles.navTileIconEmoji}>🗺️</Text>
                </View>
                <View style={styles.navTileFooterRow}>
                  <Text style={styles.navTileLabel} numberOfLines={1}>Explore Nearby</Text>
                  <Text style={styles.navTileChevron}>›</Text>
                </View>
              </View>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.navTileWrap}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('LocalGuides', { metro: selectedMetro })}
          >
            <View style={styles.navTile}>
              <View style={[styles.navTileIconWrap, { backgroundColor: '#E8A020' }]}>
                <Text style={styles.navTileIconEmoji}>🏙️</Text>
              </View>
              <View style={styles.navTileFooterRow}>
                <Text style={styles.navTileLabel} numberOfLines={1}>Local Guides</Text>
                <Text style={styles.navTileChevron}>›</Text>
              </View>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Featured editorial card ── */}
      {currentOnHome && (
        <TouchableOpacity
          style={styles.editorialCard}
          activeOpacity={0.88}
          onPress={() => navigation.navigate('List', {
            listId: currentOnHome.id,
            title:  currentOnHome.title.replace(/\s—\s.+$/, ''),
          })}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.editorialLabel}>FEATURED</Text>
            <Text style={styles.editorialTitle}>{currentOnHome.title.replace(/\s—\s.+$/, '')}</Text>
            <Text style={styles.editorialSub}>{'The ultimate local checklist for ' + (selectedMetro?.name?.replace(' Metro', '') ?? 'your city')}</Text>
          </View>
          <Text style={styles.editorialChevron}>›</Text>
        </TouchableOpacity>
      )}

      {totalPastCount > 0 && (
        <TouchableOpacity
          style={styles.pastListsBtn}
          onPress={() => navigation.navigate('PastLists', {
            userId:          user?.id ?? null,
            metroId:         selectedMetro?.id ?? null,
          })}
          activeOpacity={0.85}
        >
          <View style={styles.pastListAccent} />
          <Text style={styles.pastListsBtnText}>Past lists</Text>
          <View style={styles.pastListsBtnRight}>
            <Text style={styles.pastListsBtnCount}>{totalPastCount}</Text>
            <Text style={styles.pastListsBtnArrow}>→</Text>
          </View>
        </TouchableOpacity>
      )}

      {!user && (
        <TouchableOpacity
          style={styles.signInBanner}
          onPress={() => navigation.navigate('SignIn')}
          activeOpacity={0.88}
        >
          <Text style={styles.signInTitle}>Track progress and challenge friends</Text>
          <Text style={styles.signInText}>Sign in to save your lists, join seasonal lists, and compete with your crew →</Text>
        </TouchableOpacity>
      )}

      {/* Weekly recap teaser — shown on Mondays if user had check-ins last week */}
      <Modal
        visible={!!recapModal}
        transparent
        animationType="slide"
        onRequestClose={() => setRecapModal(null)}
      >
        <TouchableOpacity
          style={styles.signInModalOverlay}
          activeOpacity={1}
          onPress={() => setRecapModal(null)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.recapModalCard}>
            <Text style={styles.recapModalTitle}>Your week in CheckOff</Text>
            <Text style={styles.recapModalStats}>
              {recapModal
                ? [
                    `${recapModal.count} check-in${recapModal.count !== 1 ? 's' : ''}`,
                    recapModal.pts != null ? `${recapModal.pts} points` : null,
                    recapModal.streak > 0 ? `🔥 ${recapModal.streak} week streak` : null,
                  ].filter(Boolean).join(' · ')
                : ''}
            </Text>

            <TouchableOpacity
              style={styles.recapModalPrimary}
              onPress={() => {
                setRecapModal(null)
                navigation.navigate('WeeklyRecap', { weekStart: recapModal?.weekStartIso })
              }}
              activeOpacity={0.88}
            >
              <Text style={styles.recapModalPrimaryText}>View Recap</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.recapModalSecondary}
              onPress={async () => {
                setRecapModal(null)
                // Update the row to record dismissal — fire and forget
                try {
                  await supabase
                    .from('user_recap_views')
                    .update({ dismissed_at: new Date().toISOString() })
                    .eq('user_id', recapModal?.uid)
                    .eq('recap_week_start', recapModal?.viewRowWeekStart)
                } catch { /* non-critical */ }
              }}
            >
              <Text style={styles.recapModalSecondaryText}>Maybe Later</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <CityPickerModal
        visible={metroPickerVisible}
        metros={metros}
        colors={colors}
        onSelect={(metro) => { setMetroPickerVisible(false); switchMetro(metro) }}
        onClose={() => setMetroPickerVisible(false)}
      />

    </ScrollView>
  )
}

function createStyles({ BG, CARD, TEXT, MUTED, LABEL, BORDER, SOFT, SOFT_2, AMBER, NAVY, GREEN, SUCCESS_BG, SUCCESS_BORDER, ENDED_BG, ENDED_BORDER, ENDED_TEXT, CARD_URGENT }) {
 return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },

  content: {
    padding: 20,
    paddingBottom: 40,
  },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BG,
  },

  // ── The Next 10 Banner ──
  next10Banner: {
    backgroundColor: NAVY,
    borderRadius: 16,
    marginBottom: 12,
    padding: 20,
    borderLeftWidth: 3,
    borderLeftColor: AMBER,
  },
  next10Dismiss: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  next10DismissText: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 16,
  },
  next10BannerLabel: {
    color: AMBER,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  next10BannerTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    marginTop: 4,
    paddingRight: 28,
  },
  next10BannerTagline: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    marginTop: 4,
  },
  next10BannerMeta: {
    marginTop: 10,
  },
  next10BannerMetaText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
  },
  next10BannerCTA: {
    backgroundColor: AMBER,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 14,
  },
  next10BannerCTAText: {
    color: NAVY,
    fontSize: 15,
    fontWeight: '700',
  },

  // ── Destination Zone Banner ──
  zoneBanner: {
    backgroundColor: NAVY,
    borderRadius: 16,
    marginBottom: 12,
    padding: 20,
    borderLeftWidth: 3,
    borderLeftColor: GREEN,
  },
  zoneBannerDismiss: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoneBannerDismissText: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 14,
  },
  zoneBannerDebugBadge: {
    color: '#D85A30',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  zoneBannerLabel: {
    color: GREEN,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  zoneBannerTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    paddingRight: 28,
  },
  zoneBannerSub: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    marginTop: 4,
  },
  zoneBannerCTA: {
    marginTop: 14,
    alignSelf: 'flex-start',
    backgroundColor: GREEN,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  zoneBannerCTAText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },

  headerCard: {
    backgroundColor: CARD,
    borderRadius: 28,
    paddingTop: 24,
    paddingBottom: 22,
    paddingHorizontal: 24,
    marginBottom: 0,
    borderWidth: 1.2,
    borderColor: BORDER,
  },

  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },

  logoWrapper: {
    flexShrink: 0,
    flexGrow: 0,
  },

  headerStatusGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
    flexGrow: 0,
    marginLeft: 'auto',
  },

  thisWeekBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: BORDER,
  },
  thisWeekBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: MUTED,
  },

  streakPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#F2EBE0',
    borderWidth: 1,
    borderColor: BORDER,
  },

  streakPillActive: {
    backgroundColor: '#FFF0D6',
    borderColor: '#F0C070',
  },

  streakPillText: {
    fontSize: 12,
    fontWeight: '800',
    color: MUTED,
  },

  streakPillTextActive: {
    color: '#A16A00',
  },

  headerBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: SOFT_2,
    borderWidth: 1,
    borderColor: '#DED3C5',
  },

  headerBadgeText: {
    fontSize: 12,
    color: MUTED,
    fontWeight: '800',
  },

  logo: {
    fontSize: 32,
    lineHeight: 36,
    fontWeight: '900',
    color: AMBER,
    letterSpacing: -1,
  },

  logoOff: {
    color: TEXT,
  },

  tagline: {
    fontSize: 15,
    color: MUTED,
    fontWeight: '400',
    marginTop: 2,
  },

  seasonPill: {
    backgroundColor: SOFT,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#E8C98E',
  },

  seasonPillText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#A16A00',
  },

  sectionHeaderBlock: {
    marginBottom: 10,
  },

  sectionLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.4,
    color: LABEL,
    textTransform: 'uppercase',
    marginTop: 2,
    marginBottom: 6,
  },

  sectionSub: {
    fontSize: 14,
    color: MUTED,
  },

  // ── "Near you right now" rail — B1 ──
  nearbyRailContent: {
    paddingRight: 8,
    paddingBottom: 4,
    marginBottom: 22,
  },

  // Widened from 160 — at 160 the venue name (always the most important
  // part, and always last in the sentence) was the thing that got cut off
  // mid-word. More width per line beats a smaller font (hurts everyone's
  // readability) or a 4th line (breaks the row's compact, uniform height).
  nearbyCard: {
    width: 190,
    minHeight: 108,
    backgroundColor: CARD,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    marginRight: 10,
    justifyContent: 'space-between',
  },

  nearbyCardBody: {
    fontSize: 14,
    fontWeight: '700',
    color: TEXT,
    lineHeight: 19,
  },

  nearbyCardTag: {
    alignSelf: 'flex-start',
    backgroundColor: SOFT,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#E8C98E',
  },

  nearbyCardTagText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#A16A00',
  },

  // "right here" is the strongest signal on the rail — solid AMBER, same
  // treatment as the hero's own primary CTA, instead of the muted pill
  // every other distance gets.
  nearbyCardTagHere: {
    backgroundColor: AMBER,
    borderColor: AMBER,
  },
  nearbyCardTagTextHere: {
    color: NAVY,
  },

  metroStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 6,
    marginBottom: 8,
  },

  metroSelector: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  metroSelectorText: {
    fontSize: 15,
    fontWeight: '600',
    color: TEXT,
  },

  metroChevron: {
    fontSize: 13,
    color: MUTED,
    fontWeight: '600',
  },

  compactStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },

  compactTierLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },

  compactDots: {
    flexDirection: 'row',
    gap: 4,
    alignItems: 'center',
  },

  compactDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },

  pillRow: {
    marginBottom: 22,
    marginHorizontal: -4,
  },

  pill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BORDER,
    marginHorizontal: 4,
    backgroundColor: CARD,
  },

  pillActive: {
    backgroundColor: AMBER,
    borderColor: AMBER,
  },

  pillText: {
    fontSize: 13,
    color: TEXT,
    fontWeight: '700',
  },

  pillTextActive: {
    color: NAVY,
    fontWeight: '800',
  },

  heroCard: {
    width: '100%',
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 14,
  },

  heroCardImageBg: {
    width: '100%',
    borderRadius: 20,
    overflow: 'hidden',
  },

  heroCardGradient: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 20,
  },

  heroCardLabel: {
    color: AMBER,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    opacity: 0.85,
  },

  heroCardTitle: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '900',
    lineHeight: 30,
    marginTop: 6,
  },

  heroCardPillRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },

  heroCardPill: {
    backgroundColor: 'rgba(245,166,35,0.18)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },

  heroCardPillText: {
    color: AMBER,
    fontSize: 12,
    fontWeight: '700',
  },

  heroCardCTA: {
    width: '100%',
    paddingVertical: 14,
    backgroundColor: AMBER,
    alignItems: 'center',
  },

  heroCardCTAText: {
    fontSize: 15,
    fontWeight: '800',
    color: NAVY,
  },

  officialCard: {
    backgroundColor: CARD,
    borderRadius: 20,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1.2,
    borderColor: '#F0D29D',
  },

  officialCardLeft: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: SOFT,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#F0D29D',
  },

  endedOfficialCard: {
    backgroundColor: CARD,
    borderRadius: 20,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: ENDED_BORDER,
  },

  endedOfficialLeft: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: ENDED_BG,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: ENDED_BORDER,
  },

  officialEmoji: {
    fontSize: 24,
  },

  officialCardBody: {
    flex: 1,
  },

  officialTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: TEXT,
  },

  officialMeta: {
    fontSize: 12,
    color: MUTED,
    marginTop: 4,
    fontWeight: '600',
  },

  officialMetaUrgent: {
    color: AMBER,
    fontWeight: '800',
  },

  endedMeta: {
    fontSize: 12,
    color: ENDED_TEXT,
    marginTop: 4,
    fontWeight: '700',
  },

  joinBadge: {
    backgroundColor: AMBER,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },

  joinBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: NAVY,
  },

  joinBadgeJoined: {
    backgroundColor: SUCCESS_BG,
    borderWidth: 1,
    borderColor: SUCCESS_BORDER,
  },

  joinBadgeTextJoined: {
    color: GREEN,
  },

  endedBadge: {
    backgroundColor: ENDED_BG,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: ENDED_BORDER,
  },

  endedBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: ENDED_TEXT,
  },

  crewAvatarStack: {
    flexDirection: 'row',
    gap: -6,
  },

  crewAvatarMini: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: SOFT,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#F0D29D',
    marginRight: -6,
  },

  crewAvatarMiniText: {
    fontSize: 9, fontWeight: '800', color: '#A16A00',
  },

  crewLineCard: {
    backgroundColor: CARD,
    borderRadius: 18,
    padding: 16,
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER,
    gap: 12,
  },
  crewLineTitle: {
    fontSize: 14,
    color: TEXT,
    fontWeight: '800',
  },
  crewLineSub: {
    fontSize: 12,
    color: AMBER,
    fontWeight: '700',
    marginTop: 2,
  },

  themedRailContent: {
    paddingRight: 8,
    paddingTop: 2,
    paddingBottom: 8,
    marginBottom: 22,
  },
  // Wrap carries the border/shadow (matching navTileWrap's treatment) —
  // the gradient itself lives one level in, on themedCard, so the shadow
  // isn't clipped by the gradient's own overflow:hidden-by-necessity edges.
  themedCardWrap: {
    width: 148,
    borderRadius: 16,
    overflow: 'hidden',
    marginRight: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 3,
  },
  // No padding here — this is either the ImageBackground (needs to bleed
  // full-edge so the scrim below covers the whole card, not just an inset
  // rectangle) or, in the no-photo fallback, gets padding added inline
  // alongside its accent backgroundColor.
  themedCard: {
    flex: 1,
    minHeight: 132,
  },
  // Same stops as the seasonal hero's own scrim — this is what makes six
  // different photos read as one system instead of six different apps.
  // Never tuned per-card.
  themedCardScrim: {
    flex: 1,
    padding: 14,
  },
  // Fixed height regardless of a 1-line vs 2-line title, so the footer
  // below always sits the same distance down — "Patio Season" and
  // "Kid-Friendly Weekends" no longer wrap the card content differently.
  themedCardTitleBlock: {
    minHeight: 38,
    justifyContent: 'flex-start',
  },
  themedCardTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
    lineHeight: 19,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  themedCardFooterRow: {
    marginTop: 'auto',
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 6,
  },
  themedCardMeta: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.85)',
    flexShrink: 1,
  },
  themedCardChevron: {
    fontSize: 18,
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '700',
  },
  themedCardUpcomingBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.32)',
  },
  themedCardUpcomingBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFFFFF',
  },

  pastListsBtn: {
    backgroundColor: CARD,
    borderRadius: 18,
    padding: 16,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: ENDED_BORDER,
    gap: 12,
  },

  pastListsBtnText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    color: TEXT,
  },

  pastListsBtnRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  pastListsBtnCount: {
    fontSize: 13,
    fontWeight: '800',
    color: ENDED_TEXT,
    backgroundColor: ENDED_BG,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: ENDED_BORDER,
    overflow: 'hidden',
  },

  pastListsBtnArrow: {
    fontSize: 17,
    color: MUTED,
    fontWeight: '700',
  },

  // Deliberately neutral, not INFO_* blue — a not-yet-open list shouldn't
  // out-compete the active season's own amber CTA directly above it. The
  // active hero is the one colorful element on the page; this recedes like
  // everything else.
  upcomingOfficialCard: {
    backgroundColor: CARD,
    borderRadius: 20,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: BORDER,
  },

  upcomingOfficialLeft: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: SOFT_2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: BORDER,
  },

  upcomingMeta: {
    fontSize: 12,
    color: MUTED,
    fontWeight: '700',
    marginTop: 2,
  },

  upcomingBadge: {
    backgroundColor: SOFT_2,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: BORDER,
  },

  upcomingBadgeText: {
    fontSize: 11,
    color: MUTED,
    fontWeight: '800',
  },

  pastListCard: {
    backgroundColor: CARD,
    borderRadius: 18,
    padding: 16,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: ENDED_BORDER,
    gap: 12,
  },

  pastListAccent: {
    width: 8,
    alignSelf: 'stretch',
    borderRadius: 999,
    backgroundColor: ENDED_BG,
    borderWidth: 1,
    borderColor: ENDED_BORDER,
  },

  pastListBadge: {
    backgroundColor: ENDED_BG,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: ENDED_BORDER,
  },

  pastListBadgeText: {
    fontSize: 11,
    color: ENDED_TEXT,
    fontWeight: '800',
  },

  listChevron: {
    fontSize: 17,
    color: MUTED,
    fontWeight: '700',
  },

  emptyCard: {
    backgroundColor: CARD,
    borderRadius: 20,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: BORDER,
  },

  emptyTitle: {
    fontSize: 16,
    color: TEXT,
    fontWeight: '800',
    marginBottom: 8,
  },

  emptySub: {
    fontSize: 14,
    color: MUTED,
    lineHeight: 20,
  },

  signInBanner: {
    backgroundColor: SUCCESS_BG,
    borderRadius: 18,
    padding: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: SUCCESS_BORDER,
  },

  signInTitle: {
    fontSize: 15,
    color: GREEN,
    fontWeight: '800',
    marginBottom: 6,
  },

  signInText: {
    fontSize: 13,
    color: '#287A5F',
    lineHeight: 19,
    fontWeight: '600',
  },

  signInModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },

  recapModalCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 28,
    paddingBottom: 40,
    alignItems: 'center',
    borderTopWidth: 1,
    borderColor: '#E6D8C7',
  },
  recapModalTitle:         { fontSize: 20, fontWeight: '800', color: '#243045', marginBottom: 8, textAlign: 'center' },
  recapModalStats:         { fontSize: 14, color: '#6F7785', textAlign: 'center', marginBottom: 28, lineHeight: 20 },
  recapModalPrimary:       { backgroundColor: '#F5A623', borderRadius: 16, paddingVertical: 17, paddingHorizontal: 32, alignItems: 'center', width: '100%', marginBottom: 12 },
  recapModalPrimaryText:   { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  recapModalSecondary:     { paddingVertical: 10 },
  recapModalSecondaryText: { fontSize: 14, color: '#6F7785', fontWeight: '600' },

  navGrid: {
    gap: 10,
    marginBottom: 20,
  },

  navGridRow: {
    flexDirection: 'row',
    gap: 10,
  },

  // Dark cards matching CARD, same family as every other surface on the
  // page — these are browse categories, not content, and shouldn't compete
  // with the hero for attention. Border/shadow kept (not gradient-strength)
  // so they still read as tappable, just quiet.
  navTileWrap: {
    flex: 1,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 2,
  },

  // space-between (icon top, label+chevron bottom) instead of flex-end —
  // flex-end left a big block of empty CARD space above the content, which
  // read fine when that space was filled with a colorful gradient but just
  // looked unfinished on a flat dark card.
  navTile: {
    flex: 1,
    backgroundColor: CARD,
    padding: 16,
    minHeight: 104,
    justifyContent: 'space-between',
  },

  // Small tinted circle behind the emoji — keeps a hint of each category's
  // original color identity in a contained way, rather than either the old
  // full-bleed gradient or a completely colorless card.
  navTileIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },

  navTileIconEmoji: {
    fontSize: 20,
  },

  navTileFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },

  navTileLabel: {
    fontSize: 15,
    fontWeight: '800',
    color: TEXT,
    lineHeight: 19,
    flexShrink: 1,
  },

  navTileChevron: {
    fontSize: 20,
    color: MUTED,
    fontWeight: '700',
  },

  editorialCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD,
    borderRadius: 18,
    padding: 18,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: BORDER,
    borderLeftWidth: 4,
    borderLeftColor: AMBER,
  },

  editorialLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: AMBER,
    marginBottom: 4,
  },

  editorialTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: TEXT,
    marginBottom: 3,
  },

  editorialSub: {
    fontSize: 13,
    color: MUTED,
    fontWeight: '500',
    lineHeight: 18,
  },

  editorialChevron: {
    fontSize: 26,
    color: AMBER,
    fontWeight: '700',
    marginLeft: 14,
  },

  creatorsTile: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: CARD,
    borderRadius: 18,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#E8C98E',
  },

  creatorsTileLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },

  creatorsTileAvatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  creatorsTileAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: AMBER,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: CARD,
  },

  creatorsTileAvatarText: {
    fontSize: 14,
    fontWeight: '800',
    color: NAVY,
  },

  creatorsTileTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: TEXT,
  },

  creatorsTileSub: {
    fontSize: 12,
    color: MUTED,
    marginTop: 2,
    fontWeight: '600',
  },

  seeAllText: {
    fontSize: 13,
    fontWeight: '800',
    color: AMBER,
  },

  groupScrollRow: {
    marginHorizontal: -20,
    paddingLeft: 20,
    marginBottom: 24,
  },

  groupChip: {
    backgroundColor: CARD,
    borderRadius: 18,
    padding: 14,
    width: 160,
    marginRight: 10,
    borderWidth: 1.2,
    borderColor: BORDER,
    gap: 6,
  },

  groupChipEmoji: {
    fontSize: 28,
    marginBottom: 4,
  },

  groupChipName: {
    fontSize: 13,
    fontWeight: '900',
    color: TEXT,
    lineHeight: 18,
  },

  groupChipTagline: {
    fontSize: 11,
    color: MUTED,
    fontStyle: 'italic',
    lineHeight: 15,
  },

  groupChipImageWrap: {
    marginRight: 10,
    borderRadius: 18,
    overflow: 'hidden',
    width: 160,
  },

  groupChipImageBg: {
    width: 160,
    minHeight: 140,
    padding: 14,
    justifyContent: 'flex-end',
    gap: 4,
  },

  groupChipOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.62)',
    borderRadius: 18,
  },

  groupChipEmojiOnImg: {
    fontSize: 28,
    marginBottom: 4,
  },

  groupChipNameOnImg: {
    fontSize: 13,
    fontWeight: '900',
    color: '#FFFFFF',
    lineHeight: 18,
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  groupChipTaglineOnImg: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.9)',
    fontStyle: 'italic',
    lineHeight: 15,
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },

  groupChipSeeAll: {
    backgroundColor: SOFT,
    borderRadius: 18,
    padding: 14,
    width: 100,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E8C98E',
  },

  groupChipSeeAllText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#A16A00',
  },

  themeToggle: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },

  themeToggleIcon: {
    fontSize: 16,
  },

 }) // end StyleSheet.create
} // end createStyles