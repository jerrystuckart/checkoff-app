#!/usr/bin/env node
//
// scripts/geocode-san-diego-neighborhoods.js
//
// Real Google Places Text Search geocoding for the San Diego Metro's
// neighborhood CENTER coordinates — including the Tijuana neighborhoods,
// which per Jerry's explicit architecture decision (2026-09-06) are
// modeled as neighborhoods under San Diego's OWN metro_id, not a
// separate metro. Same API call pattern as scripts/geocode-items.js —
// per docs/metro-launch-playbook.md Phase 4: "Neighborhood coordinates
// via a live Google Places API call, same pattern as
// scripts/geocode-items.js — never estimated from memory."
//
// DRY RUN ONLY. Never writes to any table — reads nothing from Supabase
// either (these neighborhoods don't exist in production yet). Writes a
// local review CSV only.
//
// Usage: node scripts/geocode-san-diego-neighborhoods.js

const fs = require('fs')
const path = require('path')

function loadEnvFile(relPath) {
  const envPath = path.join(__dirname, '..', relPath)
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
    if (!(key in process.env)) process.env[key] = val
  }
}
loadEnvFile('.env')

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY
if (!GOOGLE_PLACES_API_KEY) {
  console.error('GOOGLE_PLACES_API_KEY not set in .env — aborting.')
  process.exit(1)
}

// San Diego neighborhoods (query includes ", San Diego, CA" for accuracy);
// Tijuana neighborhoods (query includes ", Tijuana, Mexico" explicitly —
// preserving country/geography distinction per Jerry's explicit
// requirement, even though they'll be stored under San Diego's metro_id).
const NEIGHBORHOODS = [
  ...[
    'Gaslamp Quarter', 'East Village', 'Little Italy', 'Barrio Logan', 'North Park', 'South Park',
    'Hillcrest', 'Mission Hills', 'Point Loma', 'Ocean Beach', 'Mission Beach', 'Pacific Beach',
    'La Jolla', 'Coronado', 'Chula Vista', 'Del Mar', 'Solana Beach', 'Encinitas', 'Carlsbad',
    'Oceanside', 'Escondido', 'Rancho Santa Fe', 'San Marcos', 'Vista',
    // Added after the first dry-run pass — real, frequently-referenced San Diego
    // sub-areas the original 24-neighborhood M1 list didn't cover, found by
    // inspecting the actual neighborhood-resolution failures.
    'Balboa Park', 'Downtown San Diego', 'Mission Bay', 'Old Town', 'Liberty Station',
    'Mission Valley', 'Kearny Mesa', 'San Ysidro', 'University City', 'Normal Heights',
    'University Heights', 'Mira Mesa',
  ].map((name) => ({ name, query: `${name}, San Diego, CA`, isMexico: false })),
  ...[
    { name: 'Zona Centro', query: 'Zona Centro, Tijuana, Mexico' },
    { name: 'Zona Río', query: 'Zona Río, Tijuana, Mexico' },
    { name: 'Zona Norte', query: 'Zona Norte, Tijuana, Mexico' },
    { name: 'Otay', query: 'Otay Centenario, Tijuana, Mexico' },
    { name: 'Chapultepec Alamar', query: 'Chapultepec Alamar, Tijuana, Mexico' },
  ].map((n) => ({ ...n, isMexico: true })),
]

let callCount = 0
const MAX_CALLS = 45

async function searchText(query) {
  callCount++
  if (callCount > MAX_CALLS) throw new Error(`MAX_CALLS (${MAX_CALLS}) exceeded — aborting before call #${callCount}.`)
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location',
    },
    body: JSON.stringify({ textQuery: query }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Places API error (${res.status}): ${text}`)
  }
  return res.json()
}

async function main() {
  const rows = [['name', 'query', 'isMexico', 'placeId', 'displayName', 'formattedAddress', 'lat', 'lng']]
  const results = []
  for (const n of NEIGHBORHOODS) {
    console.error(`Geocoding: ${n.query}`)
    let place = null
    try {
      const data = await searchText(n.query)
      place = (data.places ?? [])[0] ?? null
    } catch (err) {
      console.error(`  FAILED: ${err.message}`)
    }
    if (!place) {
      console.error(`  NO RESULT for "${n.query}"`)
      rows.push([n.name, n.query, n.isMexico, '', '', '', '', ''])
      results.push({ ...n, found: false })
      continue
    }
    const lat = place.location?.latitude
    const lng = place.location?.longitude
    rows.push([n.name, n.query, n.isMexico, place.id ?? '', place.displayName?.text ?? '', place.formattedAddress ?? '', lat ?? '', lng ?? ''])
    results.push({ ...n, found: true, lat, lng, formattedAddress: place.formattedAddress, displayName: place.displayName?.text })
  }

  fs.mkdirSync('scripts/output', { recursive: true })
  const csvPath = `scripts/output/san-diego-neighborhood-geocode-${new Date().toISOString().slice(0, 10)}.csv`
  fs.writeFileSync(csvPath, rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n'))
  const jsonPath = `scripts/output/san-diego-neighborhood-geocode-${new Date().toISOString().slice(0, 10)}.json`
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2))

  console.error(`\nWrote ${csvPath} and ${jsonPath}`)
  console.error(`${results.filter((r) => r.found).length}/${results.length} neighborhoods geocoded successfully. Google Places calls used: ${callCount}.`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
