import React, { useState, useEffect } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase } from '../lib/supabase'

const AMBER = '#F5A623'
const NAVY  = '#1A1A2E'

export default function ResetPasswordScreen({ route, navigation }) {
  const insets = useSafeAreaInsets()
  const [password, setPassword]         = useState('')
  const [confirm, setConfirm]           = useState('')
  const [loading, setLoading]           = useState(false)
  const [showPass, setShowPass]         = useState(false)
  const [sessionReady, setSessionReady] = useState(false)
  const [error, setError]               = useState(null)

  useEffect(() => {
    setupSession()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
        setSessionReady(true)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  async function setupSession() {
    // First check if there are tokens in the route params (from Universal Link)
    const params       = route?.params ?? {}
    const accessToken  = params.access_token
    const refreshToken = params.refresh_token
    const tokenHash    = params.token

    // PKCE flow — Supabase (v2 default) sends a short-lived ?code= param.
    // Exchange it for a real session before anything else.
    if (params.code) {
      const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(params.code)
      if (exchangeErr) {
        setError('This reset link has expired. Please request a new one.')
      } else {
        setSessionReady(true)
      }
      return
    }

    if (accessToken && refreshToken) {
      // Set the session directly from the tokens passed via Universal Link
      const { error: sessionErr } = await supabase.auth.setSession({
        access_token:  accessToken,
        refresh_token: refreshToken,
      })
      if (sessionErr) {
        setError('This reset link has expired. Please request a new one.')
      } else {
        setSessionReady(true)
      }
      return
    }

    if (tokenHash) {
      // Legacy OTP token flow
      const { error: verifyErr } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: 'recovery',
      })
      if (verifyErr) {
        setError('This reset link has expired. Please request a new one.')
      } else {
        setSessionReady(true)
      }
      return
    }

    // No params — check if there's already a recovery session active
    const { data } = await supabase.auth.getSession()
    if (data.session) {
      setSessionReady(true)
    } else {
      setError('Invalid or expired reset link. Please request a new password reset.')
    }
  }

  async function updatePassword() {
    if (!password.trim()) {
      Alert.alert('Enter a new password')
      return
    }
    if (password.length < 8) {
      Alert.alert('Password must be at least 8 characters')
      return
    }
    if (password !== confirm) {
      Alert.alert('Passwords do not match')
      return
    }

    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (error) {
      Alert.alert('Could not update password', error.message)
    } else {
      Alert.alert(
        'Password updated!',
        'Your password has been changed. You are now signed in.',
        [{ text: 'Continue', onPress: () => navigation.replace('Home') }]
      )
    }
  }

  if (!sessionReady) {
    return (
      <View style={[styles.container, styles.center]}>
        {error ? (
          <>
            <Text style={{ fontSize: 28, marginBottom: 16 }}>⚠️</Text>
            <Text style={[styles.title, { textAlign: 'center', marginBottom: 12 }]}>Link expired</Text>
            <Text style={[styles.sub, { textAlign: 'center', marginBottom: 28 }]}>{error}</Text>
            <TouchableOpacity
              style={styles.btn}
              onPress={() => navigation.replace('SignIn')}
            >
              <Text style={styles.btnText}>Request new reset link</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <ActivityIndicator color={AMBER} size="large" />
            <Text style={styles.waitText}>Verifying reset link…</Text>
          </>
        )}
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.content}>
        <Text style={styles.logo}>Check<Text style={styles.logoOff}>Off</Text></Text>
        <Text style={styles.title}>Set new password</Text>
        <Text style={styles.sub}>Choose a strong password for your account.</Text>

        <View style={styles.inputWrap}>
          <TextInput
            style={[styles.input, { paddingRight: 50 }]}
            value={password}
            onChangeText={setPassword}
            placeholder="New password"
            placeholderTextColor="rgba(255,255,255,0.3)"
            secureTextEntry={!showPass}
            autoCapitalize="none"
          />
          <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPass(v => !v)}>
            <Text style={styles.eyeText}>{showPass ? '●' : '○'}</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.inputWrap, { marginTop: 10 }]}>
          <TextInput
            style={styles.input}
            value={confirm}
            onChangeText={setConfirm}
            placeholder="Confirm new password"
            placeholderTextColor="rgba(255,255,255,0.3)"
            secureTextEntry={!showPass}
            autoCapitalize="none"
            returnKeyType="done"
            onSubmitEditing={updatePassword}
          />
        </View>

        {password.length > 0 && confirm.length > 0 && password !== confirm && (
          <Text style={styles.mismatch}>Passwords do not match</Text>
        )}

        <TouchableOpacity
          style={[styles.btn, loading && { opacity: 0.6 }]}
          onPress={updatePassword}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color={NAVY} />
            : <Text style={styles.btnText}>Update password</Text>
          }
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#0F0F1E' },
  content:    { flex: 1, padding: 28, justifyContent: 'center' },
  center:     { alignItems: 'center', justifyContent: 'center' },
  waitText:   { color: 'rgba(255,255,255,0.4)', fontSize: 14, marginTop: 16 },

  logo:       { fontSize: 36, fontWeight: '800', color: AMBER, letterSpacing: -1, marginBottom: 24 },
  logoOff:    { color: '#fff' },
  title:      { fontSize: 22, fontWeight: '700', color: '#fff', marginBottom: 8 },
  sub:        { fontSize: 14, color: 'rgba(255,255,255,0.45)', marginBottom: 28, lineHeight: 20 },

  inputWrap:  { position: 'relative' },
  input:      { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 14, paddingVertical: 15, paddingHorizontal: 18, color: '#fff', fontSize: 15, borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.15)' },
  eyeBtn:     { position: 'absolute', right: 16, top: 0, bottom: 0, justifyContent: 'center' },
  eyeText:    { fontSize: 14, color: 'rgba(255,255,255,0.4)' },
  mismatch:   { fontSize: 12, color: '#D85A30', marginTop: 6 },

  btn:        { backgroundColor: AMBER, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 20 },
  btnText:    { fontSize: 16, fontWeight: '700', color: NAVY },
})