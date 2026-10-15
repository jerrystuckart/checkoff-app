import { test } from 'node:test'
import assert from 'node:assert/strict'
import { StackRouter, StackActions, CommonActions } from '@react-navigation/routers'
import { dismissSignInRoute } from './signInNavigation.js'

// Drives the REAL stack router, so these tests describe actual React Navigation 7 behaviour, not a mock of it.
function makeStack(routeNames, initial) {
  const router = StackRouter({ initialRouteName: initial })
  const opts = { routeNames, routeParamList: {}, routeGetIdList: {} }
  let state = router.getInitialState(opts)
  const names = () => state.routes.map((r) => r.name)
  const apply = (action) => {
    const next = router.getStateForAction(state, action, opts)
    if (next) state = next
    return next
  }
  // The `navigation` object a screen gets: getState() is its own stack's state; pop() is scoped to the focused route.
  const navigation = {
    getState: () => state,
    pop: () => apply(StackActions.pop(1)),
  }
  return { names, apply, navigation, getState: () => state }
}

const go = (name, params) => CommonActions.navigate({ name, params })

test('React Navigation 7 navigate() does not pop back: it pushes a duplicate (why the SignIn route stays behind)', () => {
  const s = makeStack(['Home', 'SignIn'], 'Home')
  s.apply(go('SignIn'))
  s.apply(go('Home'))
  assert.deepEqual(s.names(), ['Home', 'SignIn', 'Home'])
})

test('Profile stack: dismissing SignIn before leaving leaves only Profile, so the tab reopens on the real Profile', () => {
  const s = makeStack(['Profile', 'SignIn', 'Badges'], 'Profile')
  s.apply(go('SignIn')) // guest taps "Sign in" on the Profile tab
  assert.deepEqual(s.names(), ['Profile', 'SignIn'])
  dismissSignInRoute(s.navigation)
  assert.deepEqual(s.names(), ['Profile'])
})

test('Lists stack: same fix applies when the guest signed in from Lists', () => {
  const s = makeStack(['Lists', 'SignIn'], 'Lists')
  s.apply(go('SignIn'))
  dismissSignInRoute(s.navigation)
  assert.deepEqual(s.names(), ['Lists'])
})

test('Home stack default return: no leftover SignIn and no duplicate Home', () => {
  const s = makeStack(['Home', 'SignIn'], 'Home')
  s.apply(go('SignIn'))
  dismissSignInRoute(s.navigation)
  s.apply(go('Home')) // navigateAfterAuth's default destination, now the current route so it only updates params
  assert.deepEqual(s.names(), ['Home'])
})

test('Return-to-item flow keeps the original ItemDetail (no duplicate, params delivered)', () => {
  const s = makeStack(['Home', 'ItemDetail', 'SignIn'], 'Home')
  s.apply(go('ItemDetail', { item: { id: 1 } }))
  s.apply(go('SignIn', { returnToItem: { item: { id: 1 } } }))
  dismissSignInRoute(s.navigation)
  s.apply(go('ItemDetail', { item: { id: 1 }, pendingAction: 'save' }))
  assert.deepEqual(s.names(), ['Home', 'ItemDetail'])
  assert.equal(s.getState().routes[1].params.pendingAction, 'save')
})

test('Return-to-invite flow keeps a single JoinList', () => {
  const s = makeStack(['Home', 'JoinList', 'SignIn'], 'Home')
  s.apply(go('JoinList', { invite_code: 'ABC' }))
  s.apply(go('SignIn', { returnToInvite: 'ABC' }))
  dismissSignInRoute(s.navigation)
  s.apply(go('JoinList', { invite_code: 'ABC' }))
  assert.deepEqual(s.names(), ['Home', 'JoinList'])
})

test('SignIn that is the only route (deep link / cold start) is left alone: nothing to pop, no crash', () => {
  const s = makeStack(['SignIn'], 'SignIn')
  dismissSignInRoute(s.navigation)
  assert.deepEqual(s.names(), ['SignIn'])
  assert.doesNotThrow(() => dismissSignInRoute({}))
  assert.doesNotThrow(() => dismissSignInRoute(null))
})
