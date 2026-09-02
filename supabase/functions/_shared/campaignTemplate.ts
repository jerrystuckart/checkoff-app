// Single dynamic email template with conditional sections, per campaign spec
// ("one maintainable email system... rather than manually maintained
// templates for every person"). Reuses the CheckOff brand system already
// established in email-templates/monthly-recap.html (navy #0F1117 / amber
// #F5A623, 600px card, mobile stack).

import {
  escapeHtml, deviceCta, storeCta, streakMessage, almostThereMessage,
  seasonalClosingCopy, RECOMMENDATION_HEADING, SEGMENT_OPENING,
  UNKNOWN_METRO_OPENING, AVAILABLE_MARKETS,
  type Segment, type RoledRecommendation, type ProductUpdate, type MetroSource,
} from './campaignLogic.ts';

export type ThemedListLink = { title: string; url: string };

export type RecapEmailData = {
  segment: Segment;
  firstName: string | null;
  metroName: string | null;
  metroSource: MetroSource;
  platform: string | null;

  // ACTIVE_AUGUST
  checkinsThisMonth?: number;
  pointsThisMonth?: number;
  completedNames?: string[];
  mostActiveHood?: string | null;

  // shared streak
  currentStreakWeeks?: number | null;
  hasRecentActivity?: boolean;

  // FALL_CONTINUATION / season block (any active user can also have this)
  seasonName?: string | null;
  seasonCompleted?: number;
  seasonTotal?: number;
  seasonDaysRemaining?: number | null;
  seasonEndsAtLabel?: string | null;
  seasonListDeepLink?: string | null;
  unlockThreshold?: number | null;

  // RETURNING_INACTIVE
  daysSinceLastCheckin?: number | null;
  lastCheckinItemName?: string | null;

  recommendations: RoledRecommendation[];
  updates: ProductUpdate[];
  themedLists: ThemedListLink[];

  nextMetroVoteUrl: string;
  suggestAnotherCityUrl: string;
  inviteUrl: string;
  unsubscribeUrl: string;
  ctaUrl: string; // wrapped through campaign-link for click attribution
};

// A never-checked-off user with metroSource='unknown' gets the general
// market-discovery treatment everywhere in the template — no Phoenix (or
// any other metro) recommendations, season progress, or themed lists, and
// never a claim that anything is "nearby."
function isUnknownMetroDiscovery(d: RecapEmailData): boolean {
  return d.segment === 'NEVER_CHECKED_OFF' && d.metroSource === 'unknown';
}

function statCard(value: string | number, label: string): string {
  return `<td class="stat" width="33.3%" style="padding:0 4px;"><div style="background:rgba(255,255,255,.08);border:1px solid rgba(245,166,35,.32);border-radius:18px;padding:16px;"><div style="font-size:24px;font-weight:950;color:#FFFFFF;line-height:28px;">${escapeHtml(value)}</div><div style="font-size:11px;font-weight:800;color:#AEB4C0;text-transform:uppercase;letter-spacing:.7px;">${escapeHtml(label)}</div></div></td>`;
}

function card(inner: string): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #E8E3DA;border-radius:20px;overflow:hidden;margin-bottom:12px;"><tr><td style="padding:18px 18px 16px;background:#FFFFFF;">${inner}</td></tr></table>`;
}

