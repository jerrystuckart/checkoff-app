type RecommendedItem = {
  name?: string;
  title?: string;
  note?: string;
  description?: string;
  neighborhood?: string;
  url?: string;
  deep_link?: string;
};

type CheckOffUser = {
  display_name?: string | null;
  email: string;
  metro_name?: string | null;
  neighborhood_name?: string | null;
  checkins_this_month?: number | null;
  lifetime_points?: number | null;
  current_streak?: number | null;
  season_total_items?: number | null;
  season_days_remaining?: number | null;
  recommended_items?: RecommendedItem[] | null;
  unsubscribe_url?: string | null;
};

const BRAND = {
  appUrl: 'https://getcheckoff.com',
  submitUrl: 'https://getcheckoff.com/submit',
};

function esc(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function firstName(user: CheckOffUser): string {
  const raw = user.display_name?.trim() || 'there';
  return raw.split(' ')[0];
}

function item(user: CheckOffUser, index: number): Required<RecommendedItem> {
  const fallback = [
    { name: 'Find one hidden local spot', note: 'Open CheckOff and pick something nearby that you have not tried yet.' },
    { name: 'Start a weekend list', note: 'Grab two or three ideas and make this weekend easier to plan.' },
    { name: 'Invite your crew', note: 'Everything is better when someone else is checking things off with you.' },
  ][index];

  const source = user.recommended_items?.[index] ?? fallback;
  return {
    name: source.name || source.title || (source as any).body || fallback.name,
    title: source.title || source.name || fallback.name,
    note: source.note || source.description || fallback.note,
    description: source.description || source.note || fallback.note,
    neighborhood: source.neighborhood || '',
    url: source.url || source.deep_link || BRAND.appUrl,
    deep_link: source.deep_link || source.url || BRAND.appUrl,
  };
}

function replaceBase(html: string, user: CheckOffUser): string {
  const items = [item(user, 0), item(user, 1), item(user, 2)];
  return html
    .replaceAll('{{display_name}}', esc(firstName(user)))
    .replaceAll('{{metro_name}}', esc(user.metro_name || 'Your city'))
    .replaceAll('{{neighborhood_name}}', esc(user.neighborhood_name || 'local favorites'))
    .replaceAll('{{checkins_this_month}}', esc(user.checkins_this_month ?? 0))
    .replaceAll('{{lifetime_points}}', esc(user.lifetime_points ?? 0))
    .replaceAll('{{current_streak}}', esc(user.current_streak ?? 0))
    .replaceAll('{{season_total_items}}', esc(user.season_total_items ?? ''))
    .replaceAll('{{season_days_remaining}}', esc(user.season_days_remaining ?? ''))
    .replaceAll('{{unsubscribe_url}}', esc(user.unsubscribe_url || '#'))
    .replaceAll('{{item_1_name}}', esc(items[0].name))
    .replaceAll('{{item_1_note}}', esc(items[0].note))
    .replaceAll('{{item_1_url}}', esc(items[0].url))
    .replaceAll('{{item_2_name}}', esc(items[1].name))
    .replaceAll('{{item_2_note}}', esc(items[1].note))
    .replaceAll('{{item_2_url}}', esc(items[1].url))
    .replaceAll('{{item_3_name}}', esc(items[2].name))
    .replaceAll('{{item_3_note}}', esc(items[2].note))
    .replaceAll('{{item_3_url}}', esc(items[2].url));
}

// In your Supabase Edge Function, load the matching HTML file as a string and pass it here.
export function renderCheckOffEmail(templateHtml: string, user: CheckOffUser): string {
  return replaceBase(templateHtml, user);
}

export function monthlyRecapSubject(user: CheckOffUser): string {
  return `${firstName(user)}, your CheckOff month: ${user.checkins_this_month ?? 0} checked off`;
}

export function inactiveSubject(user: CheckOffUser): string {
  return `${firstName(user)}, your next local win is waiting`;
}

export function neverCheckedInSubject(user: CheckOffUser): string {
  return `${firstName(user)}, let’s get your first CheckOff`;
}
