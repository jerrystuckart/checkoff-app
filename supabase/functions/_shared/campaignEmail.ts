// Assembles RecapEmailData for one audience row, and builds the synthetic rows used for previews and
// isolated test sends. Network and database access are injected, so this is testable with fakes.

import {
  firstName, subjectFor, previewTextFor, assignRecommendationRoles, metroSlug, selectThemedLists,
  monthLabelFor, cityDisplayName,
  type Segment, type RawRecommendation, type MetroSource, type SubjectContext,
} from './campaignLogic.ts';
import { signToken } from './linkSigning.ts';
import type { RecapEmailData, CityLink } from './campaignTemplate.ts';
import {
  selectLiveCities, newCitiesForMonth, OFFICIAL_SOCIAL_LINKS, APP_STORE_URL, PLAY_STORE_URL,
  type CityRow,
} from './campaignContent.ts';
import type { TestVariant } from './campaignControls.ts';

export type AudienceRow = {
  user_id: string; email: string; display_name: string | null; platform: string | null;
  segment: Segment; exclusion_reason: string | null;
  metro_id: string | null; metro_name: string | null; metro_source: MetroSource;
  checkins_this_month: number; points_this_month: number; lifetime_points: number;
  completed_item_names: { id: string; body: string }[] | null;
  most_active_hood: string | null; current_streak_weeks: number | null;
  last_checkin_at: string | null; last_checkin_item_name: string | null;
  days_since_last_checkin: number | null; new_items_since_last_checkin: number;
  lifetime_checkins: number;
  season_list_id: string | null; season_name: string | null; season_ends_at: string | null;
  season_total_items: number; season_checked_count: number; season_days_remaining: number | null;
  recommended_items: RawRecommendation[] | null;
};

export type CampaignContext = {
  supabase: any;
  functionsBaseUrl: string;
  secret: string;
  campaignId: string;
  month: string;
  cities: CityRow[]; // raw rows from get_recap_campaign_cities
};

export async function buildTrackedUrl(
  ctx: Pick<CampaignContext, 'functionsBaseUrl' | 'secret'>, userId: string, campaignId: string,
  dest: string, ev: string, segment: string, extra?: { rec?: string; meta?: Record<string, unknown> },
): Promise<string> {
  const token = await signToken(ctx.secret, userId, campaignId);
  const params = new URLSearchParams({ u: userId, c: campaignId, t: token, dest, ev, seg: segment });
  if (extra?.rec) params.set('rec', extra.rec);
  if (extra?.meta) params.set('meta', JSON.stringify(extra.meta));
  return `${ctx.functionsBaseUrl}/campaign-link?${params.toString()}`;
}

// Structural filter first (curated_lists.season), title regex second (see selectThemedLists).
export async function fetchThemedLists(supabase: any, metroName: string | null): Promise<{ title: string; url: string }[]> {
  if (!metroName) return [];
  try {
    const { data, error } = await supabase
      .from('curated_lists')
      .select('id, title, slug, season')
      .eq('is_active', true)
      .eq('city_slug', metroSlug(metroName))
      .in('season', ['fall', 'anytime'])
      .order('season', { ascending: true })
      .limit(10);
    if (error || !data) return [];
    return selectThemedLists(data).map((l) => ({ title: l.title, url: `checkoff://list?id=${l.id}` }));
  } catch {
    return [];
  }
}

export function subjectContext(ctx: Pick<CampaignContext, 'month' | 'cities'>, row: Pick<AudienceRow, 'metro_source'>): SubjectContext {
  return {
    monthLabel: monthLabelFor(ctx.month),
    metroKnown: row.metro_source !== 'unknown',
    liveCityCount: selectLiveCities(ctx.cities).length,
  };
}

