// Thin wrapper over the optional native module (modules/checkoff-movement). `requireOptionalNativeModule` returns null on a binary
// that does not contain it (every build before the next TestFlight build), so this file is safe to import anywhere: movement refresh
// simply reports 'unavailable' there. JS can never enable the native service on a binary that lacks it.
import { requireOptionalNativeModule } from 'expo-modules-core'

const native = requireOptionalNativeModule('CheckoffMovement')

export function isMovementNativeInstalled() { return native != null }

export async function movementAvailable() {
  if (!native) return false
  try { return await native.isAvailableAsync() } catch { return false }
}
/** 'started' | 'unavailable' | 'no_always_permission' | 'not_installed' */
/** 'not_installed' (binary without the module) | 'running' | 'off' */
export async function movementStatus() {
  if (!native) return 'not_installed'
  try { return (await native.isEnabledAsync()) ? 'running' : 'off' } catch { return 'off' }
}
/** 'started' | 'unavailable' | 'no_always_permission' | 'not_installed' */
export async function startMovement() {
  if (!native) return 'not_installed'
  try { return await native.startAsync() } catch (e) { return 'error' }
}
export async function stopMovement() {
  if (!native) return
  try { await native.stopAsync() } catch {}
}
export async function consumeMovementHints() {
  if (!native) return []
  try { return (await native.consumePendingAsync()) ?? [] } catch { return [] }
}
/** Registers the listener once, at module load (so a background relaunch that runs JS headless is handled). Returns an unsubscribe. */
export function onMovement(cb) {
  if (!native || typeof native.addListener !== 'function') return () => {}
  const sub = native.addListener('onMovement', cb)
  return () => { try { sub?.remove?.() } catch {} }
}
