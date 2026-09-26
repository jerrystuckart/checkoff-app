-- Amalfi Coast launch, step 4 of 4 — 2026-09-26
-- Positano Destination Hub, modeled on Willcox (destinations + destination_zones + destination_lists + lists).
-- Willcox rows are not touched. No partners, spotlights or outreach are created.
--  * destination + zone: ACTIVE. The zone is checked by GPS distance from its own center/radius
--    (HomeScreen.jsx), independent of area selection, so activating it is safe on every installed build.
--  * zone radius 7 km around the town (Praiano, Nocelle, Path of the Gods, Montepertuso, Conca dei Marini
--    inside; Amalfi 10.0 km, Sorrento 9.2 km, Sant'Agnello 7.2 km outside).
--  * lists are public official lists (is_public=true) so list_items are readable when a visitor adopts a copy
--    (Willcox's list is non-public; that is a separate, untouched Willcox issue).
--  * Requires steps 2 and 3. hero_image_url values are filled by the image step.
BEGIN;
INSERT INTO public.destinations (id, name, slug, description, is_active, center_lat, center_lng)
VALUES ('87f92f2d-e249-403c-ab18-da56dfcf1bdd', 'Positano', 'positano',
  'Pastel houses stacked down a cliff to the sea. Start with the classics, then follow the stairs and shuttle roads up to the mountain villages and cove trattorias most visitors skip.',
  true, 40.6281, 14.4850);

INSERT INTO public.lists (id, creator_id, title, starts_at, ends_at, is_public, is_official, metro_id, cover_emoji) VALUES
  ('fb5ed539-39ad-43c9-aae6-f6597a5ee76e', '11275026-65be-4421-80a4-46c57195408b', 'Positano Essentials', '2026-09-01', '2027-12-31', true, true, 'b3e00b75-59f0-4b8f-ad3a-f6a203365821', '🍋'),
  ('5bb9bc06-6406-4c82-b5e7-f6d3d3129606',     '11275026-65be-4421-80a4-46c57195408b', 'Positano Beyond the Postcard', '2026-09-01', '2027-12-31', true, true, 'b3e00b75-59f0-4b8f-ad3a-f6a203365821', '🌿');

INSERT INTO public.list_items (list_id, item_id, sort_order) VALUES
  ('fb5ed539-39ad-43c9-aae6-f6597a5ee76e', (SELECT id FROM public.items WHERE google_place_id='ChIJoSIkncCWOxMRb3hQoKcIt7A' AND neighborhood_id IN (SELECT id FROM public.neighborhoods WHERE metro_id='b3e00b75-59f0-4b8f-ad3a-f6a203365821') AND body=$b$See the Byzantine Black Madonna icon beneath the majolica-tiled dome of 'Chiesa di Santa Maria Assunta'$b$), 1),
  ('fb5ed539-39ad-43c9-aae6-f6597a5ee76e', (SELECT id FROM public.items WHERE google_place_id='ChIJJbN_PpiXOxMR54BkeDpk_Ps' AND neighborhood_id IN (SELECT id FROM public.neighborhoods WHERE metro_id='b3e00b75-59f0-4b8f-ad3a-f6a203365821') AND body=$b$Watch Positano's pastel houses turn gold from the pebbles of 'Spiaggia Grande' in the hour before sunset$b$), 2),
  ('fb5ed539-39ad-43c9-aae6-f6597a5ee76e', (SELECT id FROM public.items WHERE google_place_id='ChIJm5orj3eXOxMRdbp-qtR0VNw' AND neighborhood_id IN (SELECT id FROM public.neighborhoods WHERE metro_id='b3e00b75-59f0-4b8f-ad3a-f6a203365821') AND body=$b$Step inside the Roman villa buried under Positano by the 79 AD eruption of Vesuvius at 'MAR Positano'$b$), 3),
  ('fb5ed539-39ad-43c9-aae6-f6597a5ee76e', (SELECT id FROM public.items WHERE google_place_id='ChIJn39rOm-XOxMRUfFtSNEoScg' AND neighborhood_id IN (SELECT id FROM public.neighborhoods WHERE metro_id='b3e00b75-59f0-4b8f-ad3a-f6a203365821') AND body=$b$Order the Delizia al Limone in the lemon-tree garden behind the counter at 'La Zagara'$b$), 4),
  ('fb5ed539-39ad-43c9-aae6-f6597a5ee76e', (SELECT id FROM public.items WHERE google_place_id='ChIJzxm5RG-XOxMRiyc4qbt4UHM' AND neighborhood_id IN (SELECT id FROM public.neighborhoods WHERE metro_id='b3e00b75-59f0-4b8f-ad3a-f6a203365821') AND body=$b$Have leather sandals cut and fitted to your feet by a third-generation cobbler at 'Artigianato Rallo'$b$), 5),
  ('fb5ed539-39ad-43c9-aae6-f6597a5ee76e', (SELECT id FROM public.items WHERE google_place_id='ChIJuxunJW-XOxMRd-7kxOP4ih0' AND neighborhood_id IN (SELECT id FROM public.neighborhoods WHERE metro_id='b3e00b75-59f0-4b8f-ad3a-f6a203365821') AND body=$b$Order a Franco's Fizz on the sea-hung terrace an hour before sunset at 'Franco's Bar'$b$), 6),
  ('fb5ed539-39ad-43c9-aae6-f6597a5ee76e', (SELECT id FROM public.items WHERE google_place_id='ChIJoUijgBeXOxMRayKHsUIVhIs' AND neighborhood_id IN (SELECT id FROM public.neighborhoods WHERE metro_id='b3e00b75-59f0-4b8f-ad3a-f6a203365821') AND body=$b$Ride the free red boat from Positano's harbor to a cove-side table and order mozzarella grilled on lemon leaves at 'Ristorante Da Adolfo'$b$), 7),
  ('fb5ed539-39ad-43c9-aae6-f6597a5ee76e', (SELECT id FROM public.items WHERE google_place_id='ChIJeZDhvGeXOxMRtumC1QyEOpQ' AND neighborhood_id IN (SELECT id FROM public.neighborhoods WHERE metro_id='b3e00b75-59f0-4b8f-ad3a-f6a203365821') AND body=$b$Follow the cliffside path west of the harbor to swim at quieter 'Fornillo Beach'$b$), 8),
  ('fb5ed539-39ad-43c9-aae6-f6597a5ee76e', (SELECT id FROM public.items WHERE google_place_id='ChIJ3QOeIGmXOxMRHI25GddJioI' AND neighborhood_id IN (SELECT id FROM public.neighborhoods WHERE metro_id='b3e00b75-59f0-4b8f-ad3a-f6a203365821') AND body=$b$Book a boat with 'Lucibello' to swim beside Li Galli, the sirens' islands once owned by Rudolf Nureyev$b$), 9),
  ('fb5ed539-39ad-43c9-aae6-f6597a5ee76e', (SELECT id FROM public.items WHERE google_place_id='ChIJ4coKSfOWOxMRR84g-JLxTp0' AND neighborhood_id IN (SELECT id FROM public.neighborhoods WHERE metro_id='b3e00b75-59f0-4b8f-ad3a-f6a203365821') AND body=$b$Hike the 'Sentiero degli Dei' from Bomerano to Nocelle, then drop down the stairs into Positano$b$), 10),
  ('5bb9bc06-6406-4c82-b5e7-f6d3d3129606', (SELECT id FROM public.items WHERE google_place_id='ChIJtehEnnKXOxMRQW_dziDhCSY' AND neighborhood_id IN (SELECT id FROM public.neighborhoods WHERE metro_id='b3e00b75-59f0-4b8f-ad3a-f6a203365821') AND body=$b$Climb the stairs up to 'Montepertuso' and find the hole in the mountain that gave the village its name$b$), 1),
  ('5bb9bc06-6406-4c82-b5e7-f6d3d3129606', (SELECT id FROM public.items WHERE google_place_id='ChIJjdDMD22XOxMRb7rKwBYWLd4' AND neighborhood_id IN (SELECT id FROM public.neighborhoods WHERE metro_id='b3e00b75-59f0-4b8f-ad3a-f6a203365821') AND body=$b$Order the zuppa saracena, a paella-like seafood stew, at 'Il Ritrovo' in Montepertuso$b$), 2),
  ('5bb9bc06-6406-4c82-b5e7-f6d3d3129606', (SELECT id FROM public.items WHERE google_place_id='ChIJ_RiSYnKXOxMRdL9jkpTcdWk' AND neighborhood_id IN (SELECT id FROM public.neighborhoods WHERE metro_id='b3e00b75-59f0-4b8f-ad3a-f6a203365821') AND body=$b$Order the black-and-white fettuccine with seafood at 'Donna Rosa' in Montepertuso$b$), 3),
  ('5bb9bc06-6406-4c82-b5e7-f6d3d3129606', (SELECT id FROM public.items WHERE google_place_id='ChIJnyb6U22XOxMRPqQQIlxuono' AND neighborhood_id IN (SELECT id FROM public.neighborhoods WHERE metro_id='b3e00b75-59f0-4b8f-ad3a-f6a203365821') AND body=$b$Take the free shuttle up from Positano for the fixed-price, family-style grilled-meat feast on the terraces of 'La Tagliata'$b$), 4),
  ('5bb9bc06-6406-4c82-b5e7-f6d3d3129606', (SELECT id FROM public.items WHERE google_place_id='ChIJV95oyhSXOxMRxN7yxlMzDaA' AND neighborhood_id IN (SELECT id FROM public.neighborhoods WHERE metro_id='b3e00b75-59f0-4b8f-ad3a-f6a203365821') AND body=$b$Swim off the pebbles of 'Arienzo Beach', a cove west of Positano reached by steep stairs or water taxi$b$), 5),
  ('5bb9bc06-6406-4c82-b5e7-f6d3d3129606', (SELECT id FROM public.items WHERE google_place_id='ChIJD9xcIcGWOxMR91xRR_aqtfI' AND neighborhood_id IN (SELECT id FROM public.neighborhoods WHERE metro_id='b3e00b75-59f0-4b8f-ad3a-f6a203365821') AND body=$b$Order the tubetti with squid or lemon risotto steps from the water at 'Trattoria Da Armandino' on Marina di Praia$b$), 6),
  ('5bb9bc06-6406-4c82-b5e7-f6d3d3129606', (SELECT id FROM public.items WHERE google_place_id='ChIJX_vjxcaWOxMRzId7DK-_hzY' AND neighborhood_id IN (SELECT id FROM public.neighborhoods WHERE metro_id='b3e00b75-59f0-4b8f-ad3a-f6a203365821') AND body=$b$Sip a drink at the six-seat onyx bar lit from below inside a sea cave at 'Il Pirata'$b$), 7),
  ('5bb9bc06-6406-4c82-b5e7-f6d3d3129606', (SELECT id FROM public.items WHERE google_place_id='ChIJHZNLy6KWOxMRky7R0i10ybI' AND neighborhood_id IN (SELECT id FROM public.neighborhoods WHERE metro_id='b3e00b75-59f0-4b8f-ad3a-f6a203365821') AND body=$b$Walk down to the pebble beach hidden beneath the arched road bridge at 'Fiordo di Furore'$b$), 8),
  ('5bb9bc06-6406-4c82-b5e7-f6d3d3129606', (SELECT id FROM public.items WHERE google_place_id='ChIJiba0jiOUOxMR2CXzsykurq4' AND neighborhood_id IN (SELECT id FROM public.neighborhoods WHERE metro_id='b3e00b75-59f0-4b8f-ad3a-f6a203365821') AND body=$b$Taste the Furore Bianco Fiorduva, a white grown on cliffside terraces, at 'Cantine Marisa Cuomo'$b$), 9),
  ('5bb9bc06-6406-4c82-b5e7-f6d3d3129606', (SELECT id FROM public.items WHERE google_place_id='ChIJP0CXFRGXOxMRsXndziDhCSY' AND neighborhood_id IN (SELECT id FROM public.neighborhoods WHERE metro_id='b3e00b75-59f0-4b8f-ad3a-f6a203365821') AND body=$b$Climb the roughly 1,500 stone steps up to 'Nocelle', the car-free hamlet perched above Positano$b$), 10);

INSERT INTO public.destination_zones (id, name, slug, banner_title, banner_subtitle, center_lat, center_lng, radius_km, list_id, is_active, destination_id)
VALUES ('40c2324b-a8d0-47e3-967f-5915a2ac7b0b', 'Positano', 'positano', 'Benvenuti a Positano! 🍋',
  '20 experiences waiting — sunset terraces, mountain trattorias, and hidden coves.',
  40.6281, 14.4850, 7, 'fb5ed539-39ad-43c9-aae6-f6597a5ee76e', true, '87f92f2d-e249-403c-ab18-da56dfcf1bdd');

INSERT INTO public.destination_lists (id, destination_id, list_id, relationship_type, sort_order, is_featured, is_active) VALUES
  ('ed395afd-a0cc-4b77-82fa-218d6faa8e24', '87f92f2d-e249-403c-ab18-da56dfcf1bdd', 'fb5ed539-39ad-43c9-aae6-f6597a5ee76e', 'primary',  0, true, true),
  ('66e7ee19-a575-49cf-8b5c-ff213f202eac', '87f92f2d-e249-403c-ab18-da56dfcf1bdd', '5bb9bc06-6406-4c82-b5e7-f6d3d3129606',     'featured', 1, true, true);

-- Guards: every list item must have resolved (NULL item_id would already have failed NOT NULL).
DO $g$ BEGIN
  IF (SELECT count(*) FROM public.list_items WHERE list_id='fb5ed539-39ad-43c9-aae6-f6597a5ee76e') <> 10
  OR (SELECT count(*) FROM public.list_items WHERE list_id='5bb9bc06-6406-4c82-b5e7-f6d3d3129606') <> 10 THEN
    RAISE EXCEPTION 'Hub list item counts do not match';
  END IF;
END $g$;
COMMIT;
