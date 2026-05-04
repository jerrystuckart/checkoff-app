import React, { useState, useEffect } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Alert, FlatList,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase } from '../lib/supabase'

async function sendPushToUser(userId, title, body, data = {}) {
  try {
    const { data: tokens } = await supabase
      .from('push_tokens')
      .select('token')
      .eq('user_id', userId)
    if (!tokens?.length) return
    const messages = tokens.map(({ token }) => ({
      to: token, title, body, sound: 'default', data,
    }))
    await fetch('https://exp.host/--/api/v2/push/send', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(messages),
    })
  } catch (e) {
    console.warn('sendPushToUser failed:', e.message)
  }
}

const AMBER = '#F5A623'
const NAVY  = '#1A1A2E'
const GREEN = '#1D9E75'
const RED   = '#D85A30'

const BG = '#FFF9F2'
const CARD = '#FFFFFF'
const TEXT = '#243045'
const MUTED = '#6F7785'
const BORDER = '#E6D8C7'
const SOFT = '#FFF1DB'
const SOFT_2 = '#F8F3EC'
const LILAC = '#F7EEFF'
const LILAC_BORDER = '#E8D7FF'
const LILAC_TEXT = '#7C3AED'

/**
 * DareScreen
 *
 * Two modes:
 *   1. Issue mode (item passed in route params) — dare a friend to check off a specific item
 *   2. Inbox mode (no params) — see dares you've received and sent
 */
