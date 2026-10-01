// Single dynamic email template with conditional sections ("one maintainable email system").
// Reuses the CheckOff brand system (navy #0F1117 / amber #F5A623, 600px card, mobile stack).
//
// Month neutral: every month word comes from data.monthLabel. Public copy never uses hyphens or
// dashes; text that originates in the database goes through publicText() first.
// Presentation variants (4 database segments, 5 variants):
//   ACTIVE_MONTH, FALL_CONTINUATION, RETURNING_INACTIVE,
//   NEVER_CHECKED_OFF with a known metro, NEVER_CHECKED_OFF with an unknown metro.

import {
  escapeHtml, publicText, cityDisplayName, seasonDisplayName, streakMessage, almostThereMessage,
  seasonalClosingCopy, deviceCta,
  type Segment, type RoledRecommendation, type MetroSource,
} from './campaignLogic.ts';

export type ThemedListLink = { title: string; url: string };
export type CityLink = { name: string; url: string };
export type SocialLink = { label: string; url: string };

export type RecapEmailData = {
  segment: Segment;
  monthLabel: string; // "September"
  previewText: string;
  firstName: string | null;
  metroName: string | null;
  metroSource: MetroSource;
  platform: string | null;

  // ACTIVE_MONTH
  checkinsThisMonth?: number;
  pointsThisMonth?: number;
  completedNames?: string[];

  // shared streak
  currentStreakWeeks?: number | null;
  hasRecentActivity?: boolean;

  // Fall list block
  seasonName?: string | null;
  seasonCompleted?: number;
  seasonTotal?: number;
  seasonDaysRemaining?: number | null; // null or undefined means the end date is unknown: no countdown
  seasonListDeepLink?: string | null;
  unlockThreshold?: number | null;

  // RETURNING_INACTIVE
  daysSinceLastCheckin?: number | null;
  lastCheckinItemName?: string | null;
  newItemsSinceLastCheckin?: number;

  recommendations: RoledRecommendation[];
  themedLists: ThemedListLink[];

  // Live city data (tracked links)
  liveCityCount: number;
  liveCities: CityLink[];
  newCities: CityLink[];

  socialLinks: SocialLink[];
  appStoreUrl: string;
  playStoreUrl: string;

  nextMetroVoteUrl: string;
  suggestAnotherCityUrl: string;
  inviteUrl: string;
  unsubscribeUrl: string;
  ctaUrl: string; // wrapped through campaign-link for click attribution
};

// A never checked off user with an unknown metro gets the city discovery treatment: no item level
// recommendations, no season block, no themed lists, and never a claim that anything is nearby.
export function isUnknownMetroDiscovery(d: RecapEmailData): boolean {
  return d.segment === 'NEVER_CHECKED_OFF' && d.metroSource === 'unknown';
}

const t = (v: unknown) => escapeHtml(publicText(v));

function statCard(value: string | number, label: string): string {
  return `<td class="stat" style="padding:0 4px;"><div style="background:rgba(255,255,255,.08);border:1px solid rgba(245,166,35,.32);border-radius:18px;padding:16px;"><div style="font-size:24px;font-weight:950;color:#FFFFFF;line-height:28px;">${escapeHtml(value)}</div><div style="font-size:11px;font-weight:800;color:#AEB4C0;text-transform:uppercase;letter-spacing:.7px;">${escapeHtml(label)}</div></div></td>`;
}

function card(inner: string): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #E8E3DA;border-radius:20px;overflow:hidden;margin-bottom:12px;"><tr><td style="padding:18px 18px 16px;background:#FFFFFF;">${inner}</td></tr></table>`;
}

