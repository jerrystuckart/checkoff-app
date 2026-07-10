import React, { useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { supabase } from '../lib/supabase'

const AMBER = '#F5A623'
const NAVY  = '#1A1A2E'

export default function ConfirmEmailScreen({ route, navigation }) {
  const [error, setError] = useState(null)

  useEffect(() => {
    confirmEmail()
  }, [])

  async function confirmEmail() {
    const params       = route?.params ?? {}
    const accessToken  = params.access_token
    const refreshToken = params.refresh_token
    const tokenHash    = params.token
    const code         = params.code

    // PKCE flow — ?code= exchanged for a real session
    if (code) {
      const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code)
      if (exchangeErr) {
        setError('This confirmation link has expired. Please sign up again or contact support.')
      } else {
        navigation.replace('Home')
      }
      return
    }

    // Legacy token hash flow — ?token=xxx&type=signup
    if (tokenHash) {
      const { error: verifyErr } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: 'signup',
      })
      if (verifyErr) {
        setError('This confirmation link has expired. Please sign up again or contact support.')
      } else {
        navigation.replace('Home')
      }
      return
    }

    // Hash fragment flow — access_token + refresh_token forwarded as query params by relay page
    if (accessToken && refreshToken) {
      const { error: sessionErr } = await supabase.auth.setSession({
        access_token:  accessToken,
        refresh_token: refreshToken,
      })
      if (sessionErr) {
        setError('This confirmation link has expired. Please sign up again or contact support.')
      } else {
        navigation.replace('Home')
      }
      return
    }

    // No params — check if Supabase already established a session
    const { data } = await supabase.auth.getSession()
    if (data.session) {
      navigation.replace('Home')
    } else {
      setError('Invalid or expired confirmation link. Please sign up again or contact support.')
    }
  }

  return (
    <View style={styles.container}>
      {error ? (
        <>
          <Text style={styles.icon}>⚠️</Text>
          <Text style={styles.title}>Link expired</Text>
          <Text style={styles.sub}>{error}</Text>
          <TouchableOpacity style={styles.btn} onPress={() => navigation.replace('SignIn')}>
            <Text style={styles.btnText}>Back to sign in</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <ActivityIndicator color={AMBER} size="large" />
          <Text style={styles.wait}>Confirming your account…</Text>
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F0F1E', alignItems: 'center', justifyContent: 'center', padding: 28 },
  icon:      { fontSize: 36, marginBottom: 16 },
  title:     { fontSize: 22, fontWeight: '700', color: '#fff', marginBottom: 8, textAlign: 'center' },
  sub:       { fontSize: 14, color: 'rgba(255,255,255,0.45)', marginBottom: 28, lineHeight: 20, textAlign: 'center' },
  wait:      { color: 'rgba(255,255,255,0.4)', fontSize: 14, marginTop: 16 },
  btn:       { backgroundColor: AMBER, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 32, alignItems: 'center' },
  btnText:   { fontSize: 16, fontWeight: '700', color: NAVY },
})
