-- ============================================================
-- interaction_events — product-wide view/click tracking
-- 2026-07-16
--
-- Generic engagement event log so we can report views/clicks to paying
-- destination partners. check_ins alone undercounts real usage — many
-- users open a list and read items aloud (in a car, a hotel room) without
-- ever checking anything off.
--
-- user_id references public.users(id), NOT auth.users — matches every
-- other table in this schema.
--
-- occurred_at (not created_at) matches the check_ins.checked_at naming
-- convention for domain timestamps.
--
-- Event type vocabulary (enforced client-side only, not in the DB):
--   list_view        (list_id set)
--   item_view         (item_id set; list_id set too when known)
--   url_click         (item_id set)
--   directions_click  (item_id set)
--   dare_click        (item_id set)
--
-- RLS: authenticated users may insert their own rows only. No
-- SELECT/UPDATE/DELETE policy for regular users — reads happen only via
-- service_role (admin tool), same pattern as check_ins.
-- ============================================================

CREATE TABLE interaction_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.users(id),
  event_type   text NOT NULL,
  list_id      uuid REFERENCES lists(id),
  item_id      uuid REFERENCES items(id),
  occurred_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_interaction_events_type_occurred ON interaction_events(event_type, occurred_at);
CREATE INDEX idx_interaction_events_list_id       ON interaction_events(list_id);
CREATE INDEX idx_interaction_events_item_id       ON interaction_events(item_id);
CREATE INDEX idx_interaction_events_user_id       ON interaction_events(user_id);

ALTER TABLE interaction_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "interaction_events: users insert their own"
ON interaction_events FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());