const EYEBROW = 'font-size:13px;font-weight:800;color:#F5A623;text-transform:uppercase;letter-spacing:1.4px;margin-bottom:12px;';
const HERO = 'font-size:32px;line-height:38px;font-weight:950;letter-spacing:-1px;color:#FFFFFF;margin:0 0 14px;';
const HERO_BODY = 'font-size:16px;line-height:25px;color:#D7DAE1;margin:0 0 8px;';
const H2 = 'font-size:23px;line-height:29px;font-weight:950;letter-spacing:-.5px;color:#171A21;margin-bottom:14px;';
const H3 = 'font-size:20px;line-height:26px;font-weight:950;letter-spacing:-.4px;color:#171A21;margin-bottom:12px;';
const CHIP = 'display:inline-block;background:#F4F1EA;border-radius:999px;padding:10px 16px;margin:0 8px 8px 0;color:#171A21;font-weight:800;font-size:14px;text-decoration:none;';

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function personalOpeningSection(d: RecapEmailData): string {
  const name = d.firstName ? `${escapeHtml(d.firstName)}, ` : '';
  const city = cityDisplayName(d.metroName);

  if (d.segment === 'ACTIVE_MONTH') {
    const count = d.checkinsThisMonth ?? 0;
    const names = (d.completedNames || []).slice(0, 3).map(t).join(', ');
    const stats = [statCard(count, `${d.monthLabel} CheckOffs`)];
    if ((d.pointsThisMonth ?? 0) > 0) stats.push(statCard(d.pointsThisMonth!, 'Points earned'));
    if ((d.currentStreakWeeks ?? 0) > 0) stats.push(statCard(d.currentStreakWeeks!, 'Week streak'));
    return `
      <div style="${EYEBROW}">${escapeHtml(d.monthLabel)} recap</div>
      <div class="hero-title" style="${HERO}">${name}${name ? 'look' : 'Look'} what you checked off in ${escapeHtml(d.monthLabel)}.</div>
      <div style="font-size:16px;line-height:25px;color:#D7DAE1;margin:0 0 24px;">You checked off <strong style="color:#FFFFFF;">${count}</strong> ${plural(count, 'thing', 'things')} in ${escapeHtml(d.monthLabel)}${names ? `: <strong style="color:#FFFFFF;">${names}</strong>` : ''}.</div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>${stats.join('')}</tr></table>`;
  }
  if (d.segment === 'FALL_CONTINUATION') {
    const season = d.seasonName ? seasonDisplayName(d.seasonName, d.metroName) : 'your Fall list';
    return `
      <div style="${EYEBROW}">Your Fall list</div>
      <div class="hero-title" style="${HERO}">${name}${name ? 'your' : 'Your'} Fall list is waiting.</div>
      <div style="${HERO_BODY}">You have checked off ${d.seasonCompleted ?? 0} of ${d.seasonTotal ?? '?'} on ${escapeHtml(season)}. Pick one more and keep it going.</div>`;
  }
  if (d.segment === 'RETURNING_INACTIVE') {
    const last = d.lastCheckinItemName
      ? `Last time you checked off ${t(d.lastCheckinItemName)}${d.daysSinceLastCheckin ? `, ${d.daysSinceLastCheckin} days ago` : ''}.`
      : 'It has been a while since your last CheckOff.';
    const fresh = (d.newItemsSinceLastCheckin ?? 0) > 0 && city
      ? ` Since then, ${d.newItemsSinceLastCheckin} new ${plural(d.newItemsSinceLastCheckin!, 'place was', 'places were')} added in ${escapeHtml(city)}.`
      : '';
    return `
      <div style="${EYEBROW}">Welcome back</div>
      <div class="hero-title" style="${HERO}">A lot is new since your last visit.</div>
      <div style="${HERO_BODY}">${last}${fresh} Here is what is new.</div>`;
  }
  // NEVER_CHECKED_OFF
  if (isUnknownMetroDiscovery(d)) {
    return `
      <div style="${EYEBROW}">CheckOff</div>
      <div class="hero-title" style="${HERO}">CheckOff is now live in ${d.liveCityCount} metros.</div>
      <div style="${HERO_BODY}">Choose a city and make your first CheckOff.</div>`;
  }
  return `
    <div style="${EYEBROW}">Start here</div>
    <div class="hero-title" style="${HERO}">${name}${name ? 'your' : 'Your'} first CheckOff is waiting.</div>
    <div style="${HERO_BODY}">Here are a few great places to start${city ? ` in ${escapeHtml(city)}` : ''}.</div>`;
}

