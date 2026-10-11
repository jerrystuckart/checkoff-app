-- Audit trail for every public-visibility change made by the Champion rule. Additive; service role only (RLS on, no policies).
create table if not exists public.destination_visibility_log (
  id uuid primary key default gen_random_uuid(),
  destination_id uuid not null,
  item_id uuid not null,
  from_active boolean,
  to_active boolean not null,
  reason text not null,
  changed_by text,
  created_at timestamptz not null default now()
);
create index if not exists destination_visibility_log_item_idx on public.destination_visibility_log (item_id, created_at desc);
alter table public.destination_visibility_log enable row level security;
