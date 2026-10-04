// The one place the running binary's identity is read for visit recovery: platform + native runtime version.
// (Pure policy lives in recoveryPolicy.js; this file only supplies the inputs.)
import { Platform } from 'react-native'
import * as Updates from 'expo-updates'
import { supportsVisitRecovery } from './recoveryPolicy'

export function currentRuntimeVersion() {
  return Updates.runtimeVersion ?? null
}

/** True when THIS binary can run visit recovery (iOS always; Android only on a build that declares background location). */
export function deviceSupportsVisitRecovery() {
  return supportsVisitRecovery(Platform.OS, currentRuntimeVersion())
}
