// Community Cover Photos V1 — capture -> preview -> EXPLICIT consent ->
// upload-as-pending. Camera/upload mechanics deliberately mirror the
// proven pattern in PhotoCheckInScreen.jsx (CameraView, takePictureAsync,
// fetch(...).arrayBuffer() upload — NOT .blob(), which serializes as
// empty over RN's bridge, see that screen's own comment) rather than
// inventing a new capture flow.
//
// KEY DIFFERENCE FROM PhotoCheckInScreen: this is a SUBMISSION, not an
// instant check-in. The photo is never auto-submitted after capture — the
// user must explicitly confirm the "Great shot. Share it with CheckOff?"
// consent prompt before anything uploads. Uploads into the PRIVATE
// submission-photos bucket (never public) under
// cover-candidates/<user_id>/<timestamp>.<ext>, and the resulting row
// starts at 'needs_review' or 'automated_rejected' (see
// lib/coverModeration/moderationAdapter.js) — never 'approved' or
// 'selected'; only an admin can move it further (enforced by RLS, not just
// app logic).

import React, { useState, useRef } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Image, Alert, ActivityIndicator, ScrollView } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase } from '../lib/supabase'
import { submitCoverCandidate } from '../lib/coverCandidates'
import { localSanityOnlyAdapter, initialStatusFromAssessment } from '../lib/coverModeration/moderationAdapter'

const AMBER = '#F5A623'
const NAVY = '#1A1A2E'

export default function CoverCandidateCaptureScreen({ route, navigation }) {
  const { item } = route?.params ?? {}
  const insets = useSafeAreaInsets()

  const [permission, requestPermission] = useCameraPermissions()
  const [photo, setPhoto] = useState(null)
  const [mode, setMode] = useState('camera') // 'camera' | 'preview' | 'submitted'
  const [submitting, setSubmitting] = useState(false)
  const cameraRef = useRef(null)

  async function takePicture() {
    if (!cameraRef.current) return
    try {
      const result = await cameraRef.current.takePictureAsync({ quality: 0.7, base64: false })
      setPhoto(result)
      setMode('preview')
    } catch (e) {
      Alert.alert('Could not take photo', e.message)
    }
  }

  async function confirmAndSubmit() {
    if (!photo?.uri || !item?.id) return
    setSubmitting(true)

    try {
      const { data: { user }, error: userErr } = await supabase.auth.getUser()
      if (userErr) throw userErr
      if (!user) throw new Error('Sign in first')

      const rawExt = photo.uri.split('.').pop()?.toLowerCase() ?? 'jpg'
      const contentExt = rawExt === 'jpg' ? 'jpeg' : rawExt
      // Namespaced under cover-candidates/<user_id>/... -- matches the
      // per-user-folder shape the submission-photos bucket's SELECT policy
      // for admins doesn't require, but keeps this feature's uploads
      // clearly separated from anything else that bucket might hold.
      const storagePath = `cover-candidates/${user.id}/${Date.now()}.${rawExt}`

      const response = await fetch(photo.uri)
      const arrayBuffer = await response.arrayBuffer()

      const { error: uploadErr } = await supabase.storage
        .from('submission-photos')
        .upload(storagePath, arrayBuffer, { contentType: `image/${contentExt}`, upsert: false })
      if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`)

      const assessment = await localSanityOnlyAdapter({
        width: photo.width,
        height: photo.height,
        fileSizeBytes: arrayBuffer.byteLength,
      })
      const status = initialStatusFromAssessment(assessment)

      await submitCoverCandidate({
        userId: user.id,
        itemId: item.id,
        storagePath,
        status,
        moderationMetadata: assessment.signals,
      })

      setMode('submitted')
    } catch (e) {
      Alert.alert('Something went wrong', e.message)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Camera mode ──
  if (mode === 'camera') {
    if (!permission?.granted) {
      return (
        <View style={[styles.container, styles.center]}>
          <Text style={styles.permissionText}>Camera access is needed to take a photo.</Text>
          <TouchableOpacity style={styles.permissionBtn} onPress={() => requestPermission()}>
            <Text style={styles.permissionBtnText}>Allow camera</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.cancelLink}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )
    }
    return (
      <View style={styles.container}>
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
        <View style={[styles.cameraControlsOverlay, { paddingBottom: insets.bottom + 24 }]}>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => navigation.goBack()}>
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

  // ── Preview + explicit consent mode ──
  if (mode === 'preview') {
    return (
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 60, paddingTop: insets.top + 20 }}>
        <Image source={{ uri: photo?.uri }} style={styles.previewImage} resizeMode="cover" />
        <View style={styles.previewActions}>
          <Text style={styles.consentTitle}>Great shot. Share it with CheckOff?</Text>
          <Text style={styles.consentSubtitle}>Help other locals see what the thing looks like.</Text>
          <Text style={styles.consentFine}>
            By sharing, you're giving CheckOff permission to display this photo in the app if it's approved.
            It won't be public until then.
          </Text>

          <TouchableOpacity style={[styles.submitBtn, submitting && { opacity: 0.6 }]} onPress={confirmAndSubmit} disabled={submitting}>
            {submitting ? <ActivityIndicator color={NAVY} /> : <Text style={styles.submitBtnText}>Share it with CheckOff</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.retakeBtn} onPress={() => setMode('camera')} disabled={submitting}>
            <Text style={styles.retakeBtnText}>Retake photo</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    )
  }

  // ── Submitted confirmation ──
  return (
    <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
      <Text style={styles.submittedText}>Submitted for review ✓</Text>
      <TouchableOpacity style={styles.doneBtn} onPress={() => navigation.goBack()}>
        <Text style={styles.doneBtnText}>Done</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F0F1E' },
  center: { alignItems: 'center', justifyContent: 'center' },

  permissionText: { color: '#fff', fontSize: 15, textAlign: 'center', marginHorizontal: 32, marginBottom: 16 },
  permissionBtn: { backgroundColor: AMBER, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 28, marginBottom: 16 },
  permissionBtnText: { color: NAVY, fontWeight: '700', fontSize: 15 },
  cancelLink: { color: 'rgba(255,255,255,0.4)', fontSize: 14 },

  cancelBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontSize: 18, color: '#fff' },
  shutterBtn: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#fff' },
  shutterInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff' },
  cameraControlsOverlay: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingHorizontal: 32, paddingTop: 20 },

  previewImage: { width: '100%', height: 320 },
  previewActions: { paddingHorizontal: 20, paddingTop: 20 },
  consentTitle: { fontSize: 20, fontWeight: '800', color: '#fff', marginBottom: 6 },
  consentSubtitle: { fontSize: 14, color: 'rgba(255,255,255,0.6)', marginBottom: 14 },
  consentFine: { fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 17, marginBottom: 22 },
  submitBtn: { backgroundColor: AMBER, borderRadius: 14, paddingVertical: 17, alignItems: 'center', marginBottom: 12 },
  submitBtnText: { fontSize: 15, fontWeight: '700', color: NAVY },
  retakeBtn: { alignItems: 'center', paddingVertical: 12 },
  retakeBtnText: { fontSize: 14, color: 'rgba(255,255,255,0.4)' },

  submittedText: { fontSize: 20, fontWeight: '800', color: '#fff', marginBottom: 20 },
  doneBtn: { backgroundColor: AMBER, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32 },
  doneBtnText: { color: NAVY, fontWeight: '700', fontSize: 15 },
})
