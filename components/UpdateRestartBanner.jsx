// OTA Update Restart Banner (2026-09-20) — tells the user a downloaded
// OTA update is ready and lets them apply it with an explicit restart tap.
// Never auto-reloads. See lib/updateBannerVisibility.js for the pure
// show/hide + unsafe-route rules and lib/updateReloadGuard.js for the
// tap-guard/retry policy this component wires up to the real
// expo-updates APIs.
//
// Detection: Updates.useUpdates()'s isUpdatePending, confirmed present in
// the installed expo-updates ~55.0.30 (node_modules/expo-updates/build/
// UseUpdates.js exports useUpdates and is a plain state-reader — it does
// not throw in dev/Expo Go, it just reports isUpdatePending: false there,
// same as the SDK's own documented behavior), per the task's explicit
// preference for this over the addListener/manual-tracking fallback.
//
// Foreground re-check: this app previously had NO foreground/resume
// update check anywhere (grepped for Updates.checkForUpdateAsync /
// fetchUpdateAsync — no hits before this file). expo-updates' own
// launch-time check (expo.updates in app.json, checkAutomatically
// defaulting to ON_LOAD) is untouched and still runs on cold start. This
// component ADDS ONE additional check when the app returns to the
// foreground, reusing the AppState 'change' listener idiom already
// established in lib/currentLocation.js, gated by a 30-minute cooldown
// (FOREGROUND_CHECK_COOLDOWN_MS below) so it can never poll repeatedly —
// e.g. rapid app-switching won't trigger a burst of network checks. 30
// minutes was chosen as a reasonable balance: frequent enough that an
// update published earlier in the day reaches an already-open app within
// a session, infrequent enough to not add meaningful network/battery
// overhead. All Updates.* calls here are wrapped in try/catch and never
// surface an error to the user — offline, timeout, disabled-updates, and
// Expo Go/dev-mode failures all fail silently and never affect normal use.

import React, { useEffect, useRef, useState } from 'react'
import { View, Text, TouchableOpacity, ActivityIndicator, AppState, StyleSheet, Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Updates from 'expo-updates'

import { useTheme } from '../lib/ThemeContext'
import { shouldShowUpdateBanner } from '../lib/updateBannerVisibility'
import { attemptReload } from '../lib/updateReloadGuard'

const FOREGROUND_CHECK_COOLDOWN_MS = 30 * 60 * 1000 // 30 minutes

// Module-scoped (not per-mount) so remounts of this component (e.g. a
// splash-screen toggle unmounting/remounting App's NavigationContainer)
// don't reset the cooldown and cause an extra check.
let lastForegroundCheckAt = 0

/**
 * Best-effort foreground update check. Silently no-ops in dev/Expo Go or
 * on any failure — never throws, never shown to the user.
 */
async function checkForUpdateInBackground() {
  if (__DEV__) return
  try {
    // Updates.isEmbeddedLaunch / channel are undefined in environments
    // where expo-updates is disabled (dev client, Expo Go) — bail out
    // rather than let checkForUpdateAsync() surface a noisy rejection.
    if (!Updates.isEnabled) return
    const now = Date.now()
    if (now - lastForegroundCheckAt < FOREGROUND_CHECK_COOLDOWN_MS) return
    lastForegroundCheckAt = now

    const result = await Updates.checkForUpdateAsync()
    if (result?.isAvailable) {
      await Updates.fetchUpdateAsync()
    }
  } catch (_) {
    // Offline / timeout / disabled — fail silently, never affect app use.
  }
}

export default function UpdateRestartBanner({ currentRouteName }) {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()

  let updatesState
  try {
    // Guard the hook call itself too — belt-and-suspenders in case a
    // future SDK/environment combination makes it throw during render.
    updatesState = Updates.useUpdates()
  } catch (_) {
    updatesState = { isUpdatePending: false }
  }
  const isUpdatePending = Boolean(updatesState?.isUpdatePending)

  const [dismissed, setDismissed] = useState(false)
  const [isReloading, setIsReloading] = useState(false)
  const prevPendingRef = useRef(isUpdatePending)

  // Re-arm the "Later" dismissal whenever a NEW update becomes pending
  // (a false -> true transition) so an update that downloads later in the
  // same session can still surface the banner, even if an earlier update
  // was dismissed. This is the session-scoped-boolean approach described
  // as an acceptable alternative to per-updateId dismissal — chosen
  // because downloadedUpdate.updateId is undefined in dev/Expo Go/any
  // environment where expo-updates is disabled, so a transition-based
  // reset is the one mechanism that works uniformly everywhere.
  useEffect(() => {
    if (isUpdatePending && !prevPendingRef.current) {
      setDismissed(false)
    }
    prevPendingRef.current = isUpdatePending
  }, [isUpdatePending])

  // One additional foreground check, cooldown-gated — see file header.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        checkForUpdateInBackground()
      }
    })
    return () => subscription.remove()
  }, [])

  async function handleRestartNow() {
    await attemptReload({
      reloadFn: () => Updates.reloadAsync(),
      isReloading,
      setIsReloading,
    })
  }

  function handleLater() {
    setDismissed(true)
  }

  const visible = shouldShowUpdateBanner({ isUpdatePending, currentRouteName, dismissed })
  if (!visible) return null

  return (
    <View
      style={[
        styles.container,
        { top: insets.top + 8, backgroundColor: colors.CARD, borderColor: colors.BORDER, shadowColor: colors.SHADOW_COLOR },
      ]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <View style={styles.textBlock}>
        <Text style={[styles.title, { color: colors.TEXT }]}>CheckOff just got better</Text>
        <Text style={[styles.body, { color: colors.MUTED }]}>A quick restart will apply the latest improvements.</Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.laterBtn}
          onPress={handleLater}
          disabled={isReloading}
          accessibilityRole="button"
          accessibilityLabel="Later"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={[styles.laterText, { color: colors.MUTED }]}>Later</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.restartBtn, { backgroundColor: colors.AMBER }, isReloading && styles.restartBtnDisabled]}
          onPress={handleRestartNow}
          disabled={isReloading}
          accessibilityRole="button"
          accessibilityLabel={isReloading ? 'Restarting' : 'Restart now'}
        >
          {isReloading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.restartText}>Restart now</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 12,
    right: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 14,
    paddingHorizontal: 16,
    zIndex: 1000,
    elevation: 12,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
  },
  textBlock: {
    marginBottom: 12,
  },
  title: {
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 4,
  },
  body: {
    fontSize: 13,
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  laterBtn: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    minHeight: 44,
    justifyContent: 'center',
  },
  laterText: {
    fontSize: 14,
    fontWeight: '600',
  },
  restartBtn: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 18,
    minHeight: 44,
    minWidth: 110,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  restartBtnDisabled: {
    opacity: 0.75,
  },
  restartText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
})
