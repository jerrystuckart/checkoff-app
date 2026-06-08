import React, { useState, useMemo, useEffect } from 'react'
import {
  View, Text, FlatList, StyleSheet, ActivityIndicator,
  TouchableOpacity, Modal, ScrollView, Share,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLeaderboard } from '../lib/useLeaderboard'
import { supabase } from '../lib/supabase'
import { useTheme } from '../lib/ThemeContext'

const AMBER  = '#F5A623'
const GREEN  = '#1D9E75'
const BLUE   = '#378ADD'
const RED    = '#D85A30'



const MEDALS         = ['🥇', '🥈', '🥉']
const AVATAR_COLORS  = ['#534AB7', '#1D9E75', '#D85A30', '#378ADD', '#D4537E', '#BA7517']

function initials(name = '') {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

function timeAgo(iso) {
  if (!iso) return 'No activity'
  const diff = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (diff < 60) return 'Just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function formatDate(value) {
  if (!value) return null
  const d = new Date(`${value}T12:00:00`)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function LeaderboardScreen({ route }) {
  const { listId } = route.params ?? {}
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const { BG, CARD, TEXT, MUTED, BORDER, SOFT, SOFT_2, AMBER, GREEN, ENDED_BG, ENDED_BORDER, ENDED_TEXT } = colors
  const styles = useMemo(() => createLeaderboardStyles({ BG, CARD, TEXT, MUTED, BORDER, SOFT, SOFT_2, AMBER, GREEN, ENDED_BG, ENDED_BORDER, ENDED_TEXT }),
    [BG, CARD, TEXT, MUTED, BORDER, SOFT, SOFT_2, AMBER, GREEN, ENDED_BG, ENDED_BORDER, ENDED_TEXT])
  const { entries, loading } = useLeaderboard(listId)

  const [userId, setUserId] = useState(null)
  const [nudge, setNudge] = useState(null)
  const [userStreak, setUserStreak] = useState(0)
  const [listMeta, setListMeta] = useState(null)
  const [metaLoading, setMetaLoading] = useState(true)

  // Crew check-ins modal
  const [crewModal, setCrewModal] = useState(null)   // { userId, displayName, color }
  const [crewCheckins, setCrewCheckins] = useState([])
  const [crewLoading, setCrewLoading] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const uid = data?.user?.id
      setUserId(uid)
      if (uid) loadUserStats(uid)
    })
    loadListMeta()
  }, [])

  useEffect(() => {
    if (entries.length > 0 && userId) buildNudge()
  }, [entries, userId, listMeta])

  async function loadListMeta() {
    setMetaLoading(true)
    const { data } = await supabase
      .from('lists')
      .select('id, title, ends_at, invite_code')
      .eq('id', listId)
      .single()

    setListMeta(data ?? null)
    setMetaLoading(false)
  }

  async function loadUserStats(uid) {
    const { data } = await supabase
      .from('users')
      .select('current_streak')
      .eq('id', uid)
      .single()

    if (data) setUserStreak(data.current_streak ?? 0)
  }

  function isEnded() {
    if (!listMeta?.ends_at) return false
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const end = new Date(`${listMeta.ends_at}T12:00:00`)
    end.setHours(0, 0, 0, 0)

    return end < today
  }

  function buildNudge() {
    if (isEnded()) {
      setNudge(null)
      return
    }

    const myIdx = entries.findIndex(e => e.userId === userId)
    if (myIdx < 0) return

    const myScore = entries[myIdx].score
    const above = entries.slice(0, myIdx).reverse().find(e => e.score - myScore <= 3)
    if (above && myIdx > 0) {
      setNudge({
        text: `${above.displayName} is only ${above.score - myScore} ahead of you 🔥`,
        type: 'chase',
      })
      return
    }

    const below = entries.slice(myIdx + 1).find(e => myScore - e.score <= 3)
    if (below) {
      setNudge({
        text: `${below.displayName} is ${myScore - below.score} behind you — don't slow down!`,
        type: 'defend',
      })
      return
    }

    setNudge(null)
  }

  function winnerEntry() {
    if (!entries.length) return null
    return entries[0]
  }

  function myPlacement() {
    const idx = entries.findIndex(e => e.userId === userId)
    return idx >= 0 ? idx + 1 : null
  }

  async function openCrewModal(entry, color) {
    setCrewModal({ userId: entry.userId, displayName: entry.displayName, color, streak: entry.streak ?? 0 })
    setCrewCheckins([])
    setCrewLoading(true)
    try {
      // Get list items with difficulty and multiplier
      const { data: listItems } = await supabase
        .from('list_items')
        .select('id, item_id, point_multiplier, items(body, difficulty, categories(name, color_hex))')
        .eq('list_id', listId)

      const listItemIds = (listItems ?? []).map(li => li.id)
      if (!listItemIds.length) { setCrewLoading(false); return }

      // Get this user's check-ins on this list
      const { data: checkins } = await supabase
        .from('check_ins')
        .select('list_item_id, checked_at')
        .eq('user_id', entry.userId)
        .in('list_item_id', listItemIds)
        .order('checked_at', { ascending: false })

      // Join with item details and compute pts
      const itemMap = {}
      ;(listItems ?? []).forEach(li => { itemMap[li.id] = li })

      const userStreak = entry.streak ?? 0

      const merged = (checkins ?? []).map(ci => {
        const li           = itemMap[ci.list_item_id]
        const difficulty   = li?.items?.difficulty    ?? 1
        const multiplier   = li?.point_multiplier     ?? 1.0
        const streakBonus  = (userStreak >= 4 && difficulty < 25) ? 1.5 : 1.0
        const pts          = Math.round(difficulty * multiplier * streakBonus)
        return {
          body:        li?.items?.body                    ?? 'Unknown item',
          category:    li?.items?.categories?.name        ?? '',
          catColor:    li?.items?.categories?.color_hex   ?? '#888',
          checkedAt:   ci.checked_at,
          difficulty,
          multiplier,
          streakBonus,
          pts,
        }
      })

      setCrewCheckins(merged)
    } catch (e) {
      setCrewCheckins([])
    } finally {
      setCrewLoading(false)
    }
  }

  async function shareLeaderboard() {
    const listTitle = listMeta?.title ?? 'CheckOff list'
    const ended = isEnded()

    const lines = entries.slice(0, 5).map((e, i) => {
      const medal = ['🥇', '🥈', '🥉'][i] ?? `#${i + 1}`
      const isMe = e.userId === userId
      return `${medal} ${e.displayName}${isMe ? '' : ''} — ${e.score} checked`
    })

    const placement = myPlacement()
    const myLine = placement ? `\nYou're #${placement} of ${entries.length}` : ''

    const message = [
      `${ended ? '🏁 Final standings' : '🏆 Live standings'} — ${listTitle}`,
      '',
      ...lines,
      myLine,
      '',
      'Join us on CheckOff — the app that actually gets you off the couch.',
      `https://getcheckoff.com/join/${listMeta?.invite_code ?? ''}`,
    ].filter(l => l !== null).join('\n')

    try {
      await Share.share({ message, title: listTitle })
    } catch (e) { /* user cancelled */ }
  }

  function renderEntry({ item, index }) {
    const color = AVATAR_COLORS[index % AVATAR_COLORS.length]
    const isTop = index < 3
    const isMe = item.userId === userId
    const isDeleted = item.isDeleted ?? false
    const maxScore = entries[0]?.score ?? 1
    const barPct = Math.round((item.score / maxScore) * 100)

    return (
      <TouchableOpacity
        style={[styles.row, isMe && styles.rowMe, isDeleted && styles.rowDeleted]}
        onPress={() => !isDeleted && item.score > 0 && openCrewModal(item, color)}
        activeOpacity={!isDeleted && item.score > 0 ? 0.85 : 1}
      >
        <Text style={styles.rank}>{MEDALS[index] ?? `#${index + 1}`}</Text>

        <View
          style={[
            styles.avatar,
            {
              backgroundColor: isDeleted ? '#F0EDE8' : `${color}18`,
              borderColor: isMe ? AMBER : isDeleted ? '#DDD8D0' : `${color}40`,
            },
          ]}
        >
          <Text style={[styles.avatarText, { color: isDeleted ? '#B0A89E' : color }]}>
            {isDeleted ? '×' : initials(item.displayName)}
          </Text>
        </View>

        <View style={styles.body}>
          <View style={styles.nameRow}>
            <Text
              style={[
                styles.name,
                isMe && { color: '#A16A00', fontWeight: '800' },
                isDeleted && styles.nameDeleted,
              ]}
              numberOfLines={1}
            >
              {item.displayName ?? 'Anonymous'}{isMe ? '  (you)' : ''}
            </Text>

            {!isEnded() && !isDeleted && (item.streak ?? 0) >= 4 && (
              <Text style={styles.streakBadge}>🔥{item.streak}</Text>
            )}
          </View>

          <Text style={[styles.lastActive, isDeleted && { color: '#C0B8B0', fontStyle: 'italic' }]}>
            {isDeleted ? 'Account deleted' : isEnded() ? 'Final score' : timeAgo(item.lastActive)}
          </Text>

          <View style={styles.barWrap}>
            <View
              style={[
                styles.bar,
                {
                  width: `${barPct}%`,
                  backgroundColor: isDeleted ? '#DDD8D0' : isMe ? AMBER : `${color}80`,
                },
              ]}
            />
          </View>
        </View>

        <View style={styles.scoreWrap}>
          <Text
            style={[
              styles.score,
              (isTop || isMe) && !isDeleted && { color: isMe ? '#A16A00' : TEXT },
              isDeleted && { color: '#B0A89E' },
            ]}
          >
            {item.score}
          </Text>
          <Text style={styles.scoreLabel}>pts</Text>
        </View>
      </TouchableOpacity>
    )
  }

  if (loading || metaLoading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={AMBER} size="large" />
      </View>
    )
  }

  const ended = isEnded()
  const winner = winnerEntry()
  const placement = myPlacement()

  return (
    <View style={[styles.container, { paddingTop: insets.top ? 0 : 0 }]}>
      {entries.length === 0 ? (
        <View style={styles.center}>
          <View style={styles.emptyIcon}>
            <Text style={{ fontSize: 32 }}>👥</Text>
          </View>
          <Text style={styles.emptyTitle}>
            {ended ? 'This list has ended' : 'No crew activity yet'}
          </Text>
          <Text style={styles.emptySub}>
            {ended
              ? 'Final standings will appear here once crew activity is available.'
              : 'Invite friends to this list — the leaderboard updates live as people check things off.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={e => String(e.userId)}
          renderItem={renderEntry}
          contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <>
              {ended ? (
                <>
                  <View style={styles.endedBanner}>
                    <Text style={styles.endedBannerText}>🏁 List ended</Text>
                    {listMeta?.ends_at ? (
                      <Text style={styles.endedBannerSub}>
                        Final as of {formatDate(listMeta.ends_at)}
                      </Text>
                    ) : null}
                  </View>

                  {winner && (
                    <View style={styles.winnerCard}>
                      <Text style={styles.winnerEyebrow}>Final winner</Text>
                      <Text style={styles.winnerName}>
                        {winner.displayName ?? 'Anonymous'}{winner.userId === userId ? ' (you)' : ''}
                      </Text>
                      <Text style={styles.winnerScore}>
                        {winner.score} checked off
                      </Text>

                      <View style={styles.winnerMetaRow}>
                        <View style={styles.winnerMetaPill}>
                          <Text style={styles.winnerMetaText}>🥇 First place</Text>
                        </View>

                        {placement && (
                          <View style={styles.winnerMetaPillSecondary}>
                            <Text style={styles.winnerMetaTextSecondary}>
                              Your place: #{placement}
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>
                  )}

                  <View style={styles.liveHeaderRow}>
                    <View style={styles.liveRow}>
                      <View style={[styles.liveDot, { backgroundColor: ENDED_TEXT }]} />
                      <Text style={styles.liveText}>
                        {entries.length} crew member{entries.length !== 1 ? 's' : ''} · final standings
                      </Text>
                    </View>
                    <TouchableOpacity style={styles.shareBtn} onPress={shareLeaderboard} activeOpacity={0.85}>
                      <Text style={styles.shareBtnText}>Share ↗</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <>
                  <View style={styles.liveHeaderRow}>
                    <View style={styles.liveRow}>
                      <View style={styles.liveDot} />
                      <Text style={styles.liveText}>
                        {entries.length} crew member{entries.length !== 1 ? 's' : ''} · live
                      </Text>
                    </View>
                    <TouchableOpacity style={styles.shareBtn} onPress={shareLeaderboard} activeOpacity={0.85}>
                      <Text style={styles.shareBtnText}>Share ↗</Text>
                    </TouchableOpacity>
                  </View>

                  {!isEnded() && listMeta?.invite_code && (
                    <TouchableOpacity
                      style={styles.inviteCrewCard}
                      onPress={shareLeaderboard}
                      activeOpacity={0.88}
                    >
                      <View style={styles.inviteCrewLeft}>
                        <Text style={styles.inviteCrewEmoji}>👥</Text>
                        <View>
                          <Text style={styles.inviteCrewTitle}>
                            {entries.length === 1 ? 'Invite your crew' : 'Invite more friends'}
                          </Text>
                          <Text style={styles.inviteCrewSub}>It's more fun with friends — share the list link</Text>
                        </View>
                      </View>
                      <Text style={styles.inviteCrewArrow}>→</Text>
                    </TouchableOpacity>
                  )}

                  {nudge && (
                    <View style={[styles.nudgeCard, nudge.type === 'chase' && styles.nudgeChase]}>
                      <Text style={styles.nudgeText}>{nudge.text}</Text>
                    </View>
                  )}
                </>
              )}
            </>
          }
        />
      )}

      {/* ── Crew check-ins modal ── */}
      <Modal
        visible={!!crewModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setCrewModal(null)}
      >
        <View style={[styles.modalContainer, { paddingTop: insets.top + 16 }]}>
          {/* Modal header */}
          <View style={styles.modalHeader}>
            <View style={[styles.modalAvatar, { backgroundColor: `${crewModal?.color ?? AMBER}18`, borderColor: `${crewModal?.color ?? AMBER}40` }]}>
              <Text style={[styles.modalAvatarText, { color: crewModal?.color ?? AMBER }]}>
                {initials(crewModal?.displayName ?? '')}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalName}>{crewModal?.displayName ?? ''}</Text>
              <Text style={styles.modalSub}>
                {crewCheckins.length} item{crewCheckins.length !== 1 ? 's' : ''} · {crewCheckins.reduce((sum, ci) => sum + (ci.pts ?? 0), 0)} pts total
                {(crewModal?.streak ?? 0) >= 4 ? ` · 🔥 ${crewModal.streak}w streak` : ''}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setCrewModal(null)} style={styles.modalCloseBtn}>
              <Text style={styles.modalCloseBtnText}>Done</Text>
            </TouchableOpacity>
          </View>

          {crewLoading ? (
            <View style={styles.center}>
              <ActivityIndicator color={AMBER} />
            </View>
          ) : crewCheckins.length === 0 ? (
            <View style={styles.center}>
              <Text style={{ fontSize: 28, marginBottom: 12 }}>🏃</Text>
              <Text style={styles.emptyTitle}>Nothing checked off yet</Text>
              <Text style={styles.emptySub}>Check back after they get going!</Text>
            </View>
          ) : (
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
              showsVerticalScrollIndicator={false}
            >
              {crewCheckins.map((ci, i) => {
                const DIFF_LABELS = { 5: 'Partner', 10: 'Rare', 25: 'Legend' }
                const DIFF_COLORS = {
                  5:  { bg: '#EBF4FF', text: '#1E4A8A' },
                  10: { bg: '#FFF7E6', text: '#92400E' },
                  25: { bg: '#F3EEFF', text: '#5B21B6' },
                }
                const tierLabel = DIFF_LABELS[ci.difficulty]
                const tierStyle = DIFF_COLORS[ci.difficulty]
                const showBonus = ci.streakBonus > 1
                const showMult  = ci.multiplier > 1

                return (
                  <View key={i} style={styles.modalRow}>
                    <View style={[styles.modalCatDot, { backgroundColor: ci.catColor + '28', borderColor: ci.catColor + '50' }]}>
                      <View style={[styles.modalCatDotInner, { backgroundColor: ci.catColor }]} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.modalItemBody}>{ci.body}</Text>
                      <View style={styles.modalItemTagRow}>
                        {ci.category ? (
                          <Text style={[styles.modalItemCat, { color: ci.catColor }]}>{ci.category}</Text>
                        ) : null}
                        {tierLabel ? (
                          <View style={[styles.modalTierBadge, { backgroundColor: tierStyle.bg }]}>
                            <Text style={[styles.modalTierText, { color: tierStyle.text }]}>{tierLabel}</Text>
                          </View>
                        ) : null}
                        {showMult ? (
                          <View style={styles.modalMultBadge}>
                            <Text style={styles.modalMultText}>{ci.multiplier}×</Text>
                          </View>
                        ) : null}
                        {showBonus ? (
                          <View style={styles.modalBonusBadge}>
                            <Text style={styles.modalBonusText}>🔥 streak</Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                    <View style={styles.modalPtsWrap}>
                      <Text style={styles.modalPts}>{ci.pts}</Text>
                      <Text style={styles.modalPtsLabel}>pts</Text>
                    </View>
                  </View>
                )
              })}
            </ScrollView>
          )}
        </View>
      </Modal>
    </View>
  )
}

