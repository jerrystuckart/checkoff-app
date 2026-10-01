// Entity resolution for explicit links (email and shared links). Every function takes the Supabase client
// as an argument and returns a plain result, so the decision logic is testable with a fake client.
//
// Rules:
//  - IDs and slugs are validated first (a malformed id never reaches a query).
//  - Entities are resolved from production data; nothing in the URL is trusted for display or routing.
//  - An item's metro comes from the item (its neighborhood), a list's metro from the list (lists.metro_id,
//    or curated_lists.city_slug), a metro link names the metro itself.
//  - Only ACTIVE metros are ever selected. An entity whose metro is inactive or unknown still opens, but
//    changes no metro.
//  - Missing, inactive, or private entities all collapse to { status: 'unavailable' } so the caller shows one
//    controlled fallback and never silently opens Browse Lists.
import { isUuid, isMetroSlug } from './emailLinkContract.js'

const METRO_COLUMNS = 'id, name, slug, state, is_active, center_lat, center_lng, boundary_radius_km, hero_images'

function activeMetro(row) {
  return row && row.is_active === true ? row : null
}

async function metroById(sb, metroId) {
  if (!metroId) return null
  const { data, error } = await sb.from('metro_areas').select(METRO_COLUMNS).eq('id', metroId).maybeSingle()
  if (error) throw error
  return activeMetro(data)
}

async function metroBySlug(sb, slug) {
  if (!slug) return null
  const { data, error } = await sb.from('metro_areas').select(METRO_COLUMNS).eq('is_active', true)
  if (error) throw error
  const wanted = String(slug).toLowerCase()
  return (data ?? []).find((m) => (m.slug ?? '').toLowerCase() === wanted) ?? null
}

// curated_lists.city_slug is a bare lowercase city ('phoenix', 'san diego', 'san-diego'); metro slugs are
// 'phoenix', 'san-diego', 'vienna_austria'. Match on either slug or "<city> Metro" name, ignoring separators.
function normalizeCity(s) {
  return String(s ?? '').toLowerCase().replace(/\s*metro$/i, '').replace(/[\s_-]+/g, '')
}

async function metroForCitySlug(sb, citySlug) {
  if (!citySlug) return null
  const { data, error } = await sb.from('metro_areas').select(METRO_COLUMNS).eq('is_active', true)
  if (error) throw error
  const want = normalizeCity(citySlug)
  return (data ?? []).find((m) => normalizeCity(m.slug) === want || normalizeCity(m.name) === want) ?? null
}

// ── Item ────────────────────────────────────────────────────────────────────
// -> { status: 'ok', item, metro | null } | { status: 'invalid' | 'unavailable' }
export async function resolveItemLink(sb, id) {
  if (!isUuid(id)) return { status: 'invalid' }
  const { data: item, error } = await sb.from('items').select('*').eq('id', id).eq('is_active', true).eq('is_approved', true).maybeSingle()
  if (error) throw error
  if (!item) return { status: 'unavailable' }
  let metro = null
  if (item.neighborhood_id) {
    const { data: hood, error: hoodError } = await sb.from('neighborhoods').select('metro_id').eq('id', item.neighborhood_id).maybeSingle()
    if (hoodError) throw hoodError
    metro = await metroById(sb, hood?.metro_id)
  }
  return { status: 'ok', item, metro }
}

// ── List ────────────────────────────────────────────────────────────────────
// A UUID names either an official/public list (lists.id, opens the List screen) or a curated list
// (curated_lists.id, opens CuratedListPreview). Non UUID ids keep the older slug and title behavior in
// the resolver screen (checkoff://list?id=west-valley-best&city=phoenix).
// -> { status: 'ok', kind: 'list', list, metro | null }
//  | { status: 'ok', kind: 'curated', curated, metro | null } | { status: 'invalid' | 'unavailable' }
export async function resolveListLink(sb, id) {
  if (!isUuid(id)) return { status: 'invalid' }

  const { data: list, error } = await sb
    .from('lists')
    .select('id, title, metro_id, is_public, is_official, hero_image_url, starts_at, ends_at')
    .eq('id', id).eq('is_public', true).maybeSingle()
  if (error) throw error
  if (list) {
    const metro = await metroById(sb, list.metro_id)
    return { status: 'ok', kind: 'list', list, metro }
  }

  const { data: curated, error: curatedError } = await sb
    .from('curated_lists')
    .select('id, title, tagline, city_slug, is_active, audience_groups (name, tagline, emoji)')
    .eq('id', id).eq('is_active', true).maybeSingle()
  if (curatedError) throw curatedError
  if (curated) {
    const metro = await metroForCitySlug(sb, curated.city_slug)
    return { status: 'ok', kind: 'curated', curated, metro }
  }
  return { status: 'unavailable' }
}

// ── Metro ───────────────────────────────────────────────────────────────────
// -> { status: 'ok', metro } | { status: 'invalid' | 'unavailable' }
export async function resolveMetroLink(sb, { slug, id } = {}) {
  if (!isMetroSlug(slug) && !isUuid(id)) return { status: 'invalid' }
  const metro = isUuid(id) ? await metroById(sb, id) : await metroBySlug(sb, slug)
  return metro ? { status: 'ok', metro } : { status: 'unavailable' }
}

// ── Navigation plans ────────────────────────────────────────────────────────
// Pure: the routes to put on the HomeStack for a resolved entity. `cold` means the resolver is the only
// route on the stack (the app was launched by the link), so Home is placed underneath and Back works.
export function planItemNavigation(result, { cold }) {
  const target = { name: 'ItemDetail', params: { item: result.item } }
  return cold ? { type: 'reset', routes: [{ name: 'Home' }, target] } : { type: 'replace', ...target }
}

export function planListNavigation(result, { cold, heroImage } = {}) {
  let target
  if (result.kind === 'list') {
    target = { name: 'List', params: { listId: result.list.id, title: result.list.title, heroImage: heroImage ?? result.list.hero_image_url ?? undefined } }
  } else {
    const ag = result.curated.audience_groups
    target = { name: 'CuratedListPreview', params: {
      curatedListId: result.curated.id,
      groupName: ag?.name ?? result.curated.title,
      groupEmoji: ag?.emoji ?? undefined,
      groupTagline: ag?.tagline ?? result.curated.tagline ?? undefined,
      citySlug: result.curated.city_slug ?? undefined,
      groupImageUrl: heroImage ?? undefined,
    } }
  }
  return cold ? { type: 'reset', routes: [{ name: 'Home' }, target] } : { type: 'replace', ...target }
}

// Metro and Home links both land on Home: Home is the metro's discovery surface and shows the selected
// metro in its header (the same surface Switch City uses).
export function planHomeNavigation() {
  return { type: 'reset', routes: [{ name: 'Home' }] }
}
