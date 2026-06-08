import React, { useState, useEffect, useMemo } from 'react'
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native'
import { supabase } from '../lib/supabase'
import { useTheme } from '../lib/ThemeContext'

const AMBER      = '#FFB84D'
const AMBER_DARK = '#7A4B00'
const RED        = '#D85A30'

export default function SuggestPlaceSheet({ visible, onClose, onSuccess, listId, listTitle }) {
  const { colors } = useTheme()
  const { BG, CARD, TEXT, MUTED, BORDER, SOFT_2 } = colors
  const styles = useMemo(() => createSuggestStyles({ BG, CARD, TEXT, MUTED, BORDER, SOFT_2 }),
    [BG, CARD, TEXT, MUTED, BORDER, SOFT_2])
  const [placeName,   setPlaceName]   = useState('')
  const [experience,  setExperience]  = useState('')
  const [website,     setWebsite]     = useState('')
  const [saving,      setSaving]      = useState(false)
  const [userLists,   setUserLists]   = useState([])
  const [selListId,   setSelListId]   = useState(listId)
  const [loadingLists, setLoadingLists] = useState(false)

  useEffect(() => {
    if (!visible) return
    setPlaceName('')
    setExperience('')
    setWebsite('')
    setSelListId(listId)
    loadUserLists()
  }, [visible, listId])

  async function loadUserLists() {
    setLoadingLists(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoadingLists(false); return }

    const { data } = await supabase
      .from('lists')
      .select('id, title')
      .eq('creator_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20)

    setUserLists(data ?? [])
    setLoadingLists(false)
  }

  async function handleSubmit() {
    if (!placeName.trim()) {
      Alert.alert('Name required', 'Add the name of the place.')
      return
    }
    if (!experience.trim()) {
      Alert.alert('Experience required', 'Describe what to do there.')
      return
    }
    if (!selListId) {
      Alert.alert('Pick a list', 'Choose which list to add this to.')
      return
    }

    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        Alert.alert('Sign in required')
        setSaving(false)
        return
      }

      // Get the metro_id from the selected list for the per-metro limit check
      const { data: listData } = await supabase
        .from('lists')
        .select('metro_id')
        .eq('id', selListId)
        .single()

      const metroId = listData?.metro_id ?? null

      // Enforce 5-per-user-per-metro limit (always runs — null metro treated as its own bucket)
      let countQuery = supabase
        .from('user_suggestions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)

      countQuery = metroId
        ? countQuery.eq('metro_id', metroId)
        : countQuery.is('metro_id', null)

      const { count } = await countQuery

      if (count >= 5) {
        Alert.alert(
          'Limit reached',
          "You've already suggested 5 places in this city. Thanks for all the ideas!"
        )
        setSaving(false)
        return
      }

      // Create the suggestion record
      const { data: suggestion, error: suggErr } = await supabase
        .from('user_suggestions')
        .insert({
          user_id:         user.id,
          metro_id:        metroId,
          place_name:      placeName.trim(),
          experience_body: experience.trim(),
          website_url:     website.trim() || null,
        })
        .select('id')
        .single()

      if (suggErr) throw suggErr

      // Link to the list
      const { error: linkErr } = await supabase
        .from('user_suggestion_list_items')
        .insert({
          suggestion_id: suggestion.id,
          list_id:       selListId,
          user_id:       user.id,
        })

      if (linkErr) throw linkErr

      setSaving(false)
      onSuccess?.()
      onClose()
      Alert.alert('Added! 👀', "We'll review it for the official CheckOff list.")
    } catch (e) {
      setSaving(false)
      Alert.alert('Something went wrong', e.message)
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.container}>

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>📍 Suggest a place</Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Text style={styles.closeBtn}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Place name */}
            <Text style={styles.label}>
              Place name <Text style={styles.req}>*</Text>
            </Text>
            <TextInput
              style={styles.input}
              value={placeName}
              onChangeText={setPlaceName}
              placeholder="e.g. The Tandem"
              placeholderTextColor="#9CA3AF"
              returnKeyType="next"
            />

            {/* Experience */}
            <Text style={styles.label}>
              What's the experience? <Text style={styles.req}>*</Text>
            </Text>
            <TextInput
              style={[styles.input, styles.inputMulti]}
              value={experience}
              onChangeText={setExperience}
              placeholder="e.g. Order the fish fry on Friday — ask for extra tartar sauce"
              placeholderTextColor="#9CA3AF"
              multiline
              numberOfLines={3}
              returnKeyType="next"
              textAlignVertical="top"
            />

            {/* Website */}
            <Text style={styles.label}>
              Website <Text style={styles.optional}>(optional)</Text>
            </Text>
            <TextInput
              style={styles.input}
              value={website}
              onChangeText={setWebsite}
              placeholder="https://"
              placeholderTextColor="#9CA3AF"
              autoCapitalize="none"
              keyboardType="url"
              returnKeyType="done"
            />

            {/* List picker */}
            <Text style={styles.label}>Add to list</Text>
            {loadingLists ? (
              <ActivityIndicator color={AMBER} style={{ marginVertical: 10 }} />
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.listPills}
              >
                {userLists.map(l => (
                  <TouchableOpacity
                    key={l.id}
                    style={[styles.listPill, selListId === l.id && styles.listPillOn]}
                    onPress={() => setSelListId(l.id)}
                    activeOpacity={0.85}
                  >
                    <Text
                      style={[styles.listPillText, selListId === l.id && styles.listPillTextOn]}
                      numberOfLines={1}
                    >
                      {l.title}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            <Text style={styles.footerNote}>
              Your suggestion goes live on the list for your crew right away.
              Top picks may be added to the official CheckOff list.
            </Text>
          </ScrollView>

          {/* Submit */}
          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.submitBtn, saving && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={saving}
              activeOpacity={0.88}
            >
              {saving
                ? <ActivityIndicator color={AMBER_DARK} />
                : <Text style={styles.submitBtnText}>Add to list →</Text>
              }
            </TouchableOpacity>
          </View>

        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

function createSuggestStyles({ BG, CARD, TEXT, MUTED, BORDER, SOFT_2 }) {
 return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },

  title: {
    fontSize: 18,
    fontWeight: '800',
    color: TEXT,
  },

  closeBtn: {
    fontSize: 18,
    color: MUTED,
    fontWeight: '600',
  },

  scroll: {
    flex: 1,
  },

  scrollContent: {
    padding: 20,
    paddingBottom: 24,
  },

  label: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: MUTED,
    marginBottom: 8,
    marginTop: 22,
  },

  req: {
    color: RED,
  },

  optional: {
    fontWeight: '500',
    textTransform: 'none',
    letterSpacing: 0,
    fontSize: 11,
  },

  input: {
    backgroundColor: CARD,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: TEXT,
    fontSize: 15,
    borderWidth: 1,
    borderColor: BORDER,
  },

  inputMulti: {
    minHeight: 90,
    paddingTop: 12,
  },

  listPills: {
    gap: 8,
    paddingVertical: 4,
  },

  listPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
    maxWidth: 200,
  },

  listPillOn: {
    backgroundColor: AMBER,
    borderColor: AMBER,
  },

  listPillText: {
    fontSize: 13,
    color: TEXT,
    fontWeight: '700',
  },

  listPillTextOn: {
    color: AMBER_DARK,
    fontWeight: '800',
  },

  footerNote: {
    fontSize: 12,
    color: MUTED,
    lineHeight: 18,
    marginTop: 28,
    textAlign: 'center',
    fontStyle: 'italic',
  },

  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 36,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    backgroundColor: BG,
  },

  submitBtn: {
    backgroundColor: AMBER,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },

  submitBtnDisabled: {
    opacity: 0.5,
  },

  submitBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: AMBER_DARK,
  },
 })
}
