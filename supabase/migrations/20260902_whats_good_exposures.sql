-- What's Good V1 — exposure/rotation cache. Stores, per (user, item), the
-- last time an experience was shown in the What's Good surface. This is a
-- rotation CACHE (upserted, one current value per pair), not an
-- append-only impression log — see decision `whats_good_v1_exposure_rotation`
-- (docs/whats-good-widget/product-discovery.md). Deliberately a dedicated,
-- lightweight table rather than an extension of interaction_events, per
-- that same decision. Run manually via:
--   supabase db query -f supabase/migrations/20260902_whats_good_exposures.sql --linked

BEGIN;

CREATE TABLE IF NOT EXISTS public.whats_good_exposures (
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  item_id       uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  last_shown_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_id)
);

-- No surrogate id, no secondary index: the composite PK (user_id, item_id)
-- already serves the only read pattern this table has — "given a user and
-- a set of ~15 candidate item_ids, get last_shown_at". Revisit only if
-- postflight query patterns prove otherwise.

ALTER TABLE public.whats_good_exposures ENABLE ROW LEVEL SECURITY;

-- Self-row SELECT/INSERT/UPDATE only, matching the audited candidate_visits
-- pattern exactly (supabase/migrations/20260828_visit_detection_phase1.sql).
-- No DELETE policy — this cache is only ever upserted, never deleted, by
-- the app.

DROP POLICY IF EXISTS whats_good_exposures_select_own ON public.whats_good_exposures;
CREATE POLICY whats_good_exposures_select_own
ON public.whats_good_exposures
FOR SELECT
USING (user_id = auth.uid());

DROP POLICY IF EXISTS whats_good_exposures_insert_own ON public.whats_good_exposures;
CREATE POLICY whats_good_exposures_insert_own
ON public.whats_good_exposures
FOR INSERT
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS whats_good_exposures_update_own ON public.whats_good_exposures;
CREATE POLICY whats_good_exposures_update_own
ON public.whats_good_exposures
FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Migration-level self-check, matching this repo's existing convention
-- (see the DO $$ block at the end of 20260828_visit_detection_phase1.sql):
-- fail loudly rather than silently shipping the wrong shape.
DO $$
DECLARE
  pk_cols text;
  policy_count int;
  delete_policy_count int;
  fk_count int;
BEGIN
  SELECT string_agg(a.attname, ',' ORDER BY a.attnum) INTO pk_cols
  FROM pg_index i
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
  WHERE i.indrelid = 'public.whats_good_exposures'::regclass AND i.indisprimary;

  IF pk_cols IS DISTINCT FROM 'user_id,item_id' THEN
    RAISE EXCEPTION 'whats_good_exposures primary key is (%), expected (user_id,item_id)', pk_cols;
  END IF;

  SELECT count(*) INTO fk_count
  FROM pg_constraint
  WHERE conrelid = 'public.whats_good_exposures'::regclass AND contype = 'f' AND confdeltype = 'c';
  IF fk_count <> 2 THEN
    RAISE EXCEPTION 'whats_good_exposures expected exactly 2 ON DELETE CASCADE foreign keys, found %', fk_count;
  END IF;

  SELECT count(*) INTO policy_count FROM pg_policy WHERE polrelid = 'public.whats_good_exposures'::regclass;
  IF policy_count <> 3 THEN
    RAISE EXCEPTION 'whats_good_exposures expected exactly 3 RLS policies, found %', policy_count;
  END IF;

  SELECT count(*) INTO delete_policy_count
  FROM pg_policy WHERE polrelid = 'public.whats_good_exposures'::regclass AND polcmd = 'd';
  IF delete_policy_count <> 0 THEN
    RAISE EXCEPTION 'whats_good_exposures must have no DELETE policy, found %', delete_policy_count;
  END IF;
END $$;

COMMIT;
