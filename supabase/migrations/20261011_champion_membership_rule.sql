-- Champion membership rule: marks decisions written by the membership policy (not a person), and records who set membership.
-- Additive and nullable. Not applied automatically. No data is changed by this migration.
alter table public.destination_item_decisions
  add column if not exists decision_source text check (decision_source in ('manual','membership','exception')),
  add column if not exists membership_set_by text,
  add column if not exists membership_set_at timestamptz;
alter table public.destination_item_candidates
  add column if not exists decision_source text check (decision_source in ('manual','membership','exception')),
  add column if not exists membership_set_by text,
  add column if not exists membership_set_at timestamptz;
comment on column public.destination_item_decisions.decision_source is 'null/manual = a reviewer chose it; membership = automatic exclusion from Not a Member (cleared automatically if membership changes); exception = admin Include despite Not a Member.';
