-- Rolled-back check: manual_only survives automated writers and unrelated edits; a person can change it.
-- Expected: ROLLED BACK: auto=blocked null=blocked rule=blocked afterEdits=manual_only/intentionally_excluded admin=restaurant
DO $$
DECLARE nb uuid; ca uuid; a uuid; r text := '';
BEGIN
  SELECT n.id INTO nb FROM neighborhoods n JOIN metro_areas m ON m.id=n.metro_id WHERE m.slug='amalfi-coast' LIMIT 1;
  SELECT id INTO ca FROM categories WHERE name='Food & drink';
  INSERT INTO items (body, category_id, neighborhood_id, is_active, is_universal, maps_lat, maps_lng, visit_profile_key, visit_profile_source)
    VALUES ('Eat at ''Prova Ristorante''', ca, nb, true, false, 40.6, 14.6, 'manual_only', 'admin') RETURNING id INTO a;
  -- automated writers cannot change it
  BEGIN UPDATE items SET visit_profile_key='restaurant', visit_profile_source='auto_v1' WHERE id=a; r := r||'auto=ALLOWED(BUG) '; EXCEPTION WHEN raise_exception THEN r := r||'auto=blocked '; END;
  BEGIN UPDATE items SET visit_profile_key=NULL WHERE id=a; r := r||'null=ALLOWED(BUG) '; EXCEPTION WHEN raise_exception THEN r := r||'null=blocked '; END;
  BEGIN UPDATE items SET visit_profile_key='restaurant', visit_profile_source='rule_v1' WHERE id=a; r := r||'rule=ALLOWED(BUG) '; EXCEPTION WHEN raise_exception THEN r := r||'rule=blocked '; END;
  -- unrelated edits, enrichment of other columns, deactivate/reactivate: exclusion intact
  UPDATE items SET body='Eat at ''Prova Ristorante 2''', maps_lat=40.61, is_active=false WHERE id=a;
  UPDATE items SET is_active=true WHERE id=a;
  r := r||'afterEdits='||(SELECT i.visit_profile_key||'/'||v.readiness FROM items i JOIN item_visit_readiness v ON v.item_id=i.id WHERE i.id=a)||' ';
  -- a person can change it
  UPDATE items SET visit_profile_key='restaurant', visit_profile_source='admin' WHERE id=a;
  r := r||'admin='||(SELECT visit_profile_key FROM items WHERE id=a);
  RAISE EXCEPTION 'ROLLED BACK: %', r;
END $$;