export default function DareScreen({ route, navigation }) {
  const { item, listId } = route?.params ?? {}
  const insets = useSafeAreaInsets()
  const [userId, setUserId] = useState(null)
  const [userDisplayName, setUserDisplayName] = useState('Someone')
  const [mode, setMode] = useState(item ? 'issue' : 'inbox')

  // Issue mode state
  const [listMembers, setListMembers] = useState([])
  const [selectedFriend, setSelectedFriend] = useState(null)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)

  // Inbox state
  const [receivedDares, setReceivedDares] = useState([])
  const [sentDares, setSentDares] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('received')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.auth.getUser()
    const uid = data?.user?.id
    setUserId(uid)

    if (uid) {
      // Fetch display name for dare notifications
      supabase.from('users').select('display_name').eq('id', uid).single()
        .then(({ data: p }) => { if (p?.display_name) setUserDisplayName(p.display_name) })
      if (item && listId) {
        const { data: members } = await supabase
          .from('list_members')
          .select('user_id, users(id, display_name, email)')
          .eq('list_id', listId)
          .neq('user_id', uid)

        setListMembers((members ?? []).map(m => m.users).filter(Boolean))
      }

      const [received, sent] = await Promise.all([
        supabase
          .from('dares')
          .select('*, item:items(body), from:users!dares_from_user_id_fkey(id, display_name)')
          .eq('to_user_id', uid)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('dares')
          .select('*, item:items(body), to:users!dares_to_user_id_fkey(id, display_name)')
          .eq('from_user_id', uid)
          .order('created_at', { ascending: false })
          .limit(50),
      ])

      setReceivedDares(received.data ?? [])
      setSentDares(sent.data ?? [])
    }

    setLoading(false)
  }

  async function sendDare() {
    if (!selectedFriend) {
      Alert.alert('Pick someone to dare')
      return
    }

    setSending(true)

    const { error } = await supabase.from('dares').insert({
      from_user_id: userId,
      to_user_id: selectedFriend.id,
      item_id: item.id,
      list_id: listId || null,
      message: message.trim() || null,
    })

    setSending(false)

    if (error) {
      Alert.alert('Could not send dare', error.message)
      return
    }

    sendPushToUser(
      selectedFriend.id,
      `😈 You've been dared!`,
      `${userDisplayName} dared you: "${(item?.body ?? 'a challenge').slice(0, 80)}"`,
      { screen: 'Dare' },
    ).catch(() => {})

    Alert.alert('Dare sent! 😈', `${selectedFriend.display_name} has been challenged.`)
    navigation.goBack()
  }

  async function respondToDare(dareId, accept) {
    const { error } = await supabase
      .from('dares')
      .update({ status: accept ? 'accepted' : 'declined' })
      .eq('id', dareId)

    if (error) return
    load()

    if (accept) {
      const dare = receivedDares.find(d => d.id === dareId)
      if (dare?.from?.id) {
        sendPushToUser(
          dare.from.id,
          '💪 Dare accepted!',
          `${userDisplayName} accepted your dare: "${(dare.item?.body ?? 'your challenge').slice(0, 60)}"`,
          { screen: 'Dare' },
        ).catch(() => {})
      }
    }
  }

  function statusColor(status) {
    if (status === 'completed') return GREEN
    if (status === 'declined') return RED
    if (status === 'accepted') return AMBER
    return '#B8B2AA'
  }

  function statusLabel(status) {
    const map = {
      pending: 'Pending',
      accepted: 'Accepted',
      completed: 'Completed!',
      declined: 'Declined',
      expired: 'Expired',
    }
    return map[status] ?? status
  }

  function pendingCount() {
    return receivedDares.filter(d => d.status === 'pending').length
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={AMBER} />
      </View>
    )
  }

  // ── Issue a dare ──
  if (mode === 'issue' && item) {
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroCard}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>I’ve been dared energy 😈</Text>
          </View>
          <Text style={styles.heading}>Issue a dare</Text>
          <Text style={styles.heroSub}>
            Challenge someone on your list to go check this off before you do.
          </Text>
        </View>

        <View style={styles.itemPreview}>
          <Text style={styles.itemPreviewLabel}>Item to check off</Text>
          <Text style={styles.itemPreviewBody}>{item.body}</Text>
        </View>

        <Text style={styles.fieldLabel}>Dare who?</Text>

        {listMembers.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No other members on this list yet.</Text>
          </View>
        ) : (
          listMembers.map(member => (
            <TouchableOpacity
              key={member.id}
              style={[styles.memberRow, selectedFriend?.id === member.id && styles.memberRowOn]}
              onPress={() => setSelectedFriend(member)}
              activeOpacity={0.85}
            >
              <View style={[styles.memberAvatar, selectedFriend?.id === member.id && styles.memberAvatarOn]}>
                <Text style={[styles.memberAvatarText, selectedFriend?.id === member.id && styles.memberAvatarTextOn]}>
                  {(member.display_name || member.email || '?')[0].toUpperCase()}
                </Text>
              </View>

              <View style={styles.memberTextWrap}>
                <Text style={styles.memberName}>{member.display_name || member.email}</Text>
                <Text style={styles.memberSub}>Challenge them to complete this first</Text>
              </View>

              {selectedFriend?.id === member.id && <Text style={styles.memberCheck}>✓</Text>}
            </TouchableOpacity>
          ))
        )}

        <Text style={styles.fieldLabel}>
          Trash talk <Text style={styles.fieldLabelOptional}>(optional)</Text>
        </Text>

        <TextInput
          style={styles.messageInput}
          value={message}
          onChangeText={setMessage}
          placeholder="e.g. Bet you can't do this one 😂"
          placeholderTextColor="#98A2B3"
          maxLength={120}
          multiline
        />

        <Text style={styles.charCount}>{message.length}/120</Text>

        <TouchableOpacity
          style={[styles.sendBtn, (!selectedFriend || sending) && styles.sendBtnDisabled]}
          onPress={sendDare}
          disabled={!selectedFriend || sending}
          activeOpacity={0.88}
        >
          {sending
            ? <ActivityIndicator color={NAVY} />
            : <Text style={styles.sendBtnText}>Send dare 😈</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity style={styles.inboxBtn} onPress={() => setMode('inbox')}>
          <Text style={styles.inboxBtnText}>View dare inbox →</Text>
        </TouchableOpacity>
      </ScrollView>
    )
  }

  // ── Dare inbox ──
  const dares = tab === 'received' ? receivedDares : sentDares

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.inboxHero}>
        <View style={styles.heroBadge}>
          <Text style={styles.heroBadgeText}>Dare inbox</Text>
        </View>
        <Text style={styles.inboxHeading}>Challenges</Text>
        <Text style={styles.inboxSub}>
          Keep up with the dares you’ve received and the ones you’ve sent out.
        </Text>
      </View>

      <View style={styles.tabWrap}>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'received' && styles.tabBtnOn]}
          onPress={() => setTab('received')}
          activeOpacity={0.85}
        >
          <Text style={[styles.tabBtnText, tab === 'received' && styles.tabBtnTextOn]}>
            Received {pendingCount() > 0 ? `(${pendingCount()})` : ''}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabBtn, tab === 'sent' && styles.tabBtnOn]}
          onPress={() => setTab('sent')}
          activeOpacity={0.85}
        >
          <Text style={[styles.tabBtnText, tab === 'sent' && styles.tabBtnTextOn]}>
            Sent
          </Text>
        </TouchableOpacity>
      </View>

      {dares.length === 0 ? (
        <View style={styles.center}>
          <View style={styles.emptyCardLarge}>
            <Text style={styles.emptyTitle}>
              {tab === 'received' ? 'No dares yet' : 'No dares sent yet'}
            </Text>
            <Text style={styles.emptyText}>
              {tab === 'received'
                ? 'Ask a friend to challenge you.'
                : 'Open an item and dare someone from your list.'}
            </Text>
          </View>
        </View>
      ) : (
        <FlatList
          data={dares}
          keyExtractor={d => String(d.id)}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
          renderItem={({ item: dare }) => (
            <View style={styles.dareCard}>
              <View style={styles.dareHeader}>
                <Text style={styles.dareFrom}>
                  {tab === 'received'
                    ? `From ${dare.from?.display_name ?? 'someone'}`
                    : `To ${dare.to?.display_name ?? 'someone'}`
                  }
                </Text>

                <View
                  style={[
                    styles.statusBadge,
                    {
                      backgroundColor: `${statusColor(dare.status)}18`,
                      borderColor: `${statusColor(dare.status)}40`,
                    },
                  ]}
                >
                  <Text style={[styles.statusText, { color: statusColor(dare.status) }]}>
                    {statusLabel(dare.status)}
                  </Text>
                </View>
              </View>

              <Text style={styles.dareItem}>{dare.item?.body}</Text>

              {dare.message ? (
                <View style={styles.quoteCard}>
                  <Text style={styles.dareMessage}>"{dare.message}"</Text>
                </View>
              ) : null}

              {tab === 'received' && dare.status === 'pending' && (
                <View style={styles.dareActions}>
                  <TouchableOpacity
                    style={styles.acceptBtn}
                    onPress={() => respondToDare(dare.id, true)}
                    activeOpacity={0.88}
                  >
                    <Text style={styles.acceptBtnText}>Accept 💪</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.declineBtn}
                    onPress={() => respondToDare(dare.id, false)}
                    activeOpacity={0.88}
                  >
                    <Text style={styles.declineBtnText}>Decline</Text>
                  </TouchableOpacity>
                </View>
              )}

              {tab === 'received' && dare.status === 'accepted' && dare.list_id && (
                <TouchableOpacity
                  style={styles.goToListBtn}
                  onPress={() => navigation.navigate('List', { listId: dare.list_id })}
                  activeOpacity={0.88}
                >
                  <Text style={styles.goToListBtnText}>Go check it off →</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },

  content: {
    padding: 20,
    paddingBottom: 60,
  },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },

  heroCard: {
    backgroundColor: CARD,
    borderRadius: 24,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1.2,
    borderColor: BORDER,
  },

  inboxHero: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },

  heroBadge: {
    alignSelf: 'flex-start',
    backgroundColor: LILAC,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: LILAC_BORDER,
    marginBottom: 10,
  },

  heroBadgeText: {
    fontSize: 12,
    color: LILAC_TEXT,
    fontWeight: '800',
  },

  heading: {
    fontSize: 28,
    fontWeight: '800',
    color: TEXT,
    marginBottom: 6,
  },

  inboxHeading: {
    fontSize: 28,
    fontWeight: '800',
    color: TEXT,
    marginBottom: 6,
  },

  heroSub: {
    fontSize: 14,
    lineHeight: 21,
    color: MUTED,
  },

  inboxSub: {
    fontSize: 14,
    lineHeight: 21,
    color: MUTED,
  },

  itemPreview: {
    backgroundColor: SOFT,
    borderRadius: 20,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E8C98E',
  },

  itemPreviewLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: '#9A6A00',
    marginBottom: 7,
  },

  itemPreviewBody: {
    fontSize: 17,
    fontWeight: '700',
    color: TEXT,
    lineHeight: 24,
  },

  fieldLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: MUTED,
    marginBottom: 10,
    marginTop: 18,
  },

  fieldLabelOptional: {
    fontWeight: '500',
    color: '#98A2B3',
  },

  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    backgroundColor: CARD,
    borderRadius: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: BORDER,
  },

  memberRowOn: {
    borderColor: AMBER,
    backgroundColor: '#FFF7E8',
  },

  memberAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: SOFT,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#F0D29D',
  },

  memberAvatarOn: {
    backgroundColor: AMBER,
    borderColor: AMBER,
  },

  memberAvatarText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#A16A00',
  },

  memberAvatarTextOn: {
    color: NAVY,
  },

  memberTextWrap: {
    flex: 1,
  },

  memberName: {
    fontSize: 15,
    color: TEXT,
    fontWeight: '700',
    marginBottom: 2,
  },

  memberSub: {
    fontSize: 12,
    color: MUTED,
    fontWeight: '600',
  },

  memberCheck: {
    fontSize: 16,
    color: AMBER,
    fontWeight: '800',
  },

  messageInput: {
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 14,
    color: TEXT,
    fontSize: 14,
    borderWidth: 1,
    borderColor: BORDER,
    minHeight: 60,
    textAlignVertical: 'top',
  },

  charCount: {
    marginTop: 8,
    fontSize: 12,
    color: '#98A2B3',
    textAlign: 'right',
    fontWeight: '600',
  },

  sendBtn: {
    backgroundColor: AMBER,
    borderRadius: 18,
    paddingVertical: 17,
    alignItems: 'center',
    marginTop: 22,
  },

  sendBtnDisabled: {
    opacity: 0.45,
  },

  sendBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: NAVY,
  },

  inboxBtn: {
    alignItems: 'center',
    paddingVertical: 16,
    marginTop: 2,
  },

  inboxBtnText: {
    fontSize: 14,
    color: MUTED,
    fontWeight: '700',
  },

  emptyCard: {
    backgroundColor: CARD,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: BORDER,
  },

  emptyCardLarge: {
    backgroundColor: CARD,
    borderRadius: 22,
    padding: 24,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    maxWidth: 320,
  },

  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: TEXT,
    marginBottom: 8,
  },

  emptyText: {
    fontSize: 14,
    color: MUTED,
    textAlign: 'center',
    lineHeight: 20,
  },

  tabWrap: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 10,
  },

  tabBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    backgroundColor: CARD,
  },

  tabBtnOn: {
    backgroundColor: '#FFF7E8',
    borderColor: AMBER,
  },

  tabBtnText: {
    fontSize: 14,
    color: MUTED,
    fontWeight: '700',
  },

  tabBtnTextOn: {
    color: '#A16A00',
    fontWeight: '800',
  },

  dareCard: {
    backgroundColor: CARD,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
  },

  dareHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    gap: 10,
  },

  dareFrom: {
    fontSize: 13,
    color: MUTED,
    fontWeight: '700',
    flex: 1,
  },

  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },

  statusText: {
    fontSize: 11,
    fontWeight: '800',
  },

  dareItem: {
    fontSize: 16,
    fontWeight: '800',
    color: TEXT,
    lineHeight: 22,
    marginBottom: 8,
  },

  quoteCard: {
    backgroundColor: SOFT_2,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#DED3C5',
    marginBottom: 10,
  },

  dareMessage: {
    fontSize: 13,
    color: '#9A6A00',
    fontStyle: 'italic',
    lineHeight: 19,
  },

  dareActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },

  acceptBtn: {
    flex: 2,
    backgroundColor: GREEN,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },

  acceptBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#fff',
  },

  declineBtn: {
    flex: 1,
    backgroundColor: '#F7F2EA',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER,
  },

  declineBtnText: {
    fontSize: 13,
    color: MUTED,
    fontWeight: '700',
  },

  goToListBtn: {
    marginTop: 10,
    backgroundColor: '#FFF7E8',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#F0D29D',
  },

  goToListBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#A16A00',
  },
})