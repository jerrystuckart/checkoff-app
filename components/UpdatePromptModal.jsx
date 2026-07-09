import React, { useEffect, useRef, useState } from 'react'
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Animated,
  Linking,
  StyleSheet,
  StatusBar,
} from 'react-native'

const AMBER = '#F5A623'
const DARK  = '#0F0F1E'
const NAVY  = '#243045'

export default function UpdatePromptModal({ visible, force, config, onDismiss }) {
  const scaleAnim   = useRef(new Animated.Value(0.85)).current
  const opacityAnim = useRef(new Animated.Value(0)).current
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!visible) { setShow(false); return }

    // Soft update gets a 2-second delay before appearing
    const delay = force ? 0 : 2000
    const timer = setTimeout(() => {
      setShow(true)
      Animated.parallel([
        Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 80, friction: 8 }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
      ]).start()
    }, delay)

    return () => clearTimeout(timer)
  }, [visible, force])

  function openStore() {
    const url = config?.app_store_url
    if (url) Linking.openURL(url).catch(() => {})
  }

  if (!show) return null

  const title   = force ? (config?.force_update_message ?? 'Update Required') : (config?.update_title ?? 'Update Available')
  const message = force
    ? 'This version of CheckOff is no longer supported. Please update to continue.'
    : (config?.update_message ?? 'A new version of CheckOff is available.')

  return (
    <Modal
      visible={show}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={force ? undefined : onDismiss}
    >
      <StatusBar barStyle="light-content" />
      <View style={s.overlay}>
        <Animated.View style={[s.card, { transform: [{ scale: scaleAnim }], opacity: opacityAnim }]}>
          <Text style={s.emoji}>🚀</Text>
          <Text style={s.title}>{title}</Text>
          <Text style={s.message}>{message}</Text>

          <TouchableOpacity style={s.primaryBtn} onPress={openStore} activeOpacity={0.85}>
            <Text style={s.primaryBtnText}>Update Now</Text>
          </TouchableOpacity>

          {!force && (
            <TouchableOpacity style={s.ghostBtn} onPress={onDismiss} activeOpacity={0.7}>
              <Text style={s.ghostBtnText}>Maybe Later</Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15,15,30,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    width: '100%',
    maxWidth: 360,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 12,
  },
  emoji: {
    fontSize: 52,
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: NAVY,
    textAlign: 'center',
    marginBottom: 12,
  },
  message: {
    fontSize: 15,
    color: '#555',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  primaryBtn: {
    backgroundColor: AMBER,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 32,
    width: '100%',
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 16,
    letterSpacing: 0.3,
  },
  ghostBtn: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  ghostBtnText: {
    color: '#999',
    fontWeight: '600',
    fontSize: 14,
  },
})