function seasonSection(d: RecapEmailData): string {
  if (!d.seasonName || d.seasonTotal == null) return '';
  const completed = d.seasonCompleted ?? 0;
  const pct = d.seasonTotal ? Math.round((completed / d.seasonTotal) * 100) : 0;
  const remaining = Math.max(d.seasonTotal - completed, 0);
  const almost = almostThereMessage(completed, d.unlockThreshold);
  // The countdown appears only when the end date is known and still ahead. A missing end date means
  // evergreen copy, never "0 days left".
  const hasCountdown = d.seasonDaysRemaining != null && d.seasonDaysRemaining > 0;
  const progressLine = completed > 0
    ? `${completed} of ${d.seasonTotal} complete (${pct}%)`
    : `${d.seasonTotal} ${plural(d.seasonTotal, 'place', 'places')} to check off`;
  const tail = hasCountdown
    ? `${remaining} left, ${d.seasonDaysRemaining} ${plural(d.seasonDaysRemaining!, 'day', 'days')} to go`
    : completed > 0 ? `${remaining} left. Keep going whenever you are ready.` : 'Start anywhere you like.';
  return `
    <tr><td class="px" style="padding:26px 34px 8px;background:#FFFFFF;">
      <div style="background:#FFF7E8;border:1px solid #F8D89D;border-radius:22px;padding:22px;">
        <div style="font-size:13px;font-weight:900;color:#A35F00;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:8px;">${escapeHtml(seasonDisplayName(d.seasonName, d.metroName))}</div>
        <div style="font-size:20px;font-weight:950;letter-spacing:-.4px;color:#171A21;line-height:27px;margin-bottom:10px;">${escapeHtml(progressLine)}</div>
        ${completed > 0 ? `<div style="background:#F0E3C6;border-radius:999px;height:8px;overflow:hidden;margin-bottom:10px;"><div style="background:#F5A623;height:8px;width:${pct}%;"></div></div>` : ''}
        <div style="font-size:14px;line-height:21px;color:#4B5260;margin-bottom:6px;">${escapeHtml(tail)}</div>
        ${almost ? `<div style="font-size:14px;font-weight:800;color:#A35F00;margin-bottom:10px;">${escapeHtml(almost)}</div>` : ''}
        <a href="${escapeHtml(d.seasonListDeepLink || d.ctaUrl)}" style="display:inline-block;color:#0F1117;background:#F5A623;border-radius:999px;padding:10px 16px;font-size:13px;font-weight:900;text-decoration:none;">${completed > 0 ? 'Continue your Fall list' : 'See the Fall list'}</a>
      </div>
    </td></tr>`;
}

function recommendationsSection(d: RecapEmailData): string {
  if (!d.recommendations?.length) return '';
  const roleLabel: Record<string, string> = { easy_next: 'An easy one', made_for_you: 'Popular right now', try_different: 'Something different' };
  const city = cityDisplayName(d.metroName);
  const heading = d.segment === 'NEVER_CHECKED_OFF'
    ? `Great places to start${city ? ` in ${city}` : ''}`
    : `Next up${city ? ` in ${city}` : ''}`;
  const cards = d.recommendations.map((r) => card(`
    <div style="font-size:11px;font-weight:900;color:#A35F00;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">${escapeHtml(roleLabel[r.role] || 'Try this')}</div>
    <div class="item-title" style="font-size:18px;line-height:24px;font-weight:900;color:#171A21;margin-bottom:10px;">${t(r.body)}</div>
    <a href="${escapeHtml(r.url)}" style="display:inline-block;color:#0F1117;background:#F5A623;border-radius:999px;padding:10px 15px;font-size:13px;font-weight:900;text-decoration:none;">Open this place</a>
  `)).join('');
  return `
    <tr><td class="px" style="padding:26px 34px 8px;background:#FFFFFF;">
      <div style="${H2}">${escapeHtml(publicText(heading))}</div>
      ${cards}
    </td></tr>`;
}

function chips(cities: CityLink[]): string {
  return cities.map((c) => `<a href="${escapeHtml(c.url)}" style="${CHIP}">${t(c.name)}</a>`).join('');
}

function inlineCityLinks(cities: CityLink[]): string {
  const links = cities.map((c) => `<a href="${escapeHtml(c.url)}" style="color:#A35F00;font-weight:800;text-decoration:underline;">${t(c.name)}</a>`);
  if (links.length <= 1) return links.join('');
  return `${links.slice(0, -1).join(', ')} and ${links[links.length - 1]}`;
}

