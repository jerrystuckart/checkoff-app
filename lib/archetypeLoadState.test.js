import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  STATUS,
  createArchetypeLoadState,
  withCandidateUrl,
  markLoaded,
  markFailed,
  isRemoteVisible,
  isGenericAlone,
} from './archetypeLoadState.js'

const URL_A = 'https://example.com/item-fallbacks/v1/coffee.webp'
const URL_B = 'https://example.com/item-fallbacks/v1/wine.webp'

test('initial state is idle, generic alone, remote not visible', () => {
  const state = createArchetypeLoadState()
  assert.equal(state.status, STATUS.IDLE)
  assert.equal(isRemoteVisible(state), false)
  assert.equal(isGenericAlone(state), true)
})

test('pending -> loading: a candidate url moves state to LOADING, generic still alone (remote not visible)', () => {
  const state = withCandidateUrl(createArchetypeLoadState(), URL_A)
  assert.equal(state.status, STATUS.LOADING)
  assert.equal(state.url, URL_A)
  assert.equal(isRemoteVisible(state), false)
  assert.equal(isGenericAlone(state), true)
})

test('loading -> loaded: onLoad for the tracked url enables the remote layer', () => {
  let state = withCandidateUrl(createArchetypeLoadState(), URL_A)
  state = markLoaded(state, URL_A)
  assert.equal(state.status, STATUS.LOADED)
  assert.equal(isRemoteVisible(state), true)
  assert.equal(isGenericAlone(state), false)
})

test('loading -> failed: onError for the tracked url leaves the generic layer as the only visible thing, no retry', () => {
  let state = withCandidateUrl(createArchetypeLoadState(), URL_A)
  state = markFailed(state, URL_A)
  assert.equal(state.status, STATUS.FAILED)
  assert.equal(isRemoteVisible(state), false)
  assert.equal(isGenericAlone(state), true)
})

test('a stale onLoad for a url no longer being tracked is ignored', () => {
  let state = withCandidateUrl(createArchetypeLoadState(), URL_A)
  state = withCandidateUrl(state, URL_B) // item/url changed mid-flight
  const stale = markLoaded(state, URL_A) // late callback for the old url
  assert.deepEqual(stale, state) // unchanged
  assert.equal(isRemoteVisible(stale), false)
})

test('a stale onError for a url no longer being tracked is ignored', () => {
  let state = withCandidateUrl(createArchetypeLoadState(), URL_A)
  state = withCandidateUrl(state, URL_B)
  const stale = markFailed(state, URL_A)
  assert.deepEqual(stale, state)
})

test('failure state resets when the source url changes (no leaking across items)', () => {
  let state = withCandidateUrl(createArchetypeLoadState(), URL_A)
  state = markFailed(state, URL_A)
  assert.equal(state.status, STATUS.FAILED)

  state = withCandidateUrl(state, URL_B)
  assert.equal(state.status, STATUS.LOADING)
  assert.equal(state.url, URL_B)
  assert.equal(isRemoteVisible(state), false)
})

test('loaded state resets when the source url changes (no leaking a previous success into a new item)', () => {
  let state = withCandidateUrl(createArchetypeLoadState(), URL_A)
  state = markLoaded(state, URL_A)
  assert.equal(isRemoteVisible(state), true)

  state = withCandidateUrl(state, URL_B)
  assert.equal(state.status, STATUS.LOADING)
  assert.equal(isRemoteVisible(state), false)
})

test('url becoming null/falsy (tier flipped away from archetype) resets fully to idle', () => {
  let state = withCandidateUrl(createArchetypeLoadState(), URL_A)
  state = markLoaded(state, URL_A)
  state = withCandidateUrl(state, null)
  assert.equal(state.status, STATUS.IDLE)
  assert.equal(state.url, null)
  assert.equal(isGenericAlone(state), true)
})

test('withCandidateUrl is a no-op when the url has not actually changed (does not restart an in-flight or resolved load)', () => {
  let state = withCandidateUrl(createArchetypeLoadState(), URL_A)
  state = markLoaded(state, URL_A)
  const again = withCandidateUrl(state, URL_A)
  assert.deepEqual(again, state)
  assert.equal(isRemoteVisible(again), true)
})

test('deterministic: same (state, url) transitions produce the same result across calls', () => {
  const base = withCandidateUrl(createArchetypeLoadState(), URL_A)
  const a = markLoaded(base, URL_A)
  const b = markLoaded(base, URL_A)
  assert.deepEqual(a, b)
})
