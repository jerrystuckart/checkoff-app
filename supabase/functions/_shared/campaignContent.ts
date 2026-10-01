// Live city data and per month content for the recap campaign. Pure functions only (no network),
// so they can be unit tested. The edge function supplies rows from get_recap_campaign_cities().

export type CityRow = {
  metro_id: string;
  name: string;
  slug: string;
  created_at: string;
  active_items: number;
  public_official_lists: number;
  season_list_id: string | null;
  season_name: string | null;
  destination_list_id: string | null;
  destination_list_title: string | null;
};

// A metro counts as "live" in the email only when it is active AND has meaningful approved content:
// enough approved items, at least one public official list, and a list to send people to.
export const MIN_ITEMS_FOR_LIVE_CITY = 30;

export function isLiveCity(r: CityRow): boolean {
  return (r.active_items ?? 0) >= MIN_ITEMS_FOR_LIVE_CITY
    && (r.public_official_lists ?? 0) >= 1
    && !!r.destination_list_id;
}

export function selectLiveCities(rows: CityRow[]): CityRow[] {
  return [...(rows || [])].filter(isLiveCity).sort((a, b) => a.name.localeCompare(b.name));
}

// Which metros were new in a given recap month. This is an editorial list, re-verified at send time:
// a slug only counts if it is still live in production, so a staged or inactive city is never
// described as launched. Months without an entry simply have no "new cities" announcement.
export const MONTHLY_NEW_METRO_SLUGS: Record<string, string[]> = {
  '2026-09': ['san-diego', 'vienna_austria', 'green-bay', 'florence', 'munich', 'amalfi-coast'],
};

export function newCitiesForMonth(month: string, live: CityRow[]): CityRow[] {
  const wanted = new Set(MONTHLY_NEW_METRO_SLUGS[month] ?? []);
  return live.filter((c) => wanted.has(c.slug));
}

// Official, verified social profiles. Only the Instagram account is verifiable from an authoritative
// production source (the live getcheckoff.com site links it). No TikTok or Facebook URL exists in
// any production source, so none is included and none is guessed.
export const OFFICIAL_SOCIAL_LINKS: { label: string; url: string }[] = [
  { label: 'Instagram', url: 'https://www.instagram.com/checkoff.app/' },
];

export const APP_STORE_URL = 'https://apps.apple.com/us/app/checkoff/id6762678030';
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.getcheckoff.app';
