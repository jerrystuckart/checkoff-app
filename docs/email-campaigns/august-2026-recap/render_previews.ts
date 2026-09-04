// One-off local preview renderer for the Sept 1 recap campaign audit.
// Run: deno run --allow-read --allow-write docs/email-campaigns/august-2026-recap/render_previews.ts
// Reads sample_rows.json (redacted, produced from a read-only production
// query), builds HTML via the same shared template the edge function uses,
// and writes preview-<segment>.html files alongside it. No network calls,
// no sends, no writes to the DB — pure local rendering for review.

import {
  firstName, subjectFor, PREVIEW_TEXT, assignRecommendationRoles,
  selectSinceLastActivityUpdates, metroSlug,
} from '../../../supabase/functions/_shared/campaignLogic.ts';
import { buildRecapEmailHtml, type RecapEmailData } from '../../../supabase/functions/_shared/campaignTemplate.ts';

type Row = any;

function fakeTrackedUrl(dest: string): string {
  return `https://uggusbbswybyplypkbxz.supabase.co/functions/v1/campaign-link?dest=${encodeURIComponent(dest)}&preview=1`;
}

function buildData(row: Row): RecapEmailData {
  const rawRecs = (row.recommended_items || []).slice(0, 3);
  const recommendations = assignRecommendationRoles(rawRecs).map((r) => ({ ...r, url: fakeTrackedUrl(r.url) }));
  const themedLists = [
    { title: `${metroSlug(row.metro_name).replace(/^\w/, (c: string) => c.toUpperCase())} Hoptimists`, url: fakeTrackedUrl('checkoff://list?id=sample') },
  ];
  const updates = selectSinceLastActivityUpdates(row.metro_name, row.last_checkin_at, 4);

  return {
    segment: row.segment,
    firstName: firstName(row.display_name),
    metroName: row.metro_name,
    platform: row.platform,
    checkinsThisMonth: row.checkins_this_month,
    pointsThisMonth: row.points_this_month,
    completedNames: (row.completed_item_names || []).map((i: any) => i.body),
    mostActiveHood: row.most_active_hood,
    currentStreakWeeks: row.current_streak_weeks,
    hasRecentActivity: (row.days_since_last_checkin ?? 999) <= 14,
    seasonName: row.season_name,
    seasonCompleted: row.season_checked_count,
    seasonTotal: row.season_total_items || undefined,
    seasonDaysRemaining: row.season_days_remaining,
    seasonListDeepLink: row.season_list_id ? fakeTrackedUrl(`checkoff://list?id=${row.season_list_id}`) : null,
    unlockThreshold: row.unlock_threshold ?? null,
    daysSinceLastCheckin: row.days_since_last_checkin,
    lastCheckinItemName: row.last_checkin_item_name,
    recommendations,
    updates,
    themedLists,
    nextMetroVoteUrl: fakeTrackedUrl('https://getcheckoff.com/vote-next-city'),
    suggestAnotherCityUrl: fakeTrackedUrl('https://getcheckoff.com/vote-next-city?suggest=1'),
    inviteUrl: fakeTrackedUrl('https://getcheckoff.com/join'),
    unsubscribeUrl: fakeTrackedUrl('https://getcheckoff.com/download'),
    ctaUrl: fakeTrackedUrl('checkoff://home'),
  };
}

const sampleRows: Row[] = JSON.parse(await Deno.readTextFile(new URL('./sample_rows.json', import.meta.url)));

// Synthetic FALL_CONTINUATION example — zero live users currently qualify
// (see audit: Milwaukee/Tucson/Denver too new, Phoenix users with season
// progress all also have August activity in the current data snapshot).
// Shape matches a real audience row exactly; used only to prove the
// template path renders correctly, not real user data.
const syntheticFallContinuation: Row = {
  segment: 'FALL_CONTINUATION',
  display_name: 'Alex Rivera',
  metro_name: 'Milwaukee Metro',
  platform: 'android',
  checkins_this_month: 0,
  points_this_month: 0,
  completed_item_names: [],
  most_active_hood: null,
  current_streak_weeks: 0,
  days_since_last_checkin: 22,
  last_checkin_at: '2026-08-10T00:00:00Z',
  last_checkin_item_name: "Find the goats on the roof at 'Al Johnson's Swedish Restaurant'",
  season_name: 'Fall 2026 — Milwaukee Metro',
  season_checked_count: 4,
  season_total_items: 32,
  season_days_remaining: 90,
  season_list_id: '21523c15-4bd0-4fc1-b8ec-c1d67ca2fa40',
  recommended_items: [
    { id: 'x1', body: 'Sit in the taproom at Door County Brewing Co', difficulty: 1, url: 'checkoff://item?id=x1' },
    { id: 'x2', body: "Order a Bloody Mary at Sobelman's", difficulty: 1, url: 'checkoff://item?id=x2' },
    { id: 'x3', body: 'Catch a Brewers game at American Family Field', difficulty: 5, url: 'checkoff://item?id=x3' },
  ],
};

const targets: Row[] = [...sampleRows, syntheticFallContinuation];
const summaryLines: string[] = [];

for (const row of targets) {
  const data = buildData(row);
  const html = buildRecapEmailHtml(data);
  const filename = `preview-${row.segment}.html`;
  await Deno.writeTextFile(new URL(`./${filename}`, import.meta.url), html);
  const subject = subjectFor(row.segment, row.display_name, row.season_name);
  summaryLines.push(JSON.stringify({
    segment: row.segment,
    file: filename,
    subject,
    previewText: PREVIEW_TEXT,
    mainCta: data.ctaUrl,
    recommendationIds: data.recommendations.map((r) => r.id),
    updateIds: data.updates.map((u) => u.id),
    themedLists: data.themedLists.map((l) => l.title),
    isSynthetic: row.segment === 'FALL_CONTINUATION',
  }, null, 2));
}

await Deno.writeTextFile(new URL('./preview_summary.json', import.meta.url), `[\n${summaryLines.join(',\n')}\n]\n`);
console.log(`Rendered ${targets.length} previews.`);
