// Canonical link contract for destinations that email (and other web) links can carry.
// Pure JS, no React Native, no network: it loads under plain `node --test`, and
// supabase/functions/_shared/linkContract.ts mirrors the URL builders (a parity test keeps them equal).
//
// Four destinations, one HTTPS form each:
//   Home    https://getcheckoff.com/open
//   Item    https://getcheckoff.com/item/<item uuid>
//   List    https://getcheckoff.com/list?id=<lists.id or curated_lists.id uuid>
//   Metro   https://getcheckoff.com/metro?slug=<metro_areas.slug>
//
// Accepted but not canonical (older emails and links already in the wild):
//   /item?id=<uuid>   /list/<uuid>   /metro/<slug>   /home   and checkoff://<same paths>
//
// The app route for every form is decided by normalizeLinkPath(), which rewrites an accepted path into the
// one form the React Navigation linking config (lib/linkingConfig.js) knows how to match.

export const SITE_ORIGIN = 'https://getcheckoff.com'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// metro_areas.slug values in production: phoenix, green-bay, amalfi-coast, vienna_austria, san-diego ...
const METRO_SLUG_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/i

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value)
}

export function isMetroSlug(value) {
  return typeof value === 'string' && METRO_SLUG_RE.test(value)
}

// ── Canonical builders ──────────────────────────────────────────────────────

export function homeUrl() {
  return `${SITE_ORIGIN}/open`
}

export function itemUrl(id) {
  if (!isUuid(id)) throw new Error('itemUrl: invalid item id')
  return `${SITE_ORIGIN}/item/${id.toLowerCase()}`
}

export function listUrl(id) {
  if (!isUuid(id)) throw new Error('listUrl: invalid list id')
  return `${SITE_ORIGIN}/list?id=${id.toLowerCase()}`
}

export function metroUrl(slug) {
  if (!isMetroSlug(slug)) throw new Error('metroUrl: invalid metro slug')
  return `${SITE_ORIGIN}/metro?slug=${encodeURIComponent(slug.toLowerCase())}`
}

// The custom scheme the web fallback pages hand to an installed app ("Open in CheckOff" buttons).
export function appSchemeUrl(intent) {
  switch (intent?.type) {
    case 'home': return 'checkoff://home'
    case 'item': return `checkoff://item/${intent.id}`
    case 'list': return `checkoff://list?id=${intent.id}`
    case 'metro': return `checkoff://metro?slug=${encodeURIComponent(intent.slug)}`
    default: return null
  }
}

// ── Parsing ─────────────────────────────────────────────────────────────────
// Returns { type: 'home' } | { type: 'item', id } | { type: 'list', id } | { type: 'metro', slug }
// | { type: 'invalid', reason }. Never throws. Accepts https URLs on getcheckoff.com (or www), checkoff://
// URLs, and bare paths. Anything on another host is rejected.

function splitInput(input) {
  const raw = String(input ?? '').trim()
  if (!raw) return null
  if (/^checkoff:\/\//i.test(raw)) {
    const rest = raw.replace(/^checkoff:\/\//i, '')
    return { path: '/' + rest.split(/[?#]/)[0].replace(/^\/+/, ''), query: new URLSearchParams(rest.includes('?') ? rest.split('?')[1].split('#')[0] : '') }
  }
  if (/^https?:\/\//i.test(raw)) {
    let u
    try { u = new URL(raw) } catch { return null }
    if (u.protocol !== 'https:') return null
    if (u.hostname !== 'getcheckoff.com' && u.hostname !== 'www.getcheckoff.com') return null
    return { path: u.pathname, query: u.searchParams }
  }
  const q = raw.indexOf('?')
  const path = (q === -1 ? raw : raw.slice(0, q)).split('#')[0]
  return { path: path.startsWith('/') ? path : '/' + path, query: new URLSearchParams(q === -1 ? '' : raw.slice(q + 1).split('#')[0]) }
}

export function parseEmailLink(input) {
  const parts = splitInput(input)
  if (!parts) return { type: 'invalid', reason: 'unparseable_or_foreign_host' }
  const segs = parts.path.split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s) } catch { return s } })
  const head = (segs[0] || '').toLowerCase()

  if (head === 'open' || head === 'home' || head === '') return { type: 'home' }

  if (head === 'item') {
    const id = segs[1] ?? parts.query.get('id')
    return isUuid(id) ? { type: 'item', id: id.toLowerCase() } : { type: 'invalid', reason: 'bad_item_id' }
  }
  if (head === 'list') {
    const id = parts.query.get('id') ?? segs[1]
    return isUuid(id) ? { type: 'list', id: id.toLowerCase() } : { type: 'invalid', reason: 'bad_list_id' }
  }
  if (head === 'metro') {
    const slug = parts.query.get('slug') ?? segs[1]
    return isMetroSlug(slug) ? { type: 'metro', slug: slug.toLowerCase() } : { type: 'invalid', reason: 'bad_metro_slug' }
  }
  return { type: 'invalid', reason: 'unknown_route' }
}

// ── Path normalization for React Navigation ─────────────────────────────────
// Receives the path React Navigation extracted from a URL (for example "/item?id=..." or "metro/x") and
// returns the single form lib/linkingConfig.js matches. Paths this contract does not own are returned
// unchanged, so join links, password reset, auth confirmation and the rest keep working exactly as before.
export function normalizeLinkPath(path) {
  const original = String(path ?? '')
  const parts = splitInput(original)
  if (!parts) return original
  const head = parts.path.split('/').filter(Boolean)[0]?.toLowerCase() ?? ''
  if (!['open', 'home', 'item', 'list', 'metro'].includes(head)) return original
  const intent = parseEmailLink(original)
  switch (intent.type) {
    case 'home': return ''
    case 'item': return `item/${intent.id}`
    case 'list': return `list?id=${intent.id}`
    case 'metro': return `metro?slug=${encodeURIComponent(intent.slug)}`
    // An owned route with a bad id or slug is left as is; the resolver screen then shows a controlled
    // "not available" state (it never silently opens Browse Lists).
    default: return original
  }
}

// ── Intent to route ─────────────────────────────────────────────────────────
// The React Navigation screen and params each intent resolves to (mirrors lib/linkingConfig.js; a test runs
// every URL form through the real getStateFromPath and asserts they agree). Used by the cross repository
// smoke test to verify the final parsed navigation intent of every email link.
export function routeForIntent(intent) {
  switch (intent?.type) {
    case 'home': return { screen: 'Home', params: undefined }
    case 'item': return { screen: 'DeepLinkItemResolver', params: { id: intent.id } }
    case 'list': return { screen: 'DeepLinkListResolver', params: { id: intent.id } }
    case 'metro': return { screen: 'DeepLinkMetroResolver', params: { slug: intent.slug } }
    default: return null
  }
}
