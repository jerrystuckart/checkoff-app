import React, { useState, useEffect } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase } from '../lib/supabase'
import { TIERS, getTierByName, getNextTier, getTierProgress } from '../lib/tiers'

const TIER_ORDER = ['Starter', 'Explorer', 'Local', 'Insider', 'Legend']

const CHECKPOINT_IDS = [
  'points_5', 'points_25', 'points_75', 'points_150', 'points_300', 'points_500',
  'streak_4wk', 'streak_8wk', 'streak_12wk',
]

function insiderUnlocked(item, userLifetimePts, userInsiderTier) {
  const reqPts    = item.insider_drop_requires_points
  const reqStatus = item.insider_drop_requires_status
  if (reqPts == null && reqStatus == null) return true
  let unlocked = false
  if (reqPts != null && (userLifetimePts ?? 0) >= reqPts) unlocked = true
  if (!unlocked && reqStatus != null) {
    const userIdx = TIER_ORDER.indexOf(userInsiderTier ?? 'Starter')
    const reqIdx  = TIER_ORDER.indexOf(reqStatus)
    if (reqIdx >= 0 && userIdx >= reqIdx) unlocked = true
  }
  return unlocked
}

export default function InsiderAccessScreen({ navigation }) {
  const insets = useSafeAreaInsets()

  const [loading, setLoading]           = useState(true)
  const [lifetimePts, setLifetimePts]   = useState(0)
  const [insiderTier, setInsiderTier]   = useState('Starter')
  const [dbTiers, setDbTiers]           = useState([])
  const [earnedIds, setEarnedIds]       = useState(new Set())
  const [checkpointDefs, setCheckpointDefs] = useState([])
  const [drops, setDrops]               = useState([])

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }
      const uid = user.id

      const [userRes, tiersRes, earnedRes, defsRes, dropsRes] = await Promise.all([
        supabase.from('users').select('lifetime_points, insider_tier').eq('id', uid).single(),
        supabase.from('checkoff_status_tiers').select('tier_name, min_points, next_at, sort_order').order('sort_order'),
        supabase.from('user_badges').select('badge_id, earned_at').eq('user_id', uid).in('badge_id', CHECKPOINT_IDS),
        supabase.from('badge_definitions').select('id, name, description, icon').in('id', CHECKPOINT_IDS),
        supabase.from('items').select('id, body, is_insider_drop, insider_drop_requires_points, insider_drop_requires_status, insider_drop_teaser_text').eq('is_insider_drop', true),
      ])

      setLifetimePts(userRes.data?.lifetime_points ?? 0)
      setInsiderTier(userRes.data?.insider_tier ?? 'Starter')
      setDbTiers(tiersRes.data ?? [])
      setEarnedIds(new Set((earnedRes.data ?? []).map(r => r.badge_id)))
      setCheckpointDefs(defsRes.data ?? [])
      setDrops(dropsRes.data ?? [])
    } catch (e) {
      console.error('InsiderAccessScreen load error:', e.message)
    } finally {
      setLoading(false)
    }
  }

  const tier     = getTierByName(insiderTier)
  const nextTier = getNextTier(insiderTier)
  const progress = getTierProgress(insiderTier, lifetimePts)
  const ptsToNext = nextTier ? nextTier.minPoints - lifetimePts : 0

  // Tier ladder — use DB rows if present, fall back to TIERS constant
  const tierRows = dbTiers.length > 0
    ? dbTiers
    : TIERS.map(t => ({ tier_name: t.name, min_points: t.minPoints, next_at: t.nextAt }))

  // Checkpoint badges sorted by canonical order
  const checkpointOrder = CHECKPOINT_IDS.reduce((acc, id, i) => { acc[id] = i; return acc }, {})
  const checkpoints = [...checkpointDefs].sort((a, b) => (checkpointOrder[a.id] ?? 99) - (checkpointOrder[b.id] ?? 99))

  const userTierRank = TIER_ORDER.indexOf(insiderTier)

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color="#F5A623" />
      </View>
    )
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* ── A: Navy status hero ────────────────────────────────── */}
      <View style={styles.hero}>
        <Text style={styles.heroLabel}>YOUR STATUS</Text>
        <View style={[styles.tierPill, { backgroundColor: tier.bg }]}>
          <Text style={[styles.tierPillText, { color: tier.text }]}>{insiderTier.toUpperCase()}</Text>
        </View>
        <View style={styles.barWrap}>
          <View style={[styles.barFill, { width: `${Math.round(progress * 100)}%` }]} />
        </View>
        <Text style={styles.barHint}>
          {nextTier
            ? `${lifetimePts} pts · ${ptsToNext} pts to ${nextTier.name}`
            : `${lifetimePts} pts · Legend — you're at the top`}
        </Text>
      </View>

      {/* ── C: Tier ladder ─────────────────────────────────────── */}
      <Text style={styles.sectionLabel}>STATUS TIERS</Text>
      <View style={styles.card}>
        {tierRows.map((row, idx) => {
          const name       = row.tier_name
          const tierConst  = getTierByName(name)
          const rank       = TIER_ORDER.indexOf(name)
          const reached    = userTierRank >= rank
          const isCurrent  = name === insiderTier
          return (
            <View key={name} style={[styles.tierRow, idx < tierRows.length - 1 && styles.tierRowBorder]}>
              <View style={[styles.tierDot, { backgroundColor: reached ? tierConst.text : '#3A3A4A' }]} />
              <View style={styles.tierRowBody}>
                <Text style={[styles.tierRowName, !reached && styles.dimText]}>{name}</Text>
                <Text style={[styles.tierRowPts, !reached && styles.dimText]}>
                  {row.min_points} pts{row.next_at ? ` – ${row.next_at - 1} pts` : '+'}
                </Text>
              </View>
              {isCurrent && (
                <View style={[styles.tierPill, { backgroundColor: tierConst.bg }]}>
                  <Text style={[styles.tierPillText, { color: tierConst.text }]}>YOU</Text>
                </View>
              )}
              {reached && !isCurrent && <Text style={styles.checkMark}>✓</Text>}
            </View>
          )
        })}
      </View>

      {/* ── D: Checkpoints ─────────────────────────────────────── */}
      <Text style={styles.sectionLabel}>CHECKPOINTS</Text>
      <View style={styles.card}>
        {checkpoints.length === 0 ? (
          <Text style={styles.emptyText}>No checkpoint badges defined yet.</Text>
        ) : checkpoints.map((b, idx) => {
          const earned = earnedIds.has(b.id)
          return (
            <View key={b.id} style={[styles.checkpointRow, idx < checkpoints.length - 1 && styles.tierRowBorder]}>
              <Text style={[styles.checkpointIcon, !earned && styles.dimText]}>{b.icon ?? '🏅'}</Text>
              <View style={styles.tierRowBody}>
                <Text style={[styles.tierRowName, !earned && styles.dimText]}>{b.name}</Text>
                {b.description ? <Text style={[styles.tierRowPts, !earned && styles.dimText]}>{b.description}</Text> : null}
              </View>
              {earned && <Text style={styles.checkMark}>✓</Text>}
            </View>
          )
        })}
      </View>

      {/* ── E: Insider Drops ───────────────────────────────────── */}
      <Text style={styles.sectionLabel}>INSIDER DROPS</Text>
      {drops.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.emptyText}>No Insider Drops active right now.</Text>
        </View>
      ) : drops.map(drop => {
        const unlocked = insiderUnlocked(drop, lifetimePts, insiderTier)
        if (!unlocked) {
          const reqPts    = drop.insider_drop_requires_points
          const reqStatus = drop.insider_drop_requires_status
          const reqParts  = []
          if (reqPts    != null) reqParts.push(`${reqPts} pts`)
          if (reqStatus != null) reqParts.push(`${reqStatus} status`)
          return (
            <TouchableOpacity
              key={drop.id}
              style={styles.dropCardLocked}
              activeOpacity={0.85}
              onPress={() => Alert.alert(
                'Insider Drop',
                `Reach ${reqParts.join(' or ')} to unlock this drop.`,
              )}
            >
              <Text style={styles.lockIcon}>🔒</Text>
              <Text style={styles.dropTeaser}>{drop.insider_drop_teaser_text ?? 'Insider Drop'}</Text>
              {reqParts.length > 0 && (
                <Text style={styles.dropReq}>Requires {reqParts.join(' or ')}</Text>
              )}
            </TouchableOpacity>
          )
        }
        return (
          <View key={drop.id} style={styles.dropCard}>
            <View style={styles.dropInsiderPill}>
              <Text style={styles.dropInsiderPillText}>⭐ Insider Drop</Text>
            </View>
            <Text style={styles.dropBody}>{drop.body}</Text>
          </View>
        )
      })}

      {/* ── F: Footer ──────────────────────────────────────────── */}
      <Text style={styles.footer}>
        Keep checking things off to climb the ranks and unlock exclusive Insider Drops.
      </Text>
    </ScrollView>
  )
}

