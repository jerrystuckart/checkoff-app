-- What's Good V1 — lifetime "has this user checked off this item" lookup
-- support. check_ins has no existing index on (user_id, item_id): every
-- existing user_id/item-shaped index (idx_check_ins_user_item,
-- idx_check_ins_user_listitem_covering, check_ins_user_id_list_item_id_key,
-- etc.) is keyed on list_item_id, not the canonical item_id column added
-- later (supabase/migrations/20260716_list_deletion_fk_fixes.sql). This is
-- a plain non-unique index only — repeat checkoffs of the same item across
-- seasons remain valid (see 20260806_drop_standalone_lifetime_unique.sql
-- for why a lifetime UNIQUE constraint here would be wrong). Named
-- idx_check_ins_user_item_id (not idx_check_ins_user_item, which already
-- exists on (user_id, list_item_id) and would have silently no-op'd under
-- IF NOT EXISTS if reused). Run manually via:
--   supabase db query -f supabase/migrations/20260902_check_ins_user_item_id_index.sql --linked

BEGIN;

CREATE INDEX IF NOT EXISTS idx_check_ins_user_item_id
ON public.check_ins (user_id, item_id);

-- Migration-level self-check, matching this repo's existing convention.
DO $$
DECLARE
  idx_cols text;
  is_unique boolean;
  legacy_cols text;
BEGIN
  SELECT string_agg(a.attname, ',' ORDER BY k.ord), ix.indisunique
  INTO idx_cols, is_unique
  FROM pg_index ix
  JOIN pg_class ic ON ic.oid = ix.indexrelid
  JOIN unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
  JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = k.attnum
  WHERE ic.relname = 'idx_check_ins_user_item_id'
  GROUP BY ix.indisunique;

  IF idx_cols IS DISTINCT FROM 'user_id,item_id' THEN
    RAISE EXCEPTION 'idx_check_ins_user_item_id covers (%), expected (user_id,item_id)', idx_cols;
  END IF;
  IF is_unique THEN
    RAISE EXCEPTION 'idx_check_ins_user_item_id must be non-unique, but indisunique is true';
  END IF;

  SELECT string_agg(a.attname, ',' ORDER BY k.ord)
  INTO legacy_cols
  FROM pg_index ix
  JOIN pg_class ic ON ic.oid = ix.indexrelid
  JOIN unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
  JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = k.attnum
  WHERE ic.relname = 'idx_check_ins_user_item';

  IF legacy_cols IS DISTINCT FROM 'user_id,list_item_id' THEN
    RAISE EXCEPTION 'legacy idx_check_ins_user_item changed shape — now covers (%), expected (user_id,list_item_id)', legacy_cols;
  END IF;
END $$;

COMMIT;
