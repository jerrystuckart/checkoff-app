import React, { useState, useRef } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import * as ImagePicker from 'expo-image-picker'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase } from '../lib/supabase'
import { completeDare } from '../lib/completeDare'
import * as Haptics from 'expo-haptics'
import { notifyCrewCheckIn } from '../lib/notifyCrewCheckIn'
import { setPendingCheckIn } from '../lib/checkInResult'

const AMBER = '#F5A623'
const NAVY = '#1A1A2E'

/**
 * PhotoCheckInScreen
 *
 * Route params: { item, listItemId }
 *
 * Lets user take a photo or pick from library, then submits
 * a check-in with the photo attached. On success navigates back
 * to ItemDetail with checkInCompleted: true param.
 */
export default function PhotoCheckInScreen({ route, navigation }) {
  const { item, listItemId } = route?.params ?? {}
  const insets = useSafeAreaInsets()
  const photoRequired     = item?.photoRequired    ?? false
  const returnDifficulty  = route?.params?.returnDifficulty ?? (item?.difficulty ?? 1)

  const [permission, requestPermission] = useCameraPermissions()
  const [photo, setPhoto] = useState(null)
  const [mode, setMode] = useState('choose') // 'choose' | 'camera' | 'preview'
  const [uploading, setUploading] = useState(false)
  const cameraRef = useRef(null)

  async function takePicture() {
    if (!cameraRef.current) return

    try {
      const result = await cameraRef.current.takePictureAsync({
        quality: 0.7,
        base64: false,
      })
      setPhoto(result)
      setMode('preview')
    } catch (e) {
      Alert.alert('Could not take photo', e.message)
    }
  }

  async function pickFromLibrary() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()

    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo library access to attach a photo.')
      return
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaType?.images ?? ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    })

    if (!result.canceled && result.assets?.[0]) {
      setPhoto(result.assets[0])
      setMode('preview')
    }
  }

  async function submitCheckIn() {
    // Secret items from Nearby have no listItemId (no specific list context).
    // The fan-out below handles marking all their active lists. Allow through.
    const isSecretItem = item?.is_secret || item?.isSecret
    if (!listItemId && !isSecretItem) {
      Alert.alert('Missing item', 'No list item was provided for this check-in.')
      return
    }

    setUploading(true)

    try {
      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser()

      if (userErr) throw userErr
      if (!user) throw new Error('Sign in first')

      let photoUrl = null

      if (photo?.uri) {
        const rawExt = photo.uri.split('.').pop()?.toLowerCase() ?? 'jpg'
        const contentExt = rawExt === 'jpg' ? 'jpeg' : rawExt
        const filename = `${user.id}/${Date.now()}.${rawExt}`
        const response = await fetch(photo.uri)
        // NOTE: fetch(...).blob() produces blobs that serialize as empty (0 bytes)
        // when passed through React Native's bridge to Supabase Storage — the
        // upload "succeeds" but stores a zero-byte file. Using arrayBuffer()
        // avoids the Blob entirely and uploads the real bytes.
        const arrayBuffer = await response.arrayBuffer()

        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from('checkin-photos')
          .upload(filename, arrayBuffer, {
            contentType: `image/${contentExt}`,
            upsert: false,
          })

        if (uploadErr) {
          throw new Error(`Upload failed: ${uploadErr.message}`)
        }

        const { data: urlData } = supabase.storage
          .from('checkin-photos')
          .getPublicUrl(filename)

        photoUrl = urlData?.publicUrl ?? null
      }

      // For secret items coming from Nearby, listItemId is null (no specific list
      // context). Skip the single insert — the fan-out below covers all lists.
      let ciData = null
      if (listItemId) {
        const payload = {
          user_id: user.id,
          list_item_id: listItemId,
          checkin_method: photoUrl ? 'photo' : 'tap',
          photo_url: photoUrl,
          photo_width: photo?.width ?? null,
          photo_height: photo?.height ?? null,
        }

        const { data: insertData, error: ciErr } = await supabase
          .from('check_ins')
          .insert(payload)
          .select()

        if (ciErr) {
          // Duplicate row = already checked in, treat as success
          if (ciErr.code === '23505') {
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
            navigation.goBack()
            return
          }

          // List has ended — show friendly message and go back, no console error
          if (ciErr.code === 'P0001' || ciErr.message?.includes('list has ended')) {
            Alert.alert(
              'List is closed',
              'This list has ended and check-ins are no longer accepted.',
              [{ text: 'OK', onPress: () => navigation.goBack() }]
            )
            return
          }

          throw new Error(`Check-in failed: ${ciErr.message}`)
        }

        ciData = insertData
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)

      // Secret items: mark checked on ALL active lists the user is in.
      // - From a list: listItemId is set, primary insert above handled one list,
      //   fan-out marks the rest.
      // - From Nearby: listItemId is null, fan-out handles all lists at once.
      // Both camelCase (useItems) and snake_case (useNearby) field names checked.
      if ((item?.is_secret || item?.isSecret) && item?.id) {
        try {
          const today = new Date().toISOString().split('T')[0]

          // Fetch all list_items for this item, with list dates so we can
          // filter to active lists only — expired lists trigger a DB error
          // that rolls back the entire upsert batch.
          const { data: allListItems } = await supabase
            .from('list_items')
            .select('id, list_id, lists!inner(id, starts_at, ends_at)')
            .eq('item_id', item.id)

          const activeListItems = (allListItems ?? []).filter(li => {
            const l = li.lists
            if (!l) return false
            if (l.starts_at && l.starts_at > today) return false
            if (l.ends_at   && l.ends_at   < today) return false
            return true
          })

          const remaining = listItemId
            ? activeListItems.filter(li => li.id !== listItemId)
            : activeListItems

          if (remaining.length) {
            const remainingListIds = remaining.map(li => li.list_id)

            const { data: memberships } = await supabase
              .from('list_members')
              .select('list_id')
              .eq('user_id', user.id)
              .in('list_id', remainingListIds)

            const memberListIds = new Set((memberships ?? []).map(m => m.list_id))
            const toInsert = remaining
              .filter(li => memberListIds.has(li.list_id))
              .map(li => ({
                user_id:        user.id,
                list_item_id:   li.id,
                checkin_method: 'photo',
                photo_url:      photoUrl,
              }))

            if (toInsert.length) {
              await supabase.from('check_ins').upsert(toInsert, { onConflict: 'user_id,list_item_id', ignoreDuplicates: true })
            }
          }
        } catch {
          // Non-critical — primary check-in already succeeded
        }
      }

      // Update streak — fire and forget, non-critical
      supabase.functions.invoke('update-streak', {
        body: { user_id: user.id },
      }).catch(() => {/* non-critical */})

      // Complete any active dares for this item — fire and forget
      if (item?.id) completeDare(user.id, item.id).catch(() => {})

      // Fire crew notification for Partner (5pts), Rare (10pts), and Legend (25pts)
      const difficulty = item?.difficulty ?? 1
      if (difficulty >= 5 && listItemId) {
        notifyCrewCheckIn({
          listItemId,
          itemBody: item?.body ?? '',
          difficulty,
          checkInId: ciData?.[0]?.id ?? null,
        }).catch(() => {/* non-critical */})
      }

      // Navigate back and signal ListScreen to trigger celebration
      // via shared module store (navigation params don't carry listId safely)
      if (returnDifficulty >= 5) {
        setPendingCheckIn(listItemId, returnDifficulty)
      }
      navigation.goBack()
    } catch (e) {
      Alert.alert('Something went wrong', e.message)
    } finally {
      setUploading(false)
    }
  }

  // ── Choose mode ──
  if (mode === 'choose') {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 20 }]}>
        <View style={styles.itemCard}>
          <Text style={styles.itemCardLabel}>Checking off</Text>
          <Text style={styles.itemCardBody}>{item?.body}</Text>
        </View>

        <Text style={styles.subtitle}>
          {photoRequired ? 'Photo proof required 📸' : 'Add a photo to prove it 📸'}
        </Text>
        <Text style={styles.subtitleSub}>
          {photoRequired
            ? 'This item requires a photo to check off. Your crew will see it.'
            : "Photos are optional but show up in your crew's feed."
          }
        </Text>

        <TouchableOpacity
          style={styles.optionBtn}
          onPress={() => {
            if (!permission?.granted) {
              requestPermission().then((r) => {
                if (r.granted) setMode('camera')
              })
            } else {
              setMode('camera')
            }
          }}
        >
          <Text style={styles.optionIcon}>📷</Text>
          <Text style={styles.optionText}>Take a photo</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.optionBtn} onPress={pickFromLibrary}>
          <Text style={styles.optionIcon}>🖼</Text>
          <Text style={styles.optionText}>Choose from library</Text>
        </TouchableOpacity>

        {!photoRequired && (
          <TouchableOpacity
            style={styles.skipBtn}
            onPress={() => {
              setPhoto(null)
              submitCheckIn()
            }}
            disabled={uploading}
          >
            <Text style={styles.skipBtnText}>Skip photo — just check off</Text>
          </TouchableOpacity>
        )}
      </View>
    )
  }

  // ── Camera mode ──
  if (mode === 'camera') {
    return (
      <View style={styles.container}>
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
        />

        <View
          style={[
            styles.cameraControlsOverlay,
            { paddingBottom: insets.bottom + 24 },
          ]}
        >
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setMode('choose')}>
            <Text style={styles.cancelBtnText}>✕</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.shutterBtn} onPress={takePicture}>
            <View style={styles.shutterInner} />
          </TouchableOpacity>

          <View style={{ width: 44 }} />
        </View>
      </View>
    )
  }

  // ── Preview mode ──
  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 60 }}>
      <Image source={{ uri: photo?.uri }} style={styles.previewImage} resizeMode="cover" />

      <View style={[styles.previewActions, { paddingHorizontal: 20 }]}>
        <Text style={styles.previewItem}>{item?.body}</Text>

        <TouchableOpacity
          style={[styles.submitBtn, uploading && { opacity: 0.6 }]}
          onPress={submitCheckIn}
          disabled={uploading}
        >
          {uploading ? (
            <ActivityIndicator color={NAVY} />
          ) : (
            <Text style={styles.submitBtnText}>✓ Check this off with photo</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.retakeBtn}
          onPress={() => setMode('camera')}
          disabled={uploading}
        >
          <Text style={styles.retakeBtnText}>Retake photo</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0F1E',
  },

  itemCard: {
    margin: 20,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    padding: 16,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  itemCardLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.35)',
    marginBottom: 6,
  },
  itemCardBody: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    lineHeight: 22,
  },

  subtitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  subtitleSub: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    marginBottom: 28,
    paddingHorizontal: 40,
  },

  optionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginHorizontal: 20,
    marginBottom: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    padding: 18,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  optionIcon: {
    fontSize: 24,
  },
  optionText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },

  skipBtn: {
    alignItems: 'center',
    paddingVertical: 16,
    marginTop: 8,
  },
  skipBtnText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.35)',
  },

  cancelBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontSize: 18,
    color: '#fff',
  },
  shutterBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#fff',
  },
  shutterInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#fff',
  },
  cameraControlsOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 32,
    paddingTop: 20,
  },

  previewImage: {
    width: '100%',
    height: 320,
  },
  previewActions: {
    paddingTop: 20,
  },
  previewItem: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 20,
    lineHeight: 21,
  },
  submitBtn: {
    backgroundColor: AMBER,
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
    marginBottom: 12,
  },
  submitBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: NAVY,
  },
  retakeBtn: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  retakeBtnText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.4)',
  },
})