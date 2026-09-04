import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractThingFromBody, deriveVenueAndThing } from './whatsGoodItemPresentation.js'

test('trailing "at \'Venue\'" clause with no following text is removed cleanly', () => {
  assert.equal(extractThingFromBody("Order an appetizer at 'Citizen Public House'", 'Citizen Public House'), 'Order an appetizer')
})

test('trailing "at \'Venue\'" clause followed by a period rejoins cleanly, no dangling space', () => {
  assert.equal(
    extractThingFromBody("See a show in Tucson's restored historic movie palace at 'Fox Tucson Theatre'.", 'Fox Tucson Theatre'),
    "See a show in Tucson's restored historic movie palace."
  )
})

test('"at \'Venue\'" clause mid-sentence with trailing supporting copy is removed, supporting copy preserved', () => {
  assert.equal(
    extractThingFromBody("Get the prickly pear soft serve twist with a lime dip at 'Topo' — a $2.50 Arizona original", 'Topo'),
    'Get the prickly pear soft serve twist with a lime dip — a $2.50 Arizona original'
  )
})

test('mismatched quote characters around the venue name are still matched and removed', () => {
  assert.equal(
    extractThingFromBody('Try the Secret Item at "Baba\'s Burgers & Birds\'', "Baba's Burgers & Birds"),
    'Try the Secret Item'
  )
})

test('venue name embedded WITHOUT a preceding "at" is left completely untouched (demonstrably-safe pattern does not match, no mangling)', () => {
  const body = "Walk the full loop around the 'Wisconsin State Capitol' at golden hour and stop when the light hits the dome"
  assert.equal(extractThingFromBody(body, 'Wisconsin State Capitol'), body)
})

test('body with no venue clause at all is left completely untouched', () => {
  assert.equal(extractThingFromBody('Sample some Rattlesnake', 'Some Venue'), 'Sample some Rattlesnake')
})

test('no venue name available: body returned exactly as-is', () => {
  assert.equal(extractThingFromBody('Sample some Rattlesnake', null), 'Sample some Rattlesnake')
})

test('no body: returns empty string, never throws', () => {
  assert.equal(extractThingFromBody(null, 'Some Venue'), '')
  assert.equal(extractThingFromBody(undefined, 'Some Venue'), '')
})

test('venue name containing regex-special characters (e.g. parentheses) does not throw and matches literally', () => {
  assert.equal(extractThingFromBody("Grab a bite at 'Bob\'s (Downtown)'", "Bob's (Downtown)"), 'Grab a bite')
})

test('deriveVenueAndThing returns both the venue name and the cleaned thing together', () => {
  const item = { partnerName: 'AZ/88', body: "Enjoy a hamburger at 'AZ/88'" }
  assert.deepEqual(deriveVenueAndThing(item), { venueName: 'AZ/88', thing: 'Enjoy a hamburger' })
})

test('deriveVenueAndThing with no partnerName: venueName is null, thing is the untouched body', () => {
  const item = { partnerName: null, body: 'Sample some Rattlesnake' }
  assert.deepEqual(deriveVenueAndThing(item), { venueName: null, thing: 'Sample some Rattlesnake' })
})
