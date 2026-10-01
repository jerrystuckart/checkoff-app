// Assembles RecapEmailData for one audience row, and builds the synthetic rows used for previews and
// isolated test sends. Network and database access are injected, so this is testable with fakes.

import {
  firstName, subjectFor, previewTextFor, assignRecommendationRoles, metroSlug, selectThemedLists,
  monthLabelFor, cityDisplayName,
  type Segment, type RawRecommendation, type MetroSource, type SubjectContext,
} from './campaignLogic.ts';
import { signToken } from './linkSigning.ts';
import { homeUrl, itemUrl, listUrl, metroUrl, isUuid, isMetroSlug } from './linkContract.ts';
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
    return selectThemedLists(data).filter((l) => isUuid(l.id)).map((l) => ({ title: l.title, url: listUrl(l.id) }));
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

export type BuildOptions = {
  // Link fix test content: replaces the themed list block with these exact public lists and adds a visible
  // test notice. Never used for production sends.
  themedListsOverride?: { title: string; id: string }[];
  testNotice?: string;
};

export async function buildEmailData(
  ctx: CampaignContext, row: AudienceRow, campaignId: string, opts: BuildOptions = {},
): Promise<{ data: RecapEmailData; recommendationIds: string[]; subject: string }> {
  const uid = row.user_id;
  const seg = row.segment;
  const track = (dest: string, ev: string, extra?: { rec?: string; meta?: Record<string, unknown> }) =>
    buildTrackedUrl(ctx, uid, campaignId, dest, ev, seg, extra);

  const sctx = subjectContext(ctx, row);
  const rawRecs = (row.recommended_items || []).slice(0, 3);
  // Every destination below is a canonical https URL (lib/emailLinkContract.js in the app is the source of
  // truth): the exact item id, list id or metro slug survives tracking and every redirect.
  const recommendations = await Promise.all(assignRecommendationRoles(rawRecs.filter((r) => isUuid(r.id))).map(async (r) => ({
    ...r, url: await track(itemUrl(r.id), 'recommendation_click', { rec: r.id }),
  })));

  const themedSource = opts.themedListsOverride
    ? opts.themedListsOverride.filter((l) => isUuid(l.id)).map((l) => ({ title: l.title, url: listUrl(l.id) }))
    : await fetchThemedLists(ctx.supabase, row.metro_name);
  const themedLists = await Promise.all(themedSource.map(async (l) => ({
    ...l, url: await track(l.url, 'themed_list_click'),
  })));

  const live = selectLiveCities(ctx.cities);
  // A city chip selects THAT metro (canonical metro slug). It is never a stand in list.
  const cityLink = async (c: CityRow): Promise<CityLink> => ({
    name: cityDisplayName(c.name),
    url: await track(metroUrl(c.slug), 'city_click', { meta: { city: c.slug } }),
  });
  const linkable = (c: CityRow) => isMetroSlug(c.slug);
  const liveCities = await Promise.all(live.filter(linkable).map(cityLink));
  const newCities = await Promise.all(newCitiesForMonth(ctx.month, live).filter(linkable).map(cityLink));

  const seasonListDeepLink = isUuid(row.season_list_id) ? await track(listUrl(row.season_list_id!), 'season_continue_click') : null;
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
    ctaUrl: await track(homeUrl(), 'main_cta_click'),
    testNotice: opts.testNotice,
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
    // items has two relationships to neighborhoods; name the foreign key so PostgREST can embed it.
    .select('id, body, difficulty, hood:neighborhoods!items_neighborhood_id_fkey!inner(metro_id)')
    .eq('hood.metro_id', metroId)
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
  ctx: CampaignContext, variant: TestVariant, testUserId: string, homeSlug?: string,
): Promise<AudienceRow> {
  const live = selectLiveCities(ctx.cities);
  // Default: a metro with a current Fall list (Phoenix first) so every variant can show the Fall block.
  // A caller can name the home metro (the link fix test package does), with or without a Fall list.
  const home = homeSlug
    ? live.find((c) => c.slug === homeSlug)
    : (live.find((c) => c.slug === 'phoenix' && c.season_list_id) ?? live.find((c) => c.season_list_id));
  if (!home) throw new Error(homeSlug ? `Metro ${homeSlug} is not live` : 'No live city with a Fall list is available for a synthetic sample');
  const items = await sampleItems(ctx.supabase, home.metro_id, 6);
  const recs = items.slice(0, 3).map((i) => ({ id: i.id, body: i.body, difficulty: i.difficulty, url: itemUrl(i.id) }));
  const done = items.slice(3, 6).map((i) => ({ id: i.id, body: i.body }));
  const total = home.season_list_id ? await listItemCount(ctx.supabase, home.season_list_id) : 0;

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

// ── Link fix test package ───────────────────────────────────────────────────
// Five emails, each with a different home metro and real catalog entities, so one pass on a phone verifies:
// a Phoenix item while outside Phoenix, a Fall list from another metro, a Phoenix list, a Munich and a Vienna
// list, Amalfi Coast and Florence city selection, the main Home button, vote, unsubscribe and both stores.
// Test only. Counts and progress in these emails are sample content and the banner says so.
export type LinkFixPlan = { homeSlug: string | null; listsMetroSlug: string | null; notice: string };

const SAMPLE = 'LINK FIX TEST. Counts and progress in this email are sample content. Please tap each link below and report where it lands.';

export const LINK_FIX_PLAN: Record<TestVariant, LinkFixPlan> = {
  ACTIVE_MONTH: {
    homeSlug: 'phoenix', listsMetroSlug: null,
    notice: `${SAMPLE} Email 1 of 5. (1) An item under Next up is a Phoenix item: it must open that exact item even if you are not near Phoenix. (2) Continue your Fall list must open the Phoenix Fall list. (3) A list under More lists worth a look must open that exact list. (4) In the New in September line, Amalfi Coast and Florence must each switch to that city.`,
  },
  FALL_CONTINUATION: {
    homeSlug: 'munich', listsMetroSlug: 'munich',
    notice: `${SAMPLE} Email 2 of 5. (1) Continue your Fall list must open the MUNICH Fall list, a Fall list from another metro. (2) The Next up items are Munich items. (3) The Munich list under More lists must open that exact list. (4) Open CheckOff at the bottom must open CheckOff Home.`,
  },
  RETURNING_INACTIVE: {
    homeSlug: 'vienna_austria', listsMetroSlug: 'vienna_austria',
    notice: `${SAMPLE} Email 3 of 5. (1) The Vienna list under More lists must open that exact list. (2) The city buttons under New on CheckOff: tap Amalfi Coast, go back, then tap Florence. Each must show a different selected city. (3) The App Store and Google Play buttons must open the right store pages.`,
  },
  NEVER_CHECKED_OFF: {
    homeSlug: 'amalfi-coast', listsMetroSlug: null,
    notice: `${SAMPLE} Email 4 of 5. (1) The Next up items are Amalfi Coast items and each must open its exact item. (2) In the New in September line, tap Florence: it must switch to Florence. (3) Vote for a city must open the vote form and accept a city. (4) Unsubscribe must show a confirmation page and must NOT unsubscribe you (this is a test).`,
  },
  NEVER_CHECKED_OFF_UNKNOWN: {
    homeSlug: null, listsMetroSlug: null,
    notice: `${SAMPLE} Email 5 of 5. (1) Tap two different city buttons, for example San Diego and Tucson: each must select its own city, never the same generic screen. (2) Choose a city to explore at the bottom must open CheckOff Home. (3) Follow CheckOff on Instagram must open the Instagram profile.`,
  },
};

export async function fetchOfficialMetroLists(supabase: any, metroId: string, excludeListId: string | null): Promise<{ title: string; id: string }[]> {
  const { data, error } = await supabase
    .from('lists').select('id, title')
    .eq('metro_id', metroId).eq('is_public', true).eq('is_official', true)
    .order('title', { ascending: true }).limit(8);
  if (error || !data) return [];
  return (data as { id: string; title: string }[]).filter((l) => l.id !== excludeListId && isUuid(l.id)).slice(0, 2);
}

export async function buildLinkFixEmail(
  ctx: CampaignContext, variant: TestVariant, testUserId: string, campaignId: string,
) {
  const plan = LINK_FIX_PLAN[variant];
  const row = await buildSyntheticRow(ctx, variant, testUserId, plan.homeSlug ?? undefined);
  let themedListsOverride: { title: string; id: string }[] | undefined;
  if (plan.listsMetroSlug && row.metro_id) {
    themedListsOverride = await fetchOfficialMetroLists(ctx.supabase, row.metro_id, row.season_list_id);
  }
  const built = await buildEmailData(ctx, row, campaignId, { themedListsOverride, testNotice: plan.notice });
  return { row, built };
}