function personalOpeningSection(d: RecapEmailData): string {
  const opening = SEGMENT_OPENING[d.segment];
  if (d.segment === 'ACTIVE_AUGUST') {
    const names = (d.completedNames || []).slice(0, 3).map(escapeHtml).join(', ');
    return `
      <div style="font-size:13px;font-weight:800;color:#F5A623;text-transform:uppercase;letter-spacing:1.4px;margin-bottom:12px;">${escapeHtml(d.metroName || 'Your city')}${d.mostActiveHood ? ' · ' + escapeHtml(d.mostActiveHood) : ''}</div>
      <div class="hero-title" style="font-size:32px;line-height:38px;font-weight:950;letter-spacing:-1px;color:#FFFFFF;margin:0 0 14px;">${d.firstName ? escapeHtml(d.firstName) + ', ' : ''}${escapeHtml(opening.charAt(0).toLowerCase() + opening.slice(1))}</div>
      <div style="font-size:16px;line-height:25px;color:#D7DAE1;margin:0 0 24px;">You checked off <strong style="color:#FFFFFF;">${d.checkinsThisMonth}</strong> ${d.checkinsThisMonth === 1 ? 'thing' : 'things'} in August${names ? `: <strong style="color:#FFFFFF;">${names}</strong>` : ''}.</div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
        ${statCard(d.checkinsThisMonth ?? 0, 'August CheckOffs')}
        ${statCard(d.pointsThisMonth ?? 0, 'Points earned')}
        ${statCard(d.currentStreakWeeks ?? 0, 'Week streak')}
      </tr></table>`;
  }
  if (d.segment === 'FALL_CONTINUATION') {
    return `
      <div style="font-size:13px;font-weight:800;color:#F5A623;text-transform:uppercase;letter-spacing:1.4px;margin-bottom:12px;">${escapeHtml(d.metroName || 'Your city')}</div>
      <div class="hero-title" style="font-size:32px;line-height:38px;font-weight:950;letter-spacing:-1px;color:#FFFFFF;margin:0 0 14px;">${d.firstName ? escapeHtml(d.firstName) + ', y' : 'Y'}our Fall progress is waiting.</div>
      <div style="font-size:16px;line-height:25px;color:#D7DAE1;margin:0 0 8px;">No August CheckOffs yet, but ${escapeHtml(d.seasonName || 'your Fall list')} is still open — you've got ${d.seasonCompleted ?? 0} of ${d.seasonTotal ?? '?'} done.</div>`;
  }
  if (d.segment === 'RETURNING_INACTIVE') {
    return `
      <div style="font-size:13px;font-weight:800;color:#F5A623;text-transform:uppercase;letter-spacing:1.4px;margin-bottom:12px;">${escapeHtml(d.metroName || 'CheckOff')}</div>
      <div class="hero-title" style="font-size:32px;line-height:38px;font-weight:950;letter-spacing:-1px;color:#FFFFFF;margin:0 0 14px;">A lot changed while you were away.</div>
      <div style="font-size:16px;line-height:25px;color:#D7DAE1;margin:0 0 8px;">${d.lastCheckinItemName ? `Last time you checked off ${escapeHtml(d.lastCheckinItemName)}` : "It's been a while since your last CheckOff"}${d.daysSinceLastCheckin ? ` — ${d.daysSinceLastCheckin} days ago` : ''}. Here's what's new.</div>`;
  }
  if (d.segment === 'NEVER_CHECKED_OFF') {
    if (isUnknownMetroDiscovery(d)) {
      return `
        <div style="font-size:13px;font-weight:800;color:#F5A623;text-transform:uppercase;letter-spacing:1.4px;margin-bottom:12px;">CheckOff</div>
        <div class="hero-title" style="font-size:32px;line-height:38px;font-weight:950;letter-spacing:-1px;color:#FFFFFF;margin:0 0 14px;">${escapeHtml(UNKNOWN_METRO_OPENING)}</div>
        <div style="font-size:16px;line-height:25px;color:#D7DAE1;margin:0 0 8px;">Now live in ${AVAILABLE_MARKETS.length} cities and — as of this month — on Android too. Pick a place and find your first CheckOff.</div>`;
    }
    return `
      <div style="font-size:13px;font-weight:800;color:#F5A623;text-transform:uppercase;letter-spacing:1.4px;margin-bottom:12px;">${escapeHtml(d.metroName || 'CheckOff')}</div>
      <div class="hero-title" style="font-size:32px;line-height:38px;font-weight:950;letter-spacing:-1px;color:#FFFFFF;margin:0 0 14px;">Let's find your first CheckOff.</div>
      <div style="font-size:16px;line-height:25px;color:#D7DAE1;margin:0 0 8px;">Three easy places to start, picked for ${escapeHtml(d.metroName || 'your area')}.</div>`;
  }
  return '';
}

function seasonSection(d: RecapEmailData): string {
  if (!d.seasonName || d.seasonTotal == null) return '';
  const pct = d.seasonTotal ? Math.round(((d.seasonCompleted ?? 0) / d.seasonTotal) * 100) : 0;
  const remaining = Math.max((d.seasonTotal ?? 0) - (d.seasonCompleted ?? 0), 0);
  const almost = almostThereMessage(d.seasonCompleted ?? 0, d.unlockThreshold);
  return `
    <tr><td class="px" style="padding:26px 34px 8px;background:#FFFFFF;">
      <div style="background:#FFF7E8;border:1px solid #F8D89D;border-radius:22px;padding:22px;">
        <div style="font-size:13px;font-weight:900;color:#A35F00;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:8px;">${escapeHtml(d.seasonName)}</div>
        <div style="font-size:20px;font-weight:950;letter-spacing:-.4px;color:#171A21;line-height:27px;margin-bottom:10px;">${d.seasonCompleted ?? 0} of ${d.seasonTotal} complete (${pct}%)</div>
        <div style="background:#F0E3C6;border-radius:999px;height:8px;overflow:hidden;margin-bottom:10px;"><div style="background:#F5A623;height:8px;width:${pct}%;"></div></div>
        <div style="font-size:14px;line-height:21px;color:#4B5260;margin-bottom:6px;">${remaining} left${d.seasonDaysRemaining != null ? ` · ${d.seasonDaysRemaining} days left in the season` : ''}</div>
        ${almost ? `<div style="font-size:14px;font-weight:800;color:#A35F00;margin-bottom:10px;">${escapeHtml(almost)}</div>` : ''}
        <a href="${escapeHtml(d.seasonListDeepLink || d.ctaUrl)}" style="display:inline-block;color:#0F1117;background:#F5A623;border-radius:999px;padding:10px 16px;font-size:13px;font-weight:900;text-decoration:none;">Continue ${escapeHtml(d.seasonName)}</a>
      </div>
    </td></tr>`;
}

