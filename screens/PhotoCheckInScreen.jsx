import React, { useState, useRef, useEffect } from 'react'
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
import { fanOutCheckIn } from '../lib/checkInFanOut'
import { checkGeoFence, presentGeoFenceFailure } from '../lib/geoFence'
import { updateUserLifetimePoints } from '../lib/points'
import PostCheckoffSheet from '../components/PostCheckoffSheet'

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

  const [permission, requestPermission] = useCameraPermissions()
  const [photo, setPhoto] = useState(null)
  const [mode, setMode] = useState('choose') // 'choose' | 'camera' | 'preview'
  const [uploading, setUploading] = useState(false)
  const [fenceOk, setFenceOk] = useState(false)
  const [postCheckoffData, setPostCheckoffData] = useState(null)
  const cameraRef = useRef(null)

  // Gate on entry, before the camera or library ever opens — reached from
  // five different navigation call sites (ItemDetailScreen x3, ListScreen,
  // SecretRevealScreen), so a single check here beats duplicating it at
  // every call site. Also closes the confirmed-on-device bypass where the
  // "Photo check-in" quick action jumps straight here for an unrevealed
  // secret item, skipping SecretRevealScreen's own proximity gate entirely.
  useEffect(() => {
    let cancelled = false
    checkGeoFence(item).then(result => {
      if (cancelled) return
      if (result.ok) {
        setFenceOk(true)
      } else {
        presentGeoFenceFailure(result, { onDismiss: () => navigation.goBack() })
      }
    })
    return () => { cancelled = true }
  }, [])

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
    if (!item?.id) {
      Alert.alert('Missing item', 'No item was provided for this check-in.')
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

      // points_awarded on the primary row — same difficulty * point_multiplier
      // formula as lib/useItems.js checkOff. Fan-out (lib/checkInFanOut.js)
      // deliberately leaves secondary rows at 0 to avoid double-counting.
      // No list context (standalone check-in, e.g. from Nearby/secret-reveal
      // with no specific list) means no list-specific multiplier — defaults
      // to 1.0.
      let pointMultiplier = 1.0
      if (listItemId) {
        const { data: liRow } = await supabase
          .from('list_items')
          .select('point_multiplier')
          .eq('id', listItemId)
          .maybeSingle()
        pointMultiplier = liRow?.point_multiplier ?? 1.0
      }
      const pointsAwarded = Math.round((item?.difficulty ?? 1) * pointMultiplier)

      // item_id is the canonical, always-available path to this check-in's
      // item — it survives list deletion (list_item_id goes null then).
      // list_item_id is null here when there's no joined-list context — a
      // standalone check-in, valid on its own. Always inserted (previously
      // skipped entirely when listItemId was null, silently dropping the
      // check-in for any listless item — the fan-out below only ever
      // mirrors into lists the user has already joined, so it can't be
      // relied on as the sole write).
      const payload = {
        user_id: user.id,
        list_item_id: listItemId ?? null,
        item_id: item.id,
        checkin_method: photoUrl ? 'photo' : 'tap',
        photo_url: photoUrl,
        photo_width: photo?.width ?? null,
        photo_height: photo?.height ?? null,
        points_awarded: pointsAwarded,
      }

      const { data: insertData, error: ciErr } = await supabase
        .from('check_ins')
        .insert(payload)
        .select()

      let ciData = null

      if (ciErr) {
        if (ciErr.code === '23505') {
          // A unique-constraint hit alone doesn't say WHICH row it
          // collided with — only that a check-in for THIS item, by this
          // user, is confirmed to exist is actually a success-equivalent
          // outcome. Any other collision must never celebrate a write
          // that didn't happen for this item.
          const { data: existingCheckIn } = await supabase
            .from('check_ins')
            .select('id')
            .eq('user_id', user.id)
            .eq('item_id', item?.id ?? null)
            .maybeSingle()
          if (existingCheckIn) {
            setPostCheckoffData({ itemId: item?.id, listItemId, userId: user.id, item })
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
          } else {
            Alert.alert('Something went wrong', 'Please try again.')
          }
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

      // Sheet only presents once the insert is confirmed — never before
      // (not even while the photo is still uploading), so a slow/failed
      // check-in can't show a false "Checked off" moment.
      setPostCheckoffData({ itemId: item?.id, listItemId, userId: user.id, item })
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)

      // Mirror this check-off into every other active list containing the
      // same item — fire and forget, non-critical. Was previously secret-item
      // only (secrets needed cross-list reveal); generalized to all items —
      // a check-off is a fact about the user and the item, not the list they
      // were viewing. From Nearby, listItemId is null and this fans out to
      // every list at once.
      if (item?.id) {
        fanOutCheckIn({
          userId: user.id,
          itemId: item.id,
          excludeListItemId: listItemId,
          checkinMethod: photoUrl ? 'photo' : 'tap',
          photoUrl,
        }).catch(() => {})
      }

      // Update streak — fire and forget, non-critical
      supabase.functions.invoke('update-streak', {
        body: { user_id: user.id },
      }).catch(() => {/* non-critical */})

      // Recompute and persist lifetime points — this screen previously
      // never called this at all, so a photo check-in never moved the
      // cached users.lifetime_points value regardless of points_awarded.
      updateUserLifetimePoints(user.id).catch(() => {})

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

    } catch (e) {
      setPostCheckoffData(null)
      Alert.alert('Something went wrong', e.message)
    } finally {
      setUploading(false)
    }
  }

  // ── Confirming location before anything else can open ──
  if (!fenceOk) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={AMBER} />
        <Text style={styles.checkingText}>Confirming your location…</Text>
      </View>
    )
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

        <PostCheckoffSheet
          data={postCheckoffData}
          onDismiss={() => { setPostCheckoffData(null); navigation.goBack() }}
          navigation={navigation}
        />
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

      <PostCheckoffSheet
        data={postCheckoffData}
        onDismiss={() => { setPostCheckoffData(null); navigation.goBack() }}
        navigation={navigation}
      />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0F1E',
  },

  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkingText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 16,
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