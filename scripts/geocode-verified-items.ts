// Verified coordinate fill for active items that have a maps_query but no coordinates (visit-detection readiness).
// Read-only against Google Places (New) Text Search; writes ONLY a review JSON + a SQL file. Nothing is applied here.
// Matching uses the same classifier as the Winston geo pass (agent-service/playbooks/metroGeoEnrichment.ts
// classifyPlacesMatch); only EXACT matches whose location also lies within the metro's radius are proposed.
//
// Usage: npx tsx scripts/geocode-verified-items.ts <items.jsonl> <centerLat> <centerLng> <maxKm> <countryCode> <outPrefix>
//   items.jsonl rows: { id, body, maps_query }
import fs from 'node:fs'
import { classifyPlacesMatch, type PlacesResultLike } from '../agent-service/playbooks/metroGeoEnrichment'

const [itemsPath, latS, lngS, kmS, country, outPrefix] = process.argv.slice(2)
const center = { lat: Number(latS), lng: Number(lngS) }
const maxKm = Number(kmS)
const MAX_CALLS = 400

for (const l of fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^GOOGLE_PLACES_API_KEY=(.*)$/)
  if (m) process.env.GOOGLE_PLACES_API_KEY = m[1].trim().replace(/^["']|["']$/g, '')
}
const KEY = process.env.GOOGLE_PLACES_API_KEY
if (!KEY) throw new Error('GOOGLE_PLACES_API_KEY missing')

const rad = (d: number) => (d * Math.PI) / 180
function km(a: number, b: number, c: number, d: number) {
  const x = Math.sin(rad(c - a) / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(rad(d - b) / 2) ** 2
  return (2 * 6371 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)))
}
const q = (s: string) => `'${s.replace(/'/g, "''")}'`

async function main() {
  const rows = fs.readFileSync(itemsPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  if (rows.length > MAX_CALLS) throw new Error(`refusing ${rows.length} calls (cap ${MAX_CALLS})`)
  const out: any[] = []
  for (const r of rows) {
    // quote must open at a word boundary and close before punctuation/space, so possessives ("Franco's") never split a name
    const name = (r.body.match(/(?:^|[\s(])['‘“"]([^'‘’“”"]{2,80})['’”"](?=[\s.,;:!?)]|$)/) ?? [])[1] ?? r.maps_query
    let top: (PlacesResultLike & { types?: string[]; status?: string }) | null = null
    let apiError: string | null = null
    try {
      const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': KEY!,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.businessStatus,places.websiteUri,places.addressComponents,places.types',
        },
        body: JSON.stringify({ textQuery: r.maps_query, locationBias: { circle: { center: { latitude: center.lat, longitude: center.lng }, radius: Math.min(maxKm * 1000, 50000) } }, maxResultCount: 1 }),
      })
      const j: any = await res.json()
      if (j.error) apiError = j.error.message
      const p = j.places?.[0]
      if (p) {
        top = {
          placeId: p.id, name: p.displayName?.text ?? '', formattedAddress: p.formattedAddress ?? null,
          lat: p.location?.latitude ?? null, lng: p.location?.longitude ?? null, websiteUri: p.websiteUri ?? null,
          country: p.addressComponents?.find((c: any) => c.types?.includes('country'))?.shortText ?? null, viewportRadiusM: null,
          status: p.businessStatus,
        }
      }
    } catch (e: any) { apiError = e.message }
    const c = classifyPlacesMatch({ candidateName: name, body: r.body, expectedCountry: country, topResult: top, apiError })
    const dKm = top?.lat != null ? km(center.lat, center.lng, top.lat!, top.lng!) : null
    const accept = c.classification === 'EXACT' && dKm !== null && dKm <= maxKm && (top as any)?.status !== 'CLOSED_PERMANENTLY'
    out.push({ id: r.id, candidate: name, query: r.maps_query, classification: c.classification, reason: c.reason, accept, distKm: dKm && +dKm.toFixed(1), status: (top as any)?.status, top })
    await new Promise((s) => setTimeout(s, 120))
  }
  fs.writeFileSync(`${outPrefix}.review.json`, JSON.stringify(out, null, 1))
  const acc = out.filter((o) => o.accept)
  const sql = ['BEGIN;', ...acc.map((o) =>
    `UPDATE items SET maps_lat = ${o.top.lat}, maps_lng = ${o.top.lng}, geo_location = ST_SetSRID(ST_MakePoint(${o.top.lng}, ${o.top.lat}), 4326), geo_radius_m = COALESCE(geo_radius_m, 100), google_place_id = ${q(o.top.placeId)}, formatted_address = ${q(o.top.formattedAddress ?? '')} WHERE id = '${o.id}' AND maps_lat IS NULL; -- ${o.candidate.replace(/\n/g, ' ')} = ${o.top.name.replace(/\n/g, ' ')}`), 'COMMIT;'].join('\n')
  fs.writeFileSync(`${outPrefix}.apply.sql`, sql)
  const tally: Record<string, number> = {}
  out.forEach((o) => { tally[o.classification + (o.accept ? '+accepted' : '')] = (tally[o.classification + (o.accept ? '+accepted' : '')] ?? 0) + 1 })
  console.log('calls', out.length, tally)
}
main()
