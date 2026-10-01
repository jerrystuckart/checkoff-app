// Canonical link contract for email destinations (server side mirror of lib/emailLinkContract.js in the app).
// The app owns the contract; a parity test (linkContract.test.ts) imports the app module and asserts these
// builders and the validators produce identical results, so the two cannot drift.
//
//   Home    https://getcheckoff.com/open
//   Item    https://getcheckoff.com/item/<item uuid>
//   List    https://getcheckoff.com/list?id=<lists.id or curated_lists.id uuid>
//   Metro   https://getcheckoff.com/metro?slug=<metro_areas.slug>

export const SITE_ORIGIN = 'https://getcheckoff.com';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const METRO_SLUG_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/i;

export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
export const isMetroSlug = (v: unknown): v is string => typeof v === 'string' && METRO_SLUG_RE.test(v);

export function homeUrl(): string { return `${SITE_ORIGIN}/open`; }

export function itemUrl(id: string): string {
  if (!isUuid(id)) throw new Error('itemUrl: invalid item id');
  return `${SITE_ORIGIN}/item/${id.toLowerCase()}`;
}

export function listUrl(id: string): string {
  if (!isUuid(id)) throw new Error('listUrl: invalid list id');
  return `${SITE_ORIGIN}/list?id=${id.toLowerCase()}`;
}

export function metroUrl(slug: string): string {
  if (!isMetroSlug(slug)) throw new Error('metroUrl: invalid metro slug');
  return `${SITE_ORIGIN}/metro?slug=${encodeURIComponent(slug.toLowerCase())}`;
}

export type LinkIntent =
  | { type: 'home' } | { type: 'item'; id: string } | { type: 'list'; id: string }
  | { type: 'metro'; slug: string } | { type: 'invalid'; reason: string };

// Parses a campaign destination (canonical https form, older forms, or checkoff://) into an intent.
export function parseDestination(input: string): LinkIntent {
  let path: string; let query: URLSearchParams;
  const raw = String(input ?? '').trim();
  if (/^checkoff:\/\//i.test(raw)) {
    const rest = raw.replace(/^checkoff:\/\//i, '');
    path = '/' + rest.split(/[?#]/)[0].replace(/^\/+/, '');
    query = new URLSearchParams(rest.includes('?') ? rest.split('?')[1].split('#')[0] : '');
  } else {
    let u: URL;
    try { u = new URL(raw); } catch { return { type: 'invalid', reason: 'unparseable' }; }
    if (u.protocol !== 'https:' || (u.hostname !== 'getcheckoff.com' && u.hostname !== 'www.getcheckoff.com')) {
      return { type: 'invalid', reason: 'foreign_host' };
    }
    path = u.pathname; query = u.searchParams;
  }
  const segs = path.split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
  const head = (segs[0] || '').toLowerCase();
  if (head === 'open' || head === 'home' || head === '') return { type: 'home' };
  if (head === 'item') { const id = segs[1] ?? query.get('id'); return isUuid(id) ? { type: 'item', id: id.toLowerCase() } : { type: 'invalid', reason: 'bad_item_id' }; }
  if (head === 'list') { const id = query.get('id') ?? segs[1]; return isUuid(id) ? { type: 'list', id: id.toLowerCase() } : { type: 'invalid', reason: 'bad_list_id' }; }
  if (head === 'metro') { const slug = query.get('slug') ?? segs[1]; return isMetroSlug(slug) ? { type: 'metro', slug: slug.toLowerCase() } : { type: 'invalid', reason: 'bad_metro_slug' }; }
  return { type: 'invalid', reason: 'unknown_route' };
}
