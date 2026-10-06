-- Destination Hub candidate review layer. Additive. NOT applied automatically.
-- Proposed experiences live HERE, never in public.items, until a CheckOff admin explicitly promotes one
-- (promotion is a manual, separate step: nothing in this migration or the site code writes to items).
-- Service-role only: RLS is on with no policies, like the other destination_item_* tables.

create table if not exists public.destination_item_candidates (
  id                        uuid primary key default gen_random_uuid(),
  destination_id            uuid not null references public.destinations(id) on delete cascade,
  candidate_type            text not null default 'new' check (candidate_type in ('new','rewrite','request')),
                                -- new: proposed experience. rewrite: proposed new wording for a LIVE item (existing_item_id set).
                                -- request: a Champion's "missing place or experience" suggestion.
  group_key                 text,                       -- groups several experiences at one business/place
  place_name                text not null check (char_length(place_name) <= 160),
  proposed_body             text check (char_length(proposed_body) <= 600),   -- null until CheckOff writes it
  category_id               uuid references public.categories(id),
  origin                    text,                       -- chamber_workbook_2026-09-01 | directory_gap_research | public_experience_research | production_pilot | champion_request
  existing_item_id          uuid references public.items(id) on delete set null,  -- the LIVE item this relates to, if any
  chamber_membership_status text check (chamber_membership_status in
                              ('member_confirmed','member_public_directory','not_found','non_member','not_applicable_public_experience')),
  recommended_decision      text check (recommended_decision in ('include','discuss','exclude')),  -- CheckOff's prefill
  recommendation_note       text check (char_length(recommendation_note) <= 600),                  -- Chamber-facing, concise
  chamber_decision          text check (chamber_decision in ('include','discuss','exclude')),      -- the Chamber's call
  chamber_note              text check (char_length(chamber_note) <= 1000),
  decided_by                text,
  decided_at                timestamptz,
  proposed_content_status   text check (proposed_content_status in ('curated','discoverable','seasonal','reserve','not_included')),
  verification_owner_type   text check (verification_owner_type in ('business','chamber','city','destination_partner','checkoff')),
  verification_owner_name   text check (char_length(verification_owner_name) <= 120),
  research_status           text check (research_status in ('needs_research','researched','needs_verification','verified')),
  list_recommendation       text,                       -- likely list placement; NOT applied to production lists
  research_notes            text,                       -- INTERNAL (CheckOff/admin only)
  research_sources          jsonb not null default '[]'::jsonb,   -- INTERNAL: [{url, fact, checked}]
  needs_confirmation        text,                       -- INTERNAL: what still needs a human to confirm
  requested_by              text,                       -- email, for candidate_type = 'request'
  status                    text not null default 'proposed' check (status in ('proposed','promoted','withdrawn')),
  promoted_item_id          uuid references public.items(id) on delete set null,   -- set only by an admin promotion
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index if not exists dic_dest_status on public.destination_item_candidates (destination_id, status);
create index if not exists dic_existing on public.destination_item_candidates (existing_item_id);
alter table public.destination_item_candidates enable row level security;

-- Prefill + membership for LIVE items live on the existing decisions table.
alter table public.destination_item_decisions
  add column if not exists chamber_membership_status text
    check (chamber_membership_status in ('member_confirmed','member_public_directory','not_found','non_member','not_applicable_public_experience')),
  add column if not exists recommended_decision text check (recommended_decision in ('include','discuss','exclude')),
  add column if not exists recommendation_note text check (char_length(recommendation_note) <= 600),
  add column if not exists list_recommendation text,
  add column if not exists research_notes text;   -- INTERNAL