export async function buildEmailData(
  ctx: CampaignContext, row: AudienceRow, campaignId: string,
): Promise<{ data: RecapEmailData; recommendationIds: string[]; subject: string }> {
  const uid = row.user_id;
  const seg = row.segment;
  const track = (dest: string, ev: string, extra?: { rec?: string; meta?: Record<string, unknown> }) =>
    buildTrackedUrl(ctx, uid, campaignId, dest, ev, seg, extra);

  const sctx = subjectContext(ctx, row);
  const rawRecs = (row.recommended_items || []).slice(0, 3);
  const recommendations = await Promise.all(assignRecommendationRoles(rawRecs).map(async (r) => ({
    ...r, url: await track(r.url, 'recommendation_click', { rec: r.id }),
  })));

  const themedLists = await Promise.all((await fetchThemedLists(ctx.supabase, row.metro_name)).map(async (l) => ({
    ...l, url: await track(l.url, 'themed_list_click'),
  })));

  const live = selectLiveCities(ctx.cities);
  const cityLink = async (c: CityRow): Promise<CityLink> => ({
    name: cityDisplayName(c.name),
    url: await track(`checkoff://list?id=${c.destination_list_id}`, 'city_click', { meta: { city: c.slug } }),
  });
  const liveCities = await Promise.all(live.map(cityLink));
  const newCities = await Promise.all(newCitiesForMonth(ctx.month, live).map(cityLink));

  const seasonListDeepLink = row.season_list_id ? await track(`checkoff://list?id=${row.season_list_id}`, 'season_continue_click') : null;
  const socialLinks = await Promise.all(OFFICIAL_SOCIAL_LINKS.map(async (s) => ({
    label: s.label, url: await track(s.url, 'social_click', { meta: { network: s.label.toLowerCase() } }),
  })));

  const data: RecapEmailData = {
    segment: seg,
    monthLabel: sctx.monthLabel,
    previewText: previewTextFor(seg, sctx),
    firstName: firstName(row.display_name),
    metroName: row.metro_name,
    metroSource: row.metro_source,
    platform: row.platform,
    checkinsThisMonth: row.checkins_this_month,
    pointsThisMonth: row.points_this_month,
    completedNames: (row.completed_item_names || []).map((i) => i.body),
    currentStreakWeeks: row.current_streak_weeks,
    hasRecentActivity: (row.days_since_last_checkin ?? 999) <= 14,
    seasonName: row.season_name,
    seasonCompleted: row.season_checked_count,
    seasonTotal: row.season_total_items || undefined,
    seasonDaysRemaining: row.season_days_remaining,
    seasonListDeepLink,
    unlockThreshold: null, // no per list unlock threshold is surfaced by the audience RPC
    daysSinceLastCheckin: row.days_since_last_checkin,
    lastCheckinItemName: row.last_checkin_item_name,
    newItemsSinceLastCheckin: row.new_items_since_last_checkin,
    recommendations,
    themedLists,
    liveCityCount: live.length,
    liveCities,
    newCities,
    socialLinks,
    appStoreUrl: await track(APP_STORE_URL, 'appstore_click'),
    playStoreUrl: await track(PLAY_STORE_URL, 'playstore_click'),
    nextMetroVoteUrl: await track('https://getcheckoff.com', 'next_metro_vote'),
    suggestAnotherCityUrl: 'mailto:hello@getcheckoff.com?subject=City%20Suggestion&body=I%27d%20love%20to%20see%20CheckOff%20in%3A%20',
    inviteUrl: await track('https://getcheckoff.com/join', 'invite_click'),
    unsubscribeUrl: await track('https://getcheckoff.com/download', 'unsubscribe'),
    ctaUrl: await track('checkoff://home', 'main_cta_click'),
  };
  return {
    data,
    recommendationIds: rawRecs.map((r) => r.id),
    subject: subjectFor(seg, row.display_name, sctx),
  };
}

// ── Synthetic, identity free rows ────────────────────────────────────────────
// Used for previews and isolated test sends. They carry real catalog content (item and list names) but
// no production person: the name is generic, the email is a reserved invalid address, and the user id
// is supplied by the caller (an internal or suppressed test account, verified by the function).

