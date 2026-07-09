-- ============================================================
-- Creator attribution + list activation infrastructure
-- 2026-06-28
-- ============================================================

-- 1. creators table
create table if not exists creators (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users,
  handle        text unique not null,
  display_name  text,
  avatar_url    text,
  bio           text,
  is_active     boolean default false,
  created_at    timestamptz default now()
);

-- 2. referred_by_creator_id on partners
alter table partners
  add column if not exists referred_by_creator_id uuid references creators(id);

-- 3. checkoff_creator_id + is_creator_list + goes_public_at on lists
--    NOTE: lists.creator_id already exists and belongs to the existing list-authorship
--    system. Do NOT use creator_id for creator attribution — use checkoff_creator_id.
alter table lists
  add column if not exists checkoff_creator_id uuid references creators(id),
  add column if not exists is_creator_list     boolean default false,
  add column if not exists goes_public_at      timestamptz;

-- 4. partner_rewards schema
--    Table already exists as an empty shell — add columns.
alter table partner_rewards
  add column if not exists creator_id     uuid references creators(id),
  add column if not exists partner_id     uuid references partners(id),
  add column if not exists reward_type    text,       -- 'base_commission' | 'retention_6' | 'retention_12'
  add column if not exists amount_cents   integer,
  add column if not exists status         text default 'pending', -- 'pending' | 'paid'
  add column if not exists milestone_date timestamptz,
  add column if not exists paid_at        timestamptz,
  add column if not exists created_at     timestamptz default now();

-- 5. Index for common lookups
create index if not exists idx_creators_handle          on creators(handle);
create index if not exists idx_partners_referred_by     on partners(referred_by_creator_id);
create index if not exists idx_partner_rewards_creator  on partner_rewards(creator_id);
create index if not exists idx_partner_rewards_status   on partner_rewards(status);
create index if not exists idx_lists_checkoff_creator_id on lists(checkoff_creator_id);
create index if not exists idx_lists_is_creator_list     on lists(is_creator_list) where is_creator_list = true;
