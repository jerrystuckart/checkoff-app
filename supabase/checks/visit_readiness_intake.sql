-- Rolled-back check: intake trigger, explicit exclusions, readiness view. Run: supabase db query -f supabase/checks/visit_readiness_intake.sql --linked
-- Expected: ERROR ... ROLLED BACK TEST RESULT: nocoords=null later=restaurant/auto_v1 adventure=null/incomplete afterManual=manual_only/intentionally_excluded auto=restaurant/auto_v1/monitored_ready
DO $$
DECLARE nb uuid; cf uuid; ca uuid; a uuid; b uuid; c uuid; r text;
BEGIN
  SELECT n.id INTO nb FROM neighborhoods n JOIN metro_areas m ON m.id=n.metro_id WHERE m.slug='amalfi-coast' LIMIT 1;
  SELECT id INTO cf FROM categories WHERE name='Food & drink';
  SELECT id INTO ca FROM categories WHERE name='Adventure';
  -- 1: geocoded restaurant -> auto
  INSERT INTO items (body, category_id, neighborhood_id, is_active, is_universal, maps_lat, maps_lng) VALUES ('Order pasta at ''Trattoria Prova''', cf, nb, true, false, 40.63, 14.6) RETURNING id INTO a;
  -- 2: no coords -> null, then coords arrive later -> auto
  INSERT INTO items (body, category_id, neighborhood_id, is_active, is_universal) VALUES ('Order pizza at ''Pizzeria Prova''', cf, nb, true, false) RETURNING id INTO b;
  r := 'nocoords=' || COALESCE((SELECT visit_profile_key FROM items WHERE id=b),'null');
  UPDATE items SET maps_lat=40.63, maps_lng=14.6 WHERE id=b;
  r := r || ' later=' || COALESCE((SELECT visit_profile_key||'/'||visit_profile_source FROM items WHERE id=b),'null');
  -- 3: adventure (no confident rule) -> stays null, readiness incomplete; explicit manual_only preserved
  INSERT INTO items (body, category_id, neighborhood_id, is_active, is_universal, maps_lat, maps_lng) VALUES ('Hike the ''Sentiero Prova''', ca, nb, true, false, 40.63, 14.6) RETURNING id INTO c;
  r := r || ' adventure=' || COALESCE((SELECT visit_profile_key FROM items WHERE id=c),'null') || '/' || (SELECT readiness FROM item_visit_readiness WHERE item_id=c);
  UPDATE items SET visit_profile_key='manual_only', visit_profile_source='admin' WHERE id=c;
  UPDATE items SET body='Hike the ''Sentiero Prova 2''' WHERE id=c;
  r := r || ' afterManual=' || (SELECT i.visit_profile_key||'/'||v.readiness FROM items i JOIN item_visit_readiness v ON v.item_id=i.id WHERE i.id=c);
  r := r || ' auto=' || (SELECT i.visit_profile_key||'/'||i.visit_profile_source||'/'||v.readiness FROM items i JOIN item_visit_readiness v ON v.item_id=i.id WHERE i.id=a);
  RAISE EXCEPTION 'ROLLED BACK TEST RESULT: %', r;
END $$;
