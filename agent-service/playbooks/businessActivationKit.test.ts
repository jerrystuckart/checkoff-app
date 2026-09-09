import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateActivationKitReference, evaluateActivationKitGate, UNIVERSAL_BUSINESS_ACTIVATION_KIT_URL, ACTIVATION_KIT_GATE_KEY } from './businessActivationKit'

test('validateActivationKitReference: passes clean copy referencing only the universal URL', () => {
  const result = validateActivationKitReference(`Download your free kit: ${UNIVERSAL_BUSINESS_ACTIVATION_KIT_URL}`)
  assert.equal(result.pass, true)
})

test('validateActivationKitReference: rejects a metro-specific kit URL/filename', () => {
  const result = validateActivationKitReference('Download checkoff-featured-kit-vienna.zip for your table stand.')
  assert.equal(result.pass, false)
  assert.match(result.issues[0], /metro-specific kit/)
})

test('validateActivationKitReference: rejects any city-suffixed featured-kit reference, not just an enumerated list', () => {
  const result = validateActivationKitReference('See featured-kit-milwaukee for print materials.')
  assert.equal(result.pass, false)
})

test('validateActivationKitReference: flags a /confirm/<token> link used alongside customer-facing kit/signage language', () => {
  const result = validateActivationKitReference('Print your table stand and digital signage kit here: https://getcheckoff.com/confirm/abc123')
  assert.equal(result.pass, false)
  assert.match(result.issues[0], /business-operations/)
})

test('validateActivationKitReference: a bare /confirm/<token> link with no kit/signage language is fine (real business-ops use)', () => {
  const result = validateActivationKitReference('Please confirm your business listing: https://getcheckoff.com/confirm/abc123')
  assert.equal(result.pass, true)
})

test('evaluateActivationKitGate: PASSes only when the URL is live, assets accessible, and copy is clean', () => {
  const result = evaluateActivationKitGate({ kitUrlLive: true, assetsAccessible: true, outreachCopy: `Free materials: ${UNIVERSAL_BUSINESS_ACTIVATION_KIT_URL}` })
  assert.equal(result.verdict, 'PASS')
  assert.equal(result.key, ACTIVATION_KIT_GATE_KEY)
  assert.match(result.reason, /UNIVERSAL BUSINESS ACTIVATION KIT VERIFIED/)
})

test('evaluateActivationKitGate: FAILs if the canonical URL is not confirmed live', () => {
  const result = evaluateActivationKitGate({ kitUrlLive: false, assetsAccessible: true, outreachCopy: 'no kit mentioned' })
  assert.equal(result.verdict, 'FAIL')
  assert.match(result.reason, /did not respond/)
})

test('evaluateActivationKitGate: FAILs if outreach copy references a metro-specific kit, even when the canonical URL is live', () => {
  const result = evaluateActivationKitGate({ kitUrlLive: true, assetsAccessible: true, outreachCopy: 'Download checkoff-featured-kit-vienna.zip' })
  assert.equal(result.verdict, 'FAIL')
  assert.match(result.reason, /metro-specific kit/)
})
