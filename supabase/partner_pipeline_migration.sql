-- ═══════════════════════════════════════════════════════════════════════════
-- partner_pipeline table — prospective partner outreach & preview pages
-- Run in: Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists partner_pipeline (
  id                uuid        default gen_random_uuid() primary key,
  business_name     text        not null,
  slug              text        not null,           -- e.g. "bryants-cocktail-lounge-preview"
  city              text        not null,           -- display name e.g. "Milwaukee"
  city_slug         text        not null,           -- URL segment e.g. "milwaukee"
  state             text,                           -- e.g. "WI"
  category          text,                           -- e.g. "Bar", "Food", "Experience"
  proposed_item     text,                           -- the CheckOff item wording
  short_reason      text,                           -- why this business is CheckOff-worthy
  status            text        not null default 'draft'
                    check (status in (
                      'draft','preview_ready','contacted','interested',
                      'claimed','paid','live','not_interested'
                    )),
  contact_name      text,                           -- internal only — not exposed publicly
  contact_email     text,                           -- internal only
  contact_phone     text,                           -- internal only
  instagram_url     text,
  website_url       text,
  preview_image_url text,
  logo_url          text,
  stripe_payment_url text,                          -- override per-business Stripe link
  edit_request_url  text,                           -- override edit-request destination
  priority          text        not null default 'medium'
                    check (priority in ('high','medium','low')),
  notes             text,                           -- internal only — not exposed publicly
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  unique (city_slug, slug)
);

-- ── Auto-update updated_at ─────────────────────────────────────────────────
create or replace function update_pipeline_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger partner_pipeline_updated_at
  before update on partner_pipeline
  for each row execute function update_pipeline_updated_at();

-- ── Row Level Security ─────────────────────────────────────────────────────
alter table partner_pipeline enable row level security;

-- Public visitors can read preview-ready+ records
-- Sensitive columns (notes, contact_*) are excluded by not selecting them in queries
create policy "pipeline_public_read" on partner_pipeline
  for select
  using (
    status in ('preview_ready','contacted','interested','claimed','paid','live')
  );

-- Service role (admin) bypasses RLS automatically — no policy needed for admin writes

-- ── Seed data — 3 Milwaukee previews for local testing ────────────────────
insert into partner_pipeline
  (business_name, slug, city, city_slug, state, category, proposed_item, short_reason, status, priority)
values
  (
    'Bryant''s Cocktail Lounge',
    'bryants-cocktail-lounge-preview',
    'Milwaukee', 'milwaukee', 'WI',
    'Bar',
    'Sip a Brainbuster at Bryant''s Cocktail Lounge',
    'Bryant''s has been pouring since 1938. No signs outside. No menu. Just a bartender who makes you whatever you need. That''s the kind of place people should check off.',
    'preview_ready',
    'high'
  ),
  (
    'Leon''s Frozen Custard',
    'leons-frozen-custard-preview',
    'Milwaukee', 'milwaukee', 'WI',
    'Food',
    'Walk to Leon''s Frozen Custard and order a concrete',
    'Open since 1942 with the same neon sign. Leon''s is a Milwaukee rite of passage — the kind of place you take out-of-towners to prove the city has real character.',
    'preview_ready',
    'high'
  ),
  (
    'SafeHouse Milwaukee',
    'safehouse-milwaukee-preview',
    'Milwaukee', 'milwaukee', 'WI',
    'Experience',
    'Exit through the phone booth at SafeHouse Milwaukee',
    'A spy-themed bar with a secret entrance since 1966. You either know the password or you do a dare. CheckOff-worthy by definition.',
    'preview_ready',
    'medium'
  )
on conflict (city_slug, slug) do nothing;