async function sampleItems(supabase: any, metroId: string, n: number): Promise<{ id: string; body: string; difficulty: number | null }[]> {
  const { data, error } = await supabase
    .from('items')
    .select('id, body, difficulty, neighborhoods!inner(metro_id)')
    .eq('neighborhoods.metro_id', metroId)
    .eq('is_active', true).eq('is_approved', true).eq('is_universal', false)
    .order('id', { ascending: true })
    .limit(n);
  if (error || !data || data.length < Math.min(n, 3)) throw new Error('Not enough catalog items to build a synthetic sample');
  return data;
}

async function listItemCount(supabase: any, listId: string): Promise<number> {
  const { count, error } = await supabase.from('list_items').select('id', { count: 'exact', head: true }).eq('list_id', listId);
  if (error) throw new Error('Could not count Fall list items');
  return count ?? 0;
}

export async function buildSyntheticRow(
  ctx: CampaignContext, variant: TestVariant, testUserId: string,
): Promise<AudienceRow> {
  const live = selectLiveCities(ctx.cities);
  // Prefer a metro with a current Fall list so every variant can show the Fall block.
  const home = live.find((c) => c.slug === 'phoenix' && c.season_list_id) ?? live.find((c) => c.season_list_id);
  if (!home) throw new Error('No live city with a Fall list is available for a synthetic sample');
  const items = await sampleItems(ctx.supabase, home.metro_id, 6);
  const recs = items.slice(0, 3).map((i) => ({ id: i.id, body: i.body, difficulty: i.difficulty, url: `checkoff://item?id=${i.id}` }));
  const done = items.slice(3, 6).map((i) => ({ id: i.id, body: i.body }));
  const total = await listItemCount(ctx.supabase, home.season_list_id!);

  const base: AudienceRow = {
    user_id: testUserId, email: 'synthetic@example.invalid', display_name: 'Alex', platform: null,
    segment: 'ACTIVE_MONTH', exclusion_reason: null,
    metro_id: home.metro_id, metro_name: home.name, metro_source: 'checkoff_history',
    checkins_this_month: 0, points_this_month: 0, lifetime_points: 0, completed_item_names: [],
    most_active_hood: null, current_streak_weeks: 0,
    last_checkin_at: null, last_checkin_item_name: null, days_since_last_checkin: null,
    new_items_since_last_checkin: 0, lifetime_checkins: 0,
    season_list_id: home.season_list_id, season_name: home.season_name, season_ends_at: null,
    season_total_items: total, season_checked_count: 0, season_days_remaining: null,
    recommended_items: recs,
  };
  switch (variant) {
    case 'ACTIVE_MONTH':
      return { ...base, segment: 'ACTIVE_MONTH', checkins_this_month: 3, points_this_month: 9, lifetime_points: 21,
        completed_item_names: done, current_streak_weeks: 2, lifetime_checkins: 7, season_checked_count: 2,
        last_checkin_at: new Date().toISOString(), days_since_last_checkin: 4 };
    case 'FALL_CONTINUATION':
      return { ...base, segment: 'FALL_CONTINUATION', season_checked_count: 4, lifetime_checkins: 4,
        last_checkin_item_name: done[0].body, days_since_last_checkin: 22 };
    case 'RETURNING_INACTIVE':
      return { ...base, segment: 'RETURNING_INACTIVE', lifetime_checkins: 6, last_checkin_item_name: done[0].body,
        days_since_last_checkin: 41, new_items_since_last_checkin: 12 };
    case 'NEVER_CHECKED_OFF':
      return { ...base, segment: 'NEVER_CHECKED_OFF', metro_source: 'list_history' };
    case 'NEVER_CHECKED_OFF_UNKNOWN':
      return { ...base, segment: 'NEVER_CHECKED_OFF', metro_id: null, metro_name: null, metro_source: 'unknown',
        season_list_id: null, season_name: null, season_total_items: 0, recommended_items: null };
  }
}