// Where CheckOff is live. Variant specific:
//   unknown metro   the strongest treatment: every live city as a link to its own destination
//   returning       the new cities as link chips, with the live total
//   everyone else   one compact sentence naming the new cities, each linked
function citiesSection(d: RecapEmailData): string {
  if (isUnknownMetroDiscovery(d)) {
    if (!d.liveCities.length) return '';
    return `
    <tr><td class="px" style="padding:26px 34px 8px;background:#FFFFFF;">
      <div style="${H2}">Pick a city to begin</div>
      <div style="font-size:15px;line-height:23px;color:#596170;margin-bottom:14px;">Every city below has places ready to check off. Tap one to see its best list.</div>
      ${chips(d.liveCities)}
    </td></tr>`;
  }
  if (!d.newCities.length) return '';
  if (d.segment === 'RETURNING_INACTIVE') {
    return `
    <tr><td class="px" style="padding:26px 34px 8px;background:#FFFFFF;">
      <div style="${H2}">New on CheckOff</div>
      <div style="font-size:15px;line-height:23px;color:#596170;margin-bottom:14px;">${d.newCities.length} new ${plural(d.newCities.length, 'metro', 'metros')} opened in ${escapeHtml(d.monthLabel)}, and CheckOff is now live in ${d.liveCityCount} metros.</div>
      ${chips(d.newCities)}
    </td></tr>`;
  }
  return `
    <tr><td class="px" style="padding:20px 34px 8px;background:#FFFFFF;">
      <div style="${H3}">CheckOff grew in ${escapeHtml(d.monthLabel)}</div>
      <div style="font-size:15px;line-height:23px;color:#596170;">New in ${escapeHtml(d.monthLabel)}: ${inlineCityLinks(d.newCities)}. CheckOff is now live in ${d.liveCityCount} metros.</div>
    </td></tr>`;
}

function themedListsSection(d: RecapEmailData): string {
  if (!d.themedLists?.length) return '';
  const items = d.themedLists.map((l) => `<a href="${escapeHtml(l.url)}" style="display:block;background:#F4F1EA;border-radius:16px;padding:14px 16px;margin-bottom:8px;color:#171A21;font-weight:800;font-size:15px;text-decoration:none;">${t(l.title)}</a>`).join('');
  return `
    <tr><td class="px" style="padding:8px 34px 8px;background:#FFFFFF;">
      <div style="${H3}">More lists worth a look</div>
      ${items}
    </td></tr>`;
}

function streakSection(d: RecapEmailData): string {
  const msg = streakMessage(d.currentStreakWeeks, !!d.hasRecentActivity);
  return `
    <tr><td class="px" style="padding:8px 34px 8px;background:#FFFFFF;">
      <div style="font-size:15px;line-height:23px;color:#596170;">${escapeHtml(msg)}</div>
    </td></tr>`;
}

// General app update nudge. Makes no claim about any specific feature or any platform difference.
function appUpdateSection(d: RecapEmailData): string {
  const p = (d.platform || '').toLowerCase();
  const links: string[] = [];
  const style = 'display:inline-block;background:#171A21;color:#FFFFFF;border-radius:999px;padding:10px 16px;font-size:13px;font-weight:900;text-decoration:none;margin:0 8px 8px 0;';
  if (p !== 'android') links.push(`<a href="${escapeHtml(d.appStoreUrl)}" style="${style}">App Store</a>`);
  if (p !== 'ios') links.push(`<a href="${escapeHtml(d.playStoreUrl)}" style="${style}">Google Play</a>`);
  return `
    <tr><td class="px" style="padding:20px 34px 8px;background:#FFFFFF;">
      <div style="background:#F4F1EA;border-radius:20px;padding:20px;">
        <div style="font-size:16px;font-weight:900;color:#171A21;margin-bottom:6px;">Update CheckOff</div>
        <div style="font-size:14px;line-height:22px;color:#4B5260;margin-bottom:12px;">Install the latest version so you see every new city and Fall list.</div>
        ${links.join('')}
      </div>
    </td></tr>`;
}

function nextMetroSection(d: RecapEmailData): string {
  return `
    <tr><td class="px" style="padding:26px 34px 8px;background:#FFFFFF;">
      <div style="${H3}">Where should CheckOff go next?</div>
      <a href="${escapeHtml(d.nextMetroVoteUrl)}" style="display:inline-block;background:#171A21;color:#FFFFFF;border-radius:999px;padding:10px 16px;font-size:13px;font-weight:900;text-decoration:none;margin-right:8px;">Vote for a city</a>
      <a href="${escapeHtml(d.suggestAnotherCityUrl)}" style="font-size:13px;font-weight:700;color:#7A8290;text-decoration:underline;">Suggest another city</a>
    </td></tr>`;
}

