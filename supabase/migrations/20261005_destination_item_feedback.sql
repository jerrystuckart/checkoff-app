-- Destination Hub business self-service + Champion review (getcheckoff.com/{slug}/partners, /{slug}/champion).
-- Additive only. NOT applied automatically: run once in the Supabase SQL editor.
-- All new tables have RLS enabled with NO policies: they are reachable only through the
-- getcheckoff-site Vercel functions (service role). Nothing here lets an unauthenticated
-- caller write to items.

-- 1. Business verifications and change requests (one table, typed). Never writes to items.
create table if not exists public.destination_item_submissions (
  id                 uuid primary key default gen_random_uuid(),
  destination_id     uuid not null references public.destinations(id) on delete cascade,
  item_id            uuid not null references public.items(id) on delete cascade,
  submission_type    text not null check (submission_type in ('verification','change_request')),
  status             text not null default 'pending'
                       check (status in ('pending','recorded','in_review','applied','declined')),
  item_body_snapshot text not null,          -- exact item text the business saw when they responded
  business_name      text,
  contact_name       text not null check (char_length(contact_name) <= 120),
  contact_email      text not null check (char_length(contact_email) <= 320),
  contact_phone      text check (char_length(contact_phone) <= 40),
  suggested_wording  text check (char_length(suggested_wording) <= 1500),
  issue_description  text check (char_length(issue_description) <= 1500),
  website_correction text check (char_length(website_correction) <= 300),
  address_correction text check (char_length(address_correction) <= 300),
  notes              text check (char_length(notes) <= 1500),
  utm_source         text check (char_length(utm_source) <= 80),
  utm_medium         text check (char_length(utm_medium) <= 80),
  utm_campaign       text check (char_length(utm_campaign) <= 80),
  utm_content        text check (char_length(utm_content) <= 80),
  ip_hash            text,                   -- HMAC of caller IP, abuse throttling only
  submitted_at       timestamptz not null default now(),
  reviewed_at        timestamptz,
  reviewed_by        text,                   -- reviewer email
  review_notes       text
);
create index if not exists dis_dest_status on public.destination_item_submissions (destination_id, submission_type, status);
create index if not exists dis_item on public.destination_item_submissions (item_id, submitted_at desc);
create index if not exists dis_email_time on public.destination_item_submissions (contact_email, submitted_at);
create index if not exists dis_ip_time on public.destination_item_submissions (ip_hash, submitted_at);
alter table public.destination_item_submissions enable row level security;

-- 2. Who may open /{slug}/champion for a destination (in addition to CheckOff admins, users.is_admin).
create table if not exists public.destination_champions (
  id             uuid primary key default gen_random_uuid(),
  destination_id uuid not null references public.destinations(id) on delete cascade,
  email          text not null check (email = lower(email)),
  display_name   text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (destination_id, email)
);
alter table public.destination_champions enable row level security;

-- 3. Champion go/no-go per item, plus CheckOff's editorial content status.
--    decision: set by Champion or CheckOff. content_status: set by CheckOff admins only (enforced in the API).
create table if not exists public.destination_item_decisions (
  id             uuid primary key default gen_random_uuid(),
  destination_id uuid not null references public.destinations(id) on delete cascade,
  item_id        uuid not null references public.items(id) on delete cascade,
  decision       text check (decision in ('include','exclude','discuss')),
  content_status text check (content_status in ('curated','discoverable','seasonal','reserve','not_included')),
  note           text check (char_length(note) <= 1000),
  decided_by     text,
  updated_at     timestamptz not null default now(),
  unique (destination_id, item_id)
);
alter table public.destination_item_decisions enable row level security;

-- 4. Reuse landing_events for partner-page analytics: new event types + optional item.
alter table public.landing_events drop constraint if exists landing_events_event_type_check;
alter table public.landing_events add constraint landing_events_event_type_check check (event_type in (
  'landing_view','app_open_attempt','app_open_success','appstore_click','playstore_click',
  'partners_view','business_lookup','business_selected','verification_submitted',
  'change_request_submitted','promo_click','upgrade_email_click','visitor_page_click'));
alter table public.landing_events add column if not exists item_id uuid;

-- Seed example (run separately once the Chamber contact is known):
-- insert into public.destination_champions (destination_id, email, display_name)
-- values ('bb4f0caf-c6ce-4eae-a7fd-c622bf115639', 'name@willcoxchamber.example', 'Willcox Chamber');
