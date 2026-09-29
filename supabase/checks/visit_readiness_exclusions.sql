-- Rolled-back check: explicit exclusions vs unknown keys and undecided items.
-- Expected: ROLLED BACK: explicit=intentionally_excluded badkey=rejected undecided=incomplete/profile
DO $$
DECLARE nb uuid; ca uuid; a uuid; b uuid; r text;
BEGIN
  SELECT n.id INTO nb FROM neighborhoods n JOIN metro_areas m ON m.id=n.metro_id WHERE m.slug='amalfi-coast' LIMIT 1;
  SELECT id INTO ca FROM categories WHERE name='Adventure';
  -- explicit exclusion with no coordinates is accepted and reads as intentionally excluded (not incomplete)
  INSERT INTO items (body, category_id, neighborhood_id, is_active, is_universal, visit_profile_key, visit_profile_source) VALUES ('Walk the ''Sentiero Prova''', ca, nb, true, false, 'manual_only', 'admin') RETURNING id INTO a;
  r := 'explicit=' || (SELECT readiness FROM item_visit_readiness WHERE item_id=a);
  -- an unknown profile key is rejected
  BEGIN
    INSERT INTO items (body, category_id, neighborhood_id, is_active, is_universal, visit_profile_key) VALUES ('Bad ''Prova''', ca, nb, true, false, 'nonsense');
    r := r || ' badkey=ACCEPTED(BUG)';
  EXCEPTION WHEN foreign_key_violation THEN r := r || ' badkey=rejected';
  END;
  -- undecided Adventure with coordinates stays visible as incomplete
  INSERT INTO items (body, category_id, neighborhood_id, is_active, is_universal, maps_lat, maps_lng) VALUES ('Climb ''Prova Rock''', ca, nb, true, false, 40.6, 14.6) RETURNING id INTO b;
  r := r || ' undecided=' || (SELECT readiness||'/'||array_to_string(missing,'+') FROM item_visit_readiness WHERE item_id=b);
  RAISE EXCEPTION 'ROLLED BACK: %', r;
END $$;
