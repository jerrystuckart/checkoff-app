-- Champion review UX fields. Additive. Candidate/decision tables only: nothing here touches public.items.
-- chamber_question: concise Chamber-facing question(s), one per line. Internal research stays in research_notes (admin only).
-- availability_type: how an experience is available. NULL means evergreen. event_only experiences stay Seasonal and are only
--   ever activated inside a verified event window; pop_up is maker/vendor inventory with no confirmed permanent location;
--   lodging_only is a guest-stay experience for Nearby/Closest, not for curated destination lists.
-- body_provisional: the proposed CheckOff is intentionally generic until a distinctive hook is confirmed.
alter table public.destination_item_candidates
  add column if not exists chamber_question text check (char_length(chamber_question) <= 400),
  add column if not exists availability_type text check (availability_type in ('event_only','pop_up','lodging_only')),
  add column if not exists body_provisional boolean not null default false;
alter table public.destination_item_decisions
  add column if not exists chamber_question text check (char_length(chamber_question) <= 400);