const NAVY = '#1A1A2E'
const AMBER = '#F5A623'

const styles = StyleSheet.create({
  loadingWrap:      { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F7F3EE' },
  scroll:           { flex: 1, backgroundColor: '#F7F3EE' },
  content:          { padding: 16, paddingTop: 0 },

  // Hero
  hero:             { backgroundColor: NAVY, borderRadius: 20, padding: 20, marginBottom: 24, alignItems: 'center' },
  heroLabel:        { fontSize: 11, fontWeight: '800', letterSpacing: 1.4, color: 'rgba(255,255,255,0.5)', marginBottom: 10 },
  barWrap:          { width: '100%', height: 6, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 3, overflow: 'hidden', marginTop: 12, marginBottom: 6 },
  barFill:          { height: '100%', backgroundColor: AMBER, borderRadius: 3 },
  barHint:          { fontSize: 12, color: 'rgba(255,255,255,0.6)', textAlign: 'center' },

  // Section label
  sectionLabel:     { fontSize: 11, fontWeight: '800', letterSpacing: 1.4, color: '#6F7785', marginBottom: 8, marginTop: 4 },

  // Card
  card:             { backgroundColor: '#FFFFFF', borderRadius: 16, marginBottom: 24, overflow: 'hidden', borderWidth: 1, borderColor: '#E8E2DA' },
  emptyText:        { padding: 16, color: '#6F7785', fontSize: 13 },

  // Tier row
  tierRow:          { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  tierRowBorder:    { borderBottomWidth: 1, borderBottomColor: '#F0EAE0' },
  tierDot:          { width: 10, height: 10, borderRadius: 5 },
  tierRowBody:      { flex: 1 },
  tierRowName:      { fontSize: 14, fontWeight: '700', color: '#1A1A2E' },
  tierRowPts:       { fontSize: 12, color: '#6F7785', marginTop: 1 },
  dimText:          { opacity: 0.4 },
  checkMark:        { fontSize: 16, color: '#0F6E56' },

  // Tier pill (reused)
  tierPill:         { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20, marginTop: 10 },
  tierPillText:     { fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },

  // Checkpoint row
  checkpointRow:    { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  checkpointIcon:   { fontSize: 22, width: 28, textAlign: 'center' },

  // Drop cards
  dropCard:         { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: '#E8E2DA' },
  dropInsiderPill:  { alignSelf: 'flex-start', backgroundColor: '#FFF8E1', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2, marginBottom: 8 },
  dropInsiderPillText: { fontSize: 11, fontWeight: '700', color: AMBER },
  dropBody:         { fontSize: 15, fontWeight: '600', color: '#1A1A2E' },

  dropCardLocked:   { backgroundColor: NAVY, borderRadius: 16, padding: 20, marginBottom: 10, borderWidth: 1.5, borderColor: AMBER, alignItems: 'center' },
  lockIcon:         { fontSize: 24, marginBottom: 8 },
  dropTeaser:       { fontSize: 16, fontWeight: '700', color: AMBER, textAlign: 'center', marginBottom: 6 },
  dropReq:          { fontSize: 12, color: '#6F7785', textAlign: 'center' },

  // Footer
  footer:           { fontSize: 13, color: '#6F7785', textAlign: 'center', paddingHorizontal: 8, lineHeight: 20 },
})
