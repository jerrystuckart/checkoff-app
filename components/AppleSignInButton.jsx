import React, { useState } from 'react'
import { Alert, Platform } from 'react-native'
import * as AppleAuthentication from 'expo-apple-authentication'
import * as Crypto from 'expo-crypto'
import { supabase } from '../lib/supabase' 

export default function AppleSignInButton({ onSuccess }) {
  const [loading, setLoading] = useState(false)

  if (Platform.OS !== 'ios') {
    return null
  }

  const handleAppleSignIn = async () => {
    try {
      setLoading(true)

      const available = await AppleAuthentication.isAvailableAsync()
      if (!available) {
        Alert.alert('Apple Sign In unavailable', 'This device does not support Sign in with Apple.')
        return
      }

      const nonce = Crypto.randomUUID()

      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce,
      })

      if (!credential.identityToken) {
        throw new Error('Apple did not return an identity token.')
      }

      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken,
        nonce,
      })

      if (error) {
        throw error
      }

      const givenName = credential.fullName?.givenName?.trim()
      const familyName = credential.fullName?.familyName?.trim()
      const fullName = [givenName, familyName].filter(Boolean).join(' ').trim()

      if (fullName) {
        const { error: updateError } = await supabase.auth.updateUser({
          data: {
            full_name: fullName,
            given_name: givenName || null,
            family_name: familyName || null,
          },
        })

        if (updateError) {
          console.warn('Failed to save Apple name metadata:', updateError.message)
        }
      }

      onSuccess?.(data)
    } catch (err) {
      if (err?.code === 'ERR_REQUEST_CANCELED') {
        return
      }

      console.error('Apple sign-in failed:', err)
      Alert.alert(
        'Apple Sign In failed',
        err?.message || 'Please try again.'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
      buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE_OUTLINE}
      cornerRadius={8}
      style={{ width: '100%', height: 48, opacity: loading ? 0.7 : 1 }}
      onPress={handleAppleSignIn}
    />
  )
}