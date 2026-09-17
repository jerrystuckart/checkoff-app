// Archetype Fallback Artwork — Hardening pass (2026-09-17)
//
// Pure, framework-free state machine for ArchetypeArtwork's remote-image
// load lifecycle: idle -> loading -> loaded, or idle -> loading -> failed.
// Extracted out of the component so the actual load/visibility logic has
// real automated coverage in a repo with no RN component-render harness
// (see lib/*.test.js — all plain node:test over pure logic).
//
// This module knows nothing about React, <Image>, or the network — it
// only answers two questions from a (state, url) pair:
//   1. given an event (candidate url changed / onLoad fired / onError
//      fired), what is the new state?
//   2. given the current state, should the remote layer be visible right
//      now (isRemoteVisible), or should the generic base layer alone be
//      considered the current visible truth (isGenericAlone)?
//
// The generic base layer is ALWAYS rendered by the caller regardless of
// this module's state (see components/home/ArchetypeArtwork.jsx) — this
// module only controls the REMOTE overlay's opacity, never removes the
// base layer, so there is no state in which a card can show a blank
// space, a native broken-image icon, or a transparent hole.

export const STATUS = Object.freeze({
  IDLE: 'idle',       // no candidate url — nothing to load
  LOADING: 'loading',  // a candidate url is set, image not yet resolved
  LOADED: 'loaded',    // that exact url's onLoad fired
  FAILED: 'failed',    // that exact url's onError fired
})

export function createArchetypeLoadState() {
  return { status: STATUS.IDLE, url: null }
}

/**
 * Called whenever the candidate url changes (new item, different resolved
 * archetype key, or the tier flipped away from 'archetype' entirely so
 * url became null/undefined). Resets to IDLE for a new/absent url, and is
 * a no-op if the url hasn't actually changed — an unrelated re-render
 * must never restart an in-flight or already-resolved load.
 *
 * @param {{status: string, url: string|null}} state
 * @param {string|null|undefined} url
 */
export function withCandidateUrl(state, url) {
  const nextUrl = url || null
  if (!nextUrl) return createArchetypeLoadState()
  if (state.url === nextUrl) return state
  return { status: STATUS.LOADING, url: nextUrl }
}

/**
 * Called from the <Image>'s onLoad. Ignored (stale-callback guard) if the
 * url this fired for is no longer the one being tracked — e.g. the item
 * changed mid-flight and a late onLoad arrives for a url the component has
 * already moved on from.
 */
export function markLoaded(state, url) {
  if (state.url !== url) return state
  return { status: STATUS.LOADED, url }
}

/**
 * Called from the <Image>'s onError. Same stale-callback guard as
 * markLoaded. No retry is ever scheduled by this module — once FAILED,
 * that url stays FAILED until a new candidate url arrives via
 * withCandidateUrl.
 */
export function markFailed(state, url) {
  if (state.url !== url) return state
  return { status: STATUS.FAILED, url }
}

/** Should the remote decorative image be shown (opacity 1) right now? */
export function isRemoteVisible(state) {
  return state.status === STATUS.LOADED
}

/** Is the generic base layer the only thing that should read as visible? */
export function isGenericAlone(state) {
  return state.status !== STATUS.LOADED
}