function createLeaderboardStyles({ BG, CARD, TEXT, MUTED, BORDER, SOFT, SOFT_2, AMBER, GREEN, ENDED_BG, ENDED_BORDER, ENDED_TEXT }) {
 return StyleSheet.create({
  container:   { flex: 1, backgroundColor: BG },
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: BG },

  liveRow:     { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  liveDot:     { width: 8, height: 8, borderRadius: 4, backgroundColor: GREEN },
  liveText:    { fontSize: 12, color: MUTED, fontWeight: '700' },

  endedBanner: {
    backgroundColor: ENDED_BG,
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: ENDED_BORDER,
  },

  endedBannerText: {
    fontSize: 15,
    color: ENDED_TEXT,
    fontWeight: '800',
    marginBottom: 4,
  },

  endedBannerSub: {
    fontSize: 12,
    color: MUTED,
    fontWeight: '600',
  },

  winnerCard: {
    backgroundColor: SOFT,
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#F0D29D',
  },

  winnerEyebrow: {
    fontSize: 11,
    color: '#A16A00',
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },

  winnerName: {
    fontSize: 22,
    color: TEXT,
    fontWeight: '800',
    marginBottom: 6,
  },

  winnerScore: {
    fontSize: 14,
    color: MUTED,
    fontWeight: '700',
    marginBottom: 12,
  },

  winnerMetaRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },

  winnerMetaPill: {
    backgroundColor: '#FFF6E7',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#F0D29D',
  },

  winnerMetaText: {
    fontSize: 12,
    color: '#A16A00',
    fontWeight: '800',
  },

  winnerMetaPillSecondary: {
    backgroundColor: CARD,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: BORDER,
  },

  winnerMetaTextSecondary: {
    fontSize: 12,
    color: TEXT,
    fontWeight: '700',
  },

  nudgeCard:   { backgroundColor: '#FFF0EA', borderRadius: 14, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: '#F5C9B3' },
  nudgeChase:  { backgroundColor: SOFT, borderColor: '#F0D29D' },
  nudgeText:   { fontSize: 13, color: TEXT, fontWeight: '700', lineHeight: 18 },

  inviteCrewCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F0F8FF', borderRadius: 14,
    padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: '#BDD8F5',
  },
  inviteCrewLeft:  { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  inviteCrewEmoji: { fontSize: 24 },
  inviteCrewTitle: { fontSize: 14, fontWeight: '800', color: TEXT, marginBottom: 2 },
  inviteCrewSub:   { fontSize: 11, color: MUTED, fontWeight: '600' },
  inviteCrewArrow: { fontSize: 16, color: BLUE, fontWeight: '800' },

  row:         { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: CARD, borderRadius: 18, borderWidth: 1, borderColor: BORDER },
  rowMe:       { borderColor: AMBER, backgroundColor: '#FFF8E8', borderWidth: 2 },
  rowDeleted:  { opacity: 0.6 },
  nameDeleted: { color: '#B0A89E', fontStyle: 'italic' },

  rank:        { fontSize: 20, width: 32, textAlign: 'center' },
  avatar:      { width: 42, height: 42, borderRadius: 21, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarText:  { fontSize: 13, fontWeight: '800' },

  body:        { flex: 1 },
  nameRow:     { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  name:        { fontSize: 14, color: TEXT, fontWeight: '700', flexShrink: 1 },
  streakBadge: { fontSize: 11, color: RED, fontWeight: '800' },
  lastActive:  { fontSize: 11, color: MUTED, marginBottom: 6, fontWeight: '600' },
  barWrap:     { height: 4, backgroundColor: '#F2EBE0', borderRadius: 2, overflow: 'hidden' },
  bar:         { height: 4, borderRadius: 2 },

  scoreWrap:   { alignItems: 'flex-end', flexShrink: 0 },
  score:       { fontSize: 22, fontWeight: '800', color: MUTED },
  scoreLabel:  { fontSize: 10, color: MUTED, fontWeight: '600' },

  sep:         { height: 8 },

  liveHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  shareBtn:    { backgroundColor: SOFT, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1, borderColor: '#F0D29D' },
  shareBtnText: { fontSize: 12, color: '#A16A00', fontWeight: '800' },

  emptyIcon:   { width: 72, height: 72, borderRadius: 36, backgroundColor: SOFT_2, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle:  { fontSize: 18, fontWeight: '800', color: TEXT, marginBottom: 8, textAlign: 'center' },
  emptySub:    { fontSize: 13, color: MUTED, textAlign: 'center', lineHeight: 19, fontWeight: '600' },

  // ── Crew modal ──
  modalContainer:  { flex: 1, backgroundColor: BG },
  modalHeader:     { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 0.5, borderBottomColor: BORDER },
  modalAvatar:     { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  modalAvatarText: { fontSize: 14, fontWeight: '800' },
  modalName:       { fontSize: 16, fontWeight: '800', color: TEXT },
  modalSub:        { fontSize: 12, color: MUTED, fontWeight: '600', marginTop: 2 },
  modalCloseBtn:   { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: SOFT_2, borderWidth: 1, borderColor: BORDER },
  modalCloseBtnText: { fontSize: 13, fontWeight: '700', color: TEXT },

  modalRow:        { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, marginBottom: 8 },
  modalCatDot:     { width: 28, height: 28, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 },
  modalCatDotInner: { width: 10, height: 10, borderRadius: 5 },
  modalItemBody:   { fontSize: 14, fontWeight: '700', color: TEXT, lineHeight: 19, marginBottom: 5 },
  modalItemTagRow: { flexDirection: 'row', gap: 5, flexWrap: 'wrap', alignItems: 'center' },
  modalItemCat:    { fontSize: 10, fontWeight: '700' },
  modalItemTime:   { fontSize: 11, color: MUTED, fontWeight: '600', flexShrink: 0 },
  modalTierBadge:  { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999 },
  modalTierText:   { fontSize: 10, fontWeight: '800' },
  modalMultBadge:  { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: '#FDF0FF' },
  modalMultText:   { fontSize: 10, fontWeight: '800', color: '#9D1C6E' },
  modalBonusBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: '#FFF0D6' },
  modalBonusText:  { fontSize: 10, fontWeight: '800', color: '#A16A00' },
  modalPtsWrap:    { alignItems: 'center', justifyContent: 'center', minWidth: 36, flexShrink: 0 },
  modalPts:        { fontSize: 18, fontWeight: '800', color: TEXT },
  modalPtsLabel:   { fontSize: 9, color: MUTED, fontWeight: '700', textTransform: 'uppercase' },
 })
}