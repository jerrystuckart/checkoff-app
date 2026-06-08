import React, { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  ScrollView,
  Keyboard,
  Platform,
  Linking,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as AppleAuthentication from 'expo-apple-authentication'
import * as Crypto from 'expo-crypto'
import { supabase } from '../lib/supabase'

const AMBER = '#F5A623'
const NAVY = '#1A1A2E'

const DEV_EMAIL    = ''
const DEV_PASSWORD = ''

export default function SignInScreen({ navigation, route }) {
  const insets  = useSafeAreaInsets()
  const { returnToInvite } = route?.params ?? {}
  const [email, setEmail]           = useState(DEV_EMAIL)
  const [password, setPassword]     = useState(DEV_PASSWORD)
  const [loading, setLoading]       = useState(false)
  const [showPass, setShowPass]     = useState(false)
  const [isSignUp, setIsSignUp]     = useState(false)
  const [displayName, setDisplayName] = useState('')

  function navigateAfterAuth() {
    Keyboard.dismiss()
    if (returnToInvite) {
      const parent = navigation.getParent()
      if (parent) parent.navigate('HomeTab', { screen: 'JoinList', params: { invite_code: returnToInvite } })
      else navigation.navigate('JoinList', { invite_code: returnToInvite })
      return
    }
    const parent = navigation.getParent()
    if (parent) parent.navigate('HomeTab', { screen: 'Home' })
    else navigation.navigate('Home')
  }

  async function signIn() {
    if (!email.trim())    { Alert.alert('Enter your email'); return }
    if (!password.trim()) { Alert.alert('Enter your password'); return }
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({
      email:    email.trim().toLowerCase(),
      password: password.trim(),
    })
    setLoading(false)
    if (error) {
      Alert.alert('Sign in failed', error.message)
    } else {
      navigateAfterAuth()
    }
  }

  async function signUp() {
    if (!displayName.trim()) { Alert.alert('Enter your name'); return }
    if (!email.trim())       { Alert.alert('Enter your email'); return }
    if (password.trim().length < 6) {
      Alert.alert('Password too short', 'Password must be at least 6 characters.')
      return
    }

    setLoading(true)

    const { data, error } = await supabase.auth.signUp({
      email:    email.trim().toLowerCase(),
      password: password.trim(),
      options: {
        data: { display_name: displayName.trim() },
      },
    })

    setLoading(false)

    if (error) {
      Alert.alert('Sign up failed', error.message)
      return
    }

    // Supabase never returns an error for duplicate emails (prevents enumeration).
    // An empty identities array is the reliable signal that the email already exists.
    if (data.user && data.user.identities?.length === 0) {
      Alert.alert(
        'Account already exists',
        'An account with that email already exists. Sign in with your password, or tap Forgot Password to set a new one.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sign in instead', onPress: () => setIsSignUp(false) },
        ]
      )
      return
    }

    // If email confirmation is required, Supabase returns a user
    // but session is null — tell them to check email
    if (data.session) {
      // Auto-confirmed (email confirmation disabled in Supabase settings)
      navigateAfterAuth()
    } else {
      Alert.alert(
        'Check your email',
        `We sent a confirmation link to ${email.trim()}. Tap it to activate your account, then sign in.`,
        [{ text: 'OK', onPress: () => setIsSignUp(false) }]
      )
    }
  }

  async function sendPasswordReset() {
    if (!email.trim()) {
      Alert.alert('Enter your email first', 'Type your email address above then tap Forgot password.')
      return
    }
    setLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(
      email.trim().toLowerCase(),
      { redirectTo: 'https://getcheckoff.com/reset-password' }
    )
    setLoading(false)
    if (error) {
      Alert.alert('Error', error.message)
    } else {
      Alert.alert(
        'Check your email',
        `A password reset link has been sent to ${email.trim()}. Tap it to set a new password.`,
        [{ text: 'OK' }]
      )
    }
  }

  async function signInWithApple() {
  try {
    // Apple embeds the SHA-256 hash of the nonce into the JWT it returns.
    // Supabase verifies by hashing the raw nonce and comparing to the JWT.
    // So: Apple gets the hash, Supabase gets the raw value.
    const rawNonce = Crypto.randomUUID()
    const hashedNonce = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      rawNonce
    )

    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    })

    if (!credential.identityToken) {
      throw new Error('Apple did not return an identity token.')
    }

    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
      nonce: rawNonce,
    })

    if (error) throw error

    // Apple only sends full name on the very first sign-in.
    // Save it to both auth metadata AND public.users.display_name.
    // Without the public.users write, the DB trigger sets display_name
    // to the private relay email local part (e.g. "2rj2v78vyn").
    if (credential.fullName?.givenName || credential.fullName?.familyName) {
      const appleDisplayName = [
        credential.fullName?.givenName,
        credential.fullName?.familyName,
      ]
        .filter(Boolean)
        .join(' ')
        .trim()

      if (appleDisplayName) {
        // Update auth metadata
        supabase.auth.updateUser({
          data: {
            full_name: appleDisplayName,
            given_name: credential.fullName?.givenName || null,
            family_name: credential.fullName?.familyName || null,
          },
        }).catch(e => console.warn('Apple auth metadata update failed:', e.message))

        // Update public.users so leaderboards and profile show the real name
        if (data?.user?.id) {
          supabase.from('users')
            .update({ display_name: appleDisplayName })
            .eq('id', data.user.id)
            .then(({ error }) => {
              if (error) console.warn('Apple display_name update failed:', error.message)
            })
        }
      }
    }

      navigateAfterAuth()
    } catch (e) {
      if (e?.code === 'ERR_REQUEST_CANCELED') {
        // User cancelled — no-op
        return
      }
      Alert.alert('Apple Sign In failed', e?.message || 'Please try again.')
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <ScrollView
          style={[styles.container, { paddingTop: insets.top }]}
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
      <View style={styles.top}>
        <Text style={styles.logo}>
          Check<Text style={styles.logoOff}>Off</Text>
        </Text>
        <Text style={styles.sub}>
          Stop saying "I don't know what to do."{'\n'}
          Challenge your crew.
        </Text>
      </View>

      <View style={styles.bullets}>
        {[
          'Browse 400+ things to do in your city',
          'Check off items and track your progress',
          'Challenge friends to beat your score',
          'Discover local spots with insider tips',
        ].map((b, i) => (
          <View key={i} style={styles.bulletRow}>
            <View style={styles.bulletDot} />
            <Text style={styles.bulletText}>{b}</Text>
          </View>
        ))}
      </View>

      <View style={[styles.form, { paddingBottom: insets.bottom + 40 }]}>

        {/* Mode toggle */}
        <View style={styles.modeToggle}>
          <TouchableOpacity
            style={[styles.modeBtn, !isSignUp && styles.modeBtnOn]}
            onPress={() => setIsSignUp(false)}
            activeOpacity={0.85}
          >
            <Text style={[styles.modeBtnText, !isSignUp && styles.modeBtnTextOn]}>Sign in</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeBtn, isSignUp && styles.modeBtnOn]}
            onPress={() => setIsSignUp(true)}
            activeOpacity={0.85}
          >
            <Text style={[styles.modeBtnText, isSignUp && styles.modeBtnTextOn]}>Create account</Text>
          </TouchableOpacity>
        </View>

        {/* Display name — sign up only */}
        {isSignUp && (
          <View style={styles.inputWrap}>
            <TextInput
              style={styles.input}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Your name"
              placeholderTextColor="rgba(255,255,255,0.3)"
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="next"
            />
          </View>
        )}

        {/* Email */}
        <View style={[styles.inputWrap, { marginTop: 10 }]}>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor="rgba(255,255,255,0.3)"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            returnKeyType="next"
          />
        </View>

        {/* Password */}
        <View style={[styles.inputWrap, { marginTop: 10 }]}>
          <TextInput
            style={[styles.input, { paddingRight: 50 }]}
            value={password}
            onChangeText={setPassword}
            placeholder={isSignUp ? 'Password (min 6 characters)' : 'Password'}
            placeholderTextColor="rgba(255,255,255,0.3)"
            secureTextEntry={!showPass}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={isSignUp ? signUp : signIn}
          />
          <TouchableOpacity
            style={styles.eyeBtn}
            onPress={() => setShowPass(v => !v)}
          >
            <Text style={styles.eyeText}>{showPass ? '●' : '○'}</Text>
          </TouchableOpacity>
        </View>

        {/* Primary action button */}
        <TouchableOpacity
          style={[styles.signInBtn, loading && { opacity: 0.6 }]}
          onPress={isSignUp ? signUp : signIn}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading
            ? <ActivityIndicator color={NAVY} />
            : <Text style={styles.signInBtnText}>
                {isSignUp ? 'Create account' : 'Sign in'}
              </Text>
          }
        </TouchableOpacity>

        {/* Apple Sign In — sign in mode only */}
        {!isSignUp && (
          <>
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              cornerRadius={14}
              style={styles.appleBtn}
              onPress={signInWithApple}
            />

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or sign in with email</Text>
              <View style={styles.dividerLine} />
            </View>

            <TouchableOpacity
              style={styles.forgotBtn}
              onPress={sendPasswordReset}
              activeOpacity={0.7}
            >
              <Text style={styles.forgotBtnText}>Forgot password?</Text>
            </TouchableOpacity>
          </>
        )}

        <Text style={styles.legal}>
          By continuing you agree to CheckOff's{' '}
          <Text style={styles.legalLink} onPress={() => Linking.openURL('https://getcheckoff.com/terms').catch(() => {})}>
            Terms of Service
          </Text>
          {' '}and{' '}
          <Text style={styles.legalLink} onPress={() => Linking.openURL('https://getcheckoff.com/privacy').catch(() => {})}>
            Privacy Policy
          </Text>
        </Text>
      </View>
        </ScrollView>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: '#0F0F1E', paddingHorizontal: 28 },

  top:           { flex: 1, justifyContent: 'center', paddingTop: 20 },
  logo:          { fontSize: 48, fontWeight: '800', color: AMBER, letterSpacing: -2, marginBottom: 12 },
  logoOff:       { color: '#fff' },
  sub:           { fontSize: 18, color: 'rgba(255,255,255,0.6)', lineHeight: 26, fontWeight: '300' },

  bullets:       { paddingBottom: 32 },
  bulletRow:     { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  bulletDot:     { width: 6, height: 6, borderRadius: 3, backgroundColor: AMBER, flexShrink: 0 },
  bulletText:    { fontSize: 14, color: 'rgba(255,255,255,0.55)', flex: 1, lineHeight: 19 },

  form:          { gap: 4 },
  inputWrap:     { position: 'relative' },
  input:         {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 18,
    color: '#fff',
    fontSize: 15,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  eyeBtn:        { position: 'absolute', right: 16, top: 0, bottom: 0, justifyContent: 'center' },
  eyeText:       { fontSize: 14, color: 'rgba(255,255,255,0.4)' },

  signInBtn:     { backgroundColor: AMBER, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 14 },
  signInBtnText: { fontSize: 16, fontWeight: '700', color: NAVY },

  legal:         { fontSize: 11, color: 'rgba(255,255,255,0.25)', textAlign: 'center', lineHeight: 16, marginTop: 12 },
  legalLink:     { color: AMBER, textDecorationLine: 'underline' },
  appleBtn:      { width: '100%', height: 48, marginTop: 12,},
  divider:       {flexDirection: 'row',  alignItems: 'center',  marginTop: 16,  marginBottom: 8,},
  dividerLine: {flex: 1,  height: 1,  backgroundColor: 'rgba(255,255,255,0.12)',},
  dividerText: {color: 'rgba(255,255,255,0.35)',  fontSize: 12,  marginHorizontal: 10,},
  forgotBtn: {alignItems: 'center',  marginTop: 10,},
  forgotBtnText: {color: AMBER,  fontSize: 14,  fontWeight: '600',},

  modeToggle: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 12,
    padding: 3,
    marginBottom: 6,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  modeBtnOn: {
    backgroundColor: AMBER,
  },
  modeBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.45)',
  },
  modeBtnTextOn: {
    color: NAVY,
    fontWeight: '800',
  },
})