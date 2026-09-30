-- Ristorante Da Adolfo: intentional exclusion (2026-09-30).
-- The item is "Board the free boat from Positano's pier to Ristorante Da Adolfo, where lunch means mozzarella grilled on
-- lemon leaves". A stay inside the restaurant's circle is evidence of a meal at that address, not of taking the boat (the
-- restaurant is also reachable on foot from Laurito), and the phone can only observe the restaurant end. On 2026-09-30 the
-- restaurant's circle also opened a session while the phone was resting at lodging ~180 m away. The defining experience is
-- not verifiable by dwelling at one coordinate, the same rule that excludes the other boat/hike/route items, so it is
-- recorded as manual_only. Manual check-off is unaffected.
-- Other Amalfi items that merely mention a boat/shuttle as access (La Gavitella class, Arienzo Beach Club day, Il Ritrovo)
-- keep their profile: the class, the beach day and the meal are the experience there.
-- Reversible: UPDATE items SET visit_profile_key='restaurant', visit_profile_source='curated_2026-09-29' WHERE id='...';
BEGIN;
UPDATE items SET visit_profile_key = 'manual_only', visit_profile_source = 'curated_2026-09-30'
WHERE id::text LIKE '6fc00a62-%' AND visit_profile_key = 'restaurant';
DO $$ BEGIN
  IF (SELECT count(*) FROM items WHERE id::text LIKE '6fc00a62-%' AND visit_profile_key = 'manual_only') <> 1 THEN RAISE EXCEPTION 'Da Adolfo exclusion not applied'; END IF;
END $$;
COMMIT;
