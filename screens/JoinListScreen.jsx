import React, { useState, useEffect } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, ScrollView,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase } from '../lib/supabase'

const AMBER = '#F5A623'
const NAVY  = '#1A1A2E'
const GREEN = '#1D9E75'

/**
 * JoinListScreen
 *
 * Shown when a user taps an invite deeplink: checkoff://join/[invite_code]
 * Shows list details and lets them join with one tap.
 *
 * Route params: { invite_code: string }
 */
export default function JoinListScreen({ route, navigation }) {
  const { invite_code } = route.params ?? {}
  const insets = useSafeAreaInsets()

  // After joining (or already a member), reset the HomeStack to [Home → List]
  // so the back button exists and tapping the Home tab again works normally.
  // Using replace() left List as the only item on the stack with no back destination.
  function goToList(listId, title) {
    navigation.reset({
      index: 1,
      routes: [
        { name: 'Home' },
        { name: 'List', params: { listId, title } },
      ],
    })
  }

  const [list, setList]         = useState(null)
  const [memberCount, setMemberCount] = useState(0)
  const [itemCount, setItemCount]     = useState(0)
  const [loading, setLoading]   = useState(true)
  const [joining, setJoining]   = useState(false)
  const [alreadyMember, setAlreadyMember] = useState(false)
  const [error, setError]       = useState(null)
  const [userId, setUserId]     = useState(null)

  useEffect(() => {
    loadPreview()
  }, [invite_code])

  async function loadPreview() {
    setLoading(true)
    setError(null)

    const { data: { user } } = await supabase.auth.getUser()
    setUserId(user?.id ?? null)

    if (!invite_code || invite_code === 'null' || invite_code === 'undefined') {
      setError('Invalid invite link — no code found.')
      setLoading(false)
      return
    }

    // Load list details
    const { data: listData, error: listErr } = await supabase
      .from('lists')
      .select('id, title, invite_code, is_public, starts_at, ends_at, cover_emoji, creator_id')
      .eq('invite_code', invite_code)
      .single()

    if (listErr || !listData) {
      setError('This invite link has expired or is no longer valid.')
      setLoading(false)
      return
    }

    setList(listData)

    // Load member count
    const { count: mCount } = await supabase
      .from('list_members')
      .select('id', { count: 'exact', head: true })
      .eq('list_id', listData.id)
    setMemberCount(mCount ?? 0)

    // Load item count
    const { count: iCount } = await supabase
      .from('list_items')
      .select('id', { count: 'exact', head: true })
      .eq('list_id', listData.id)
    setItemCount(iCount ?? 0)

    // Check if already a member
    if (user?.id) {
      const { data: membership } = await supabase
        .from('list_members')
        .select('id')
        .eq('list_id', listData.id)
        .eq('user_id', user.id)
        .single()
      setAlreadyMember(!!membership)
    }

    setLoading(false)
  }

  async function joinList() {
    if (!userId) {
      // Not signed in — go to sign in, come back after
      Alert.alert(
        'Sign in to join',
        'Create a free account to join this list and track your check-offs.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sign in', onPress: () => navigation.navigate('SignIn', { returnToInvite: invite_code }) },
        ]
      )
      return
    }

    if (!list) return
    setJoining(true)

    // Check if already a member first — upsert hits UPDATE path which has no RLS policy
    const { data: existing } = await supabase
      .from('list_members')
      .select('id')
      .eq('list_id', list.id)
      .eq('user_id', userId)
      .single()

    if (existing) {
      // Already a member — navigate directly to list
      setJoining(false)
      goToList(list.id, list.title)
      return
    }

    const { error: joinErr } = await supabase
      .from('list_members')
      .insert({ list_id: list.id, user_id: userId, invite_source: 'link' })

    setJoining(false)

    if (joinErr) {
      Alert.alert('Could not join', joinErr.message)
      return
    }

    // Navigate directly to the list
    goToList(list.id, list.title)
  }

  function daysLeft(endsAt) {
    if (!endsAt) return null
    const diff = Math.ceil((new Date(endsAt) - new Date()) / (1000 * 60 * 60 * 24))
    return diff > 0 ? diff : 0
  }

  // ── Loading ──
  if (loading) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator color={AMBER} size="large" />
        <Text style={styles.loadingText}>Loading invite…</Text>
      </View>
    )
  }

  // ── Error ──
  if (error) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.errorIcon}>✕</Text>
        <Text style={styles.errorTitle}>Invalid invite</Text>
        <Text style={styles.errorSub}>{error}</Text>
        <TouchableOpacity style={styles.homeBtn} onPress={() => navigation.navigate('Home')}>
          <Text style={styles.homeBtnText}>Go home</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 20 }]}
    >
      {/* Header */}
      <Text style={styles.logo}>Check<Text style={styles.logoOff}>Off</Text></Text>
      <Text style={styles.inviteLabel}>You've been invited to join</Text>

      {/* List card */}
      <View style={styles.listCard}>
        {list.cover_emoji && (
          <Text style={styles.listEmoji}>{list.cover_emoji}</Text>
        )}
        <Text style={styles.listTitle}>{list.title}</Text>

        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statNum}>{itemCount}</Text>
            <Text style={styles.statLabel}>items</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statNum}>{memberCount}</Text>
            <Text style={styles.statLabel}>members</Text>
          </View>
          {list.ends_at && (
            <>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={styles.statNum}>{daysLeft(list.ends_at)}</Text>
                <Text style={styles.statLabel}>days left</Text>
              </View>
            </>
          )}
        </View>
      </View>

      {/* What is CheckOff */}
      <View style={styles.pitchCard}>
        {[
          'Check off experiences together',
          'See your crew\'s progress live',
          'Challenge friends to beat your score',
          'Discover local spots with insider tips',
        ].map((b, i) => (
          <View key={i} style={styles.bulletRow}>
            <View style={styles.bulletDot} />
            <Text style={styles.bulletText}>{b}</Text>
          </View>
        ))}
      </View>

      {/* CTA */}
      {alreadyMember ? (
        <>
          <View style={styles.alreadyBadge}>
            <Text style={styles.alreadyText}>✓ You're already on this list</Text>
          </View>
          <TouchableOpacity
            style={styles.joinBtn}
            onPress={() => goToList(list.id, list.title)}
          >
            <Text style={styles.joinBtnText}>View list →</Text>
          </TouchableOpacity>
        </>
      ) : (
        <TouchableOpacity
          style={[styles.joinBtn, joining && { opacity: 0.6 }]}
          onPress={joinList}
          disabled={joining}
          activeOpacity={0.85}
        >
          {joining
            ? <ActivityIndicator color={NAVY} />
            : <Text style={styles.joinBtnText}>
                {userId ? 'Join this list — free' : 'Sign in to join — free'}
              </Text>
          }
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={styles.skipBtn}
        onPress={() => navigation.navigate('Home')}
      >
        <Text style={styles.skipBtnText}>Maybe later</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#0F0F1E' },
  content:        { padding: 24, paddingBottom: 60 },
  center:         { alignItems: 'center', justifyContent: 'center', flex: 1 },

  logo:           { fontFamily: 'System', fontSize: 32, fontWeight: '800', color: AMBER, letterSpacing: -1, marginBottom: 6 },
  logoOff:        { color: '#fff' },
  inviteLabel:    { fontSize: 14, color: 'rgba(255,255,255,0.4)', marginBottom: 20 },

  listCard:       { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 20, padding: 24, marginBottom: 16, borderWidth: 0.5, borderColor: 'rgba(245,166,35,0.3)', alignItems: 'center' },
  listEmoji:      { fontSize: 40, marginBottom: 12 },
  listTitle:      { fontSize: 22, fontWeight: '700', color: '#fff', textAlign: 'center', marginBottom: 20, lineHeight: 28 },
  statsRow:       { flexDirection: 'row', alignItems: 'center', gap: 16 },
  stat:           { alignItems: 'center' },
  statNum:        { fontSize: 22, fontWeight: '700', color: AMBER },
  statLabel:      { fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
  statDivider:    { width: 1, height: 28, backgroundColor: 'rgba(255,255,255,0.1)' },

  pitchCard:      { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 14, padding: 18, marginBottom: 24, gap: 12 },
  bulletRow:      { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bulletDot:      { width: 6, height: 6, borderRadius: 3, backgroundColor: AMBER, flexShrink: 0 },
  bulletText:     { fontSize: 14, color: 'rgba(255,255,255,0.6)', flex: 1 },

  alreadyBadge:   { backgroundColor: 'rgba(29,158,117,0.15)', borderRadius: 10, padding: 12, alignItems: 'center', marginBottom: 12, borderWidth: 0.5, borderColor: 'rgba(29,158,117,0.3)' },
  alreadyText:    { fontSize: 14, color: GREEN, fontWeight: '600' },

  joinBtn:        { backgroundColor: AMBER, borderRadius: 14, paddingVertical: 18, alignItems: 'center', marginBottom: 12 },
  joinBtnText:    { fontSize: 16, fontWeight: '700', color: NAVY },
  skipBtn:        { alignItems: 'center', paddingVertical: 12 },
  skipBtnText:    { fontSize: 14, color: 'rgba(255,255,255,0.3)' },

  loadingText:    { fontSize: 14, color: 'rgba(255,255,255,0.4)', marginTop: 16 },
  errorIcon:      { fontSize: 36, color: '#D85A30', marginBottom: 16 },
  errorTitle:     { fontSize: 18, fontWeight: '700', color: '#fff', marginBottom: 8 },
  errorSub:       { fontSize: 14, color: 'rgba(255,255,255,0.4)', textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  homeBtn:        { backgroundColor: AMBER, borderRadius: 999, paddingHorizontal: 24, paddingVertical: 12 },
  homeBtnText:    { fontSize: 14, fontWeight: '700', color: NAVY },
})
