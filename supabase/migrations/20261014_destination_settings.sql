-- Destination launch switch. One row per destination; no row (or visibility_enforcement = false) means enforcement is OFF.
-- Additive and empty: creating this table changes nothing. Service role only (RLS on, no policies).
create table if not exists public.destination_settings (
  destination_id uuid primary key references public.destinations(id) on delete cascade,
  visibility_enforcement boolean not null default false,
  updated_by text,
  updated_at timestamptz not null default now(),
  last_launch_run_id text,
  last_launch_at timestamptz
);
alter table public.destination_settings enable row level security;
revoke all on public.destination_settings from anon, authenticated;
comment on table public.destination_settings is 'Per-destination launch switch. visibility_enforcement = true makes Champion decisions control items.is_active.';