function recommendationsSection(d: RecapEmailData): string {
  if (!d.recommendations?.length) return '';
  const roleLabel: Record<string, string> = { easy_next: 'Easy next CheckOff', made_for_you: 'Made for your interests', try_different: 'Try something different' };
  const cards = d.recommendations.map((r) => card(`
    <div style="font-size:11px;font-weight:900;color:#A35F00;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">${escapeHtml(roleLabel[r.role] || 'Try this')}</div>
    <div class="item-title" style="font-size:18px;line-height:24px;font-weight:900;color:#171A21;margin-bottom:10px;">${escapeHtml(r.body)}</div>
    <a href="${escapeHtml(r.url)}" style="display:inline-block;color:#0F1117;background:#F5A623;border-radius:999px;padding:10px 15px;font-size:13px;font-weight:900;text-decoration:none;">Open this idea</a>
  `)).join('');
  return `
    <tr><td class="px" style="padding:26px 34px 8px;background:#FFFFFF;">
      <div style="font-size:23px;line-height:29px;font-weight:950;letter-spacing:-.5px;color:#171A21;margin-bottom:14px;">${escapeHtml(RECOMMENDATION_HEADING)}</div>
      ${cards}
    </td></tr>`;
}

// Clearly-labeled replacement for the recommendations section when no
// responsible item-level personalization is possible (unknown metro).
// Lists the real, currently-live markets — never phrased as "near you."
function marketDiscoverySection(d: RecapEmailData): string {
  const cities = AVAILABLE_MARKETS.map((city) => `
    <a href="${escapeHtml(d.ctaUrl)}" style="display:block;background:#F4F1EA;border-radius:16px;padding:14px 16px;margin-bottom:8px;color:#171A21;font-weight:800;font-size:15px;text-decoration:none;">${escapeHtml(city)} →</a>
  `).join('');
  return `
    <tr><td class="px" style="padding:26px 34px 8px;background:#FFFFFF;">
      <div style="font-size:23px;line-height:29px;font-weight:950;letter-spacing:-.5px;color:#171A21;margin-bottom:6px;">CheckOff is live in ${AVAILABLE_MARKETS.length} cities</div>
      <div style="font-size:15px;line-height:23px;color:#596170;margin-bottom:14px;">We don't know where you are yet, so here's every city CheckOff covers right now — pick the one that's yours.</div>
      ${cities}
    </td></tr>`;
}

function updatesSection(d: RecapEmailData): string {
  if (!d.updates?.length) return '';
  const items = d.updates.map((u) => `<div style="font-size:14px;line-height:22px;color:#4B5260;margin-bottom:8px;">• ${escapeHtml(u.copy)}</div>`).join('');
  return `
    <tr><td class="px" style="padding:26px 34px 8px;background:#FFFFFF;">
      <div style="font-size:20px;line-height:26px;font-weight:950;letter-spacing:-.4px;color:#171A21;margin-bottom:12px;">Since your last activity</div>
      ${items}
    </td></tr>`;
}

function themedListsSection(d: RecapEmailData): string {
  if (!d.themedLists?.length) return '';
  const items = d.themedLists.map((l) => `<a href="${escapeHtml(l.url)}" style="display:block;background:#F4F1EA;border-radius:16px;padding:14px 16px;margin-bottom:8px;color:#171A21;font-weight:800;font-size:15px;text-decoration:none;">${escapeHtml(l.title)} →</a>`).join('');
  return `
    <tr><td class="px" style="padding:8px 34px 8px;background:#FFFFFF;">
      <div style="font-size:20px;line-height:26px;font-weight:950;letter-spacing:-.4px;color:#171A21;margin-bottom:12px;">Themed lists worth a look</div>
      ${items}
    </td></tr>`;
}