function shareSection(d: RecapEmailData): string {
  return `
    <tr><td class="px" style="padding:8px 34px 8px;background:#FFFFFF;">
      <div style="background:#F4F1EA;border-radius:20px;padding:20px;">
        <div style="font-size:15px;line-height:23px;color:#4B5260;margin-bottom:10px;">Exploring is better when someone else is keeping score.</div>
        <a href="${escapeHtml(d.inviteUrl)}" style="display:inline-block;background:#F5A623;color:#0F1117;border-radius:999px;padding:10px 16px;font-size:13px;font-weight:900;text-decoration:none;">Invite a friend to CheckOff</a>
      </div>
    </td></tr>`;
}

// Only verified official profiles are ever passed in. An empty list renders nothing.
function socialSection(d: RecapEmailData): string {
  if (!d.socialLinks?.length) return '';
  const links = d.socialLinks.map((s) => `<a href="${escapeHtml(s.url)}" style="color:#A35F00;font-weight:800;text-decoration:underline;margin-right:14px;">${escapeHtml(s.label)}</a>`).join('');
  return `
    <tr><td class="px" style="padding:14px 34px 8px;background:#FFFFFF;">
      <div style="font-size:14px;line-height:22px;color:#596170;">Follow CheckOff: ${links}</div>
    </td></tr>`;
}

function mainCtaLabel(d: RecapEmailData): string {
  if (isUnknownMetroDiscovery(d)) return 'Choose a city to explore';
  return deviceCta(d.platform).label;
}

function closingSection(d: RecapEmailData): string {
  return `
    <tr><td align="center" class="px" style="padding:24px 34px 30px;background:#FFFFFF;">
      <div style="font-size:15px;line-height:23px;color:#4B5260;margin-bottom:20px;">${escapeHtml(seasonalClosingCopy(isUnknownMetroDiscovery(d) ? null : d.metroName))}</div>
      <a href="${escapeHtml(d.ctaUrl)}" style="display:inline-block;background:#F5A623;color:#0F1117;text-decoration:none;font-size:16px;font-weight:950;border-radius:999px;padding:15px 26px;">${escapeHtml(mainCtaLabel(d))}</a>
    </td></tr>`;
}

export function buildRecapEmailHtml(d: RecapEmailData): string {
  const unknown = isUnknownMetroDiscovery(d);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>Your ${escapeHtml(d.monthLabel)} CheckOff Recap</title>
<style>
@media only screen and (max-width: 620px) {
  .container { width: 100% !important; }
  .px { padding-left: 22px !important; padding-right: 22px !important; }
  .stat { display: block !important; width: 100% !important; margin-bottom: 10px !important; padding: 0 !important; }
  .hero-title { font-size: 26px !important; line-height: 32px !important; }
  .item-title { font-size: 17px !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background:#F4F1EA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#171A21;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(d.previewText)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F4F1EA;">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" class="container" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;background:#FFFFFF;border-radius:28px;overflow:hidden;box-shadow:0 18px 55px rgba(15,17,23,.12);">
<tr><td style="background:#0F1117;padding:26px 30px 22px;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
    <td align="left" style="font-size:26px;font-weight:900;letter-spacing:-.8px;line-height:30px;"><span style="color:#F5A623;">Check</span><span style="color:#FFFFFF;">Off</span></td>
    <td align="right" style="font-size:11px;font-weight:800;color:#F5A623;text-transform:uppercase;letter-spacing:1.2px;">${escapeHtml(d.monthLabel)} Recap</td>
  </tr></table>
</td></tr>
<tr><td class="px" style="padding:36px 34px 22px;background:#0F1117;background-image:linear-gradient(180deg,#0F1117 0%,#171A21 100%);">
  ${personalOpeningSection(d)}
</td></tr>
${unknown ? '' : seasonSection(d)}
${unknown ? citiesSection(d) : recommendationsSection(d)}
${unknown ? '' : citiesSection(d)}
${unknown ? '' : themedListsSection(d)}
${appUpdateSection(d)}
${streakSection(d)}
${nextMetroSection(d)}
${shareSection(d)}
${socialSection(d)}
${closingSection(d)}
<tr><td style="background:#0F1117;padding:26px 30px;text-align:center;">
  <div style="font-size:13px;line-height:20px;color:#D7DAE1;font-weight:700;">Do more with CheckOff.</div>
  <div style="font-size:11px;line-height:18px;color:#8F97A6;margin-top:10px;">getcheckoff.com · <a href="${escapeHtml(d.unsubscribeUrl)}" style="color:#F5A623;text-decoration:underline;">Unsubscribe</a></div>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