function streakSection(d: RecapEmailData): string {
  const msg = streakMessage(d.currentStreakWeeks, !!d.hasRecentActivity);
  return `
    <tr><td class="px" style="padding:8px 34px 8px;background:#FFFFFF;">
      <div style="font-size:15px;line-height:23px;color:#596170;">🔥 ${escapeHtml(msg)}</div>
    </td></tr>`;
}

function nextMetroSection(d: RecapEmailData): string {
  return `
    <tr><td class="px" style="padding:26px 34px 8px;background:#FFFFFF;">
      <div style="font-size:20px;line-height:26px;font-weight:950;letter-spacing:-.4px;color:#171A21;margin-bottom:10px;">Where should CheckOff go next?</div>
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

function widgetTeaseSection(): string {
  return `
    <tr><td class="px" style="padding:8px 34px 8px;background:#FFFFFF;">
      <div style="font-size:14px;line-height:22px;color:#7A8290;font-style:italic;">Something new is coming to your home screen. Soon, finding the next local thing worth doing may not even require opening CheckOff.</div>
    </td></tr>`;
}

// Unknown-metro discovery gets its own CTA copy ("Choose a city to
// explore") rather than the generic "Open CheckOff" — there's a specific
// action we want, not a vague app-open.
function mainCtaLabel(d: RecapEmailData): string {
  if (isUnknownMetroDiscovery(d)) return 'Choose a city to explore';
  return deviceCta(d.platform).label;
}

function closingSection(d: RecapEmailData): string {
  const store = storeCta(d.platform);
  return `
    <tr><td align="center" class="px" style="padding:24px 34px 30px;background:#FFFFFF;">
      <div style="font-size:15px;line-height:23px;color:#4B5260;margin-bottom:20px;">${escapeHtml(seasonalClosingCopy(isUnknownMetroDiscovery(d) ? null : d.metroName))}</div>
      <a href="${escapeHtml(d.ctaUrl)}" style="display:inline-block;background:#F5A623;color:#0F1117;text-decoration:none;font-size:16px;font-weight:950;border-radius:999px;padding:15px 26px;margin-bottom:10px;">${escapeHtml(mainCtaLabel(d))}</a>
      <div style="font-size:12px;line-height:18px;color:#9AA1AC;margin-top:12px;"><a href="${escapeHtml(store.url)}" style="color:#9AA1AC;">${escapeHtml(store.label)}</a></div>
    </td></tr>`;
}

export function buildRecapEmailHtml(d: RecapEmailData): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>Your August CheckOff Recap</title>
<style>
@media only screen and (max-width: 620px) {
  .container { width: 100% !important; }
  .px { padding-left: 22px !important; padding-right: 22px !important; }
  .stack { display: block !important; width: 100% !important; }
  .stat { display: block !important; width: 100% !important; margin-bottom: 10px !important; }
  .hero-title { font-size: 26px !important; line-height: 32px !important; }
  .item-title { font-size: 17px !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background:#F4F1EA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#171A21;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">New places, Fall experiences, personalized picks, and something new coming soon.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F4F1EA;">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" class="container" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;background:#FFFFFF;border-radius:28px;overflow:hidden;box-shadow:0 18px 55px rgba(15,17,23,.12);">
<tr><td style="background:#0F1117;padding:26px 30px 22px;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
    <td align="left" style="font-size:26px;font-weight:900;letter-spacing:-.8px;line-height:30px;"><span style="color:#F5A623;">Check</span><span style="color:#FFFFFF;">Off</span></td>
    <td align="right" style="font-size:11px;font-weight:800;color:#F5A623;text-transform:uppercase;letter-spacing:1.2px;">August Recap</td>
  </tr></table>
</td></tr>
<tr><td class="px" style="padding:36px 34px 22px;background:#0F1117;background-image:linear-gradient(180deg,#0F1117 0%,#171A21 100%);">
  ${personalOpeningSection(d)}
</td></tr>
${isUnknownMetroDiscovery(d) ? '' : seasonSection(d)}
${isUnknownMetroDiscovery(d) ? marketDiscoverySection(d) : recommendationsSection(d)}
${updatesSection(d)}
${isUnknownMetroDiscovery(d) ? '' : themedListsSection(d)}
${streakSection(d)}
${nextMetroSection(d)}
${shareSection(d)}
${widgetTeaseSection()}
${closingSection(d)}
<tr><td style="background:#0F1117;padding:26px 30px;text-align:center;">
  <div style="font-size:13px;line-height:20px;color:#D7DAE1;font-weight:700;">Built for discovery. Ready for visitors.</div>
  <div style="font-size:11px;line-height:18px;color:#8F97A6;margin-top:10px;">getcheckoff.com · <a href="${escapeHtml(d.unsubscribeUrl)}" style="color:#F5A623;text-decoration:underline;">unsubscribe</a></div>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
