-- Initial verification owners for the 26 Willcox pilot items. NOT RUN. Needs Jerry's approval and the
-- 20261006_destination_item_verification_owner.sql migration applied first.
-- Visitor visibility is unaffected: this only sets who is responsible for verifying each item.
-- Review the judgement calls before running (marked REVIEW):
--   REVIEW: Rex Allen museum, Chiricahua Regional Museum and the Historic Theater are set to business (operating organizations).
--   REVIEW: Wings Over Willcox is set to checkoff; it may belong to the Chamber.
--   REVIEW: Warren Earp grave is set to checkoff until the cemetery owner is confirmed (likely City).
--   REVIEW: Railroad Avenue wine trail is set to destination_partner "Willcox Wine Country".
--   Federal, state and public sites with no operating entity here are checkoff (per the ownership model).
insert into public.destination_item_decisions (destination_id, item_id, verification_owner_type, verification_owner_name, decided_by, updated_at)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, v.item_id, v.t, v.n, 'seed-2026-10-06', now()
from (values
  ('84b3ad09-120b-46fa-8e5d-b2339bdcb82d'::uuid, 'business', null),  -- Taste something unexpected at 'Aridus Wine Com
  ('5d15ae43-f561-492e-b64f-9a136d086558'::uuid, 'business', null),  -- Take a selfie with either owner of ‘Birds and 
  ('3c706acd-9a4c-49eb-a46b-7503aed0c8a7'::uuid, 'business', null),  -- Drive out to 'Bodega Pierce' — estate-grown hi
  ('21fdc0b2-374f-4cdf-a0b9-02f7444b1825'::uuid, 'business', null),  -- Find 'Keeling Schaefer Vineyards' in the old W
  ('e2f5020d-37c1-4e53-8076-158173b65316'::uuid, 'business', null),  -- Stop into 'Flying Leap Vineyards' downtown — l
  ('455ed6c5-ee89-4280-a5ea-2854c8d169e2'::uuid, 'business', null),  -- (secret item) Strive Vineyards
  ('d07f42cf-59cb-4060-afae-c656e929d545'::uuid, 'business', null),  -- Touch the walls of the 'Willcox Commercial Sto
  ('daf77fc6-c446-4999-bfad-75584070ad8f'::uuid, 'business', null),  -- Order the brisket at 'Big Tex BBQ' — yes, it's
  ('7018a16a-fc6f-4bc6-a3a2-ce8f097fb87c'::uuid, 'business', null),  -- Grill your own meat at 'Rix's Tavern'
  ('132a829f-12e3-407b-b619-0ecaba8ad73b'::uuid, 'business', null),  -- U-Pick at 'Apple Annies Orchard'
  ('8a9759d7-960a-47c2-804f-285e074880b1'::uuid, 'business', null),  -- Stand in front of the 'Rex Allen Arizona Cowbo
  ('02decd89-e890-406d-901d-d895a7a61b00'::uuid, 'business', null),  -- Walk through the 'Chiricahua Regional Museum' 
  ('d981fbdc-92f4-4d5f-8143-f1b9f25abe17'::uuid, 'business', null),  -- Catch a movie at the 'Willcox Historic Theater
  ('d23154df-54c9-465a-8600-82aef25eda7a'::uuid, 'destination_partner', 'Willcox Wine Country'),  -- Walk the wine trail on 'Railroad Avenue' — thr
  ('f590b131-314b-4d69-bffb-e6666b9a01d9'::uuid, 'checkoff', null),  -- Drive the scenic road through 'Chiricahua Nati
  ('e620f063-7ff1-4414-ba99-12ece149c7e7'::uuid, 'checkoff', null),  -- Spot a coati, javelina, or black bear on a tra
  ('c4b020ca-0782-4b00-bf31-759462ab228f'::uuid, 'checkoff', null),  -- Hike to 'Massai Point' at Chiricahua — half a 
  ('29270440-d54a-44fb-b0ad-5c3469f9c487'::uuid, 'checkoff', null),  -- Hike the 1.5 miles into 'Fort Bowie' — no road
  ('d397b765-4148-4df6-b758-27a56ddf5901'::uuid, 'checkoff', null),  -- Find 'Cochise Stronghold' in the Dragoon Mount
  ('f2c29c3b-3dc7-4dbf-9358-770ade99fe50'::uuid, 'checkoff', null),  -- Pull over at 'Willcox Playa Wildlife Area' — a
  ('814f48c1-e01e-450f-b680-81008b89b693'::uuid, 'checkoff', null),  -- Locate the grave of Warren Earp, the youngest 
  ('984d5c12-0492-4a0d-8bff-b9ea1e8288dc'::uuid, 'checkoff', null),  -- Watch the sandhill cranes land at dusk at 'Coc
  ('b07c6c8b-edd3-42c6-9215-1ce8dfd69d00'::uuid, 'checkoff', null),  -- Go to the 'Wings Over Willcox' birding festiva
  ('e4e347d9-2a69-4353-8636-67bfab98c86f'::uuid, 'checkoff', null),  -- Get a coffee from a local spot — not Starbucks
  ('fa52507f-f90e-46f3-9703-e7f4f8f52823'::uuid, 'checkoff', null),  -- Start the day with a Bloody Mary — the drive t
  ('504c8b29-71b3-4aa7-9a9a-2e9ca25146e9'::uuid, 'checkoff', null)  -- Grab a meal at a downtown Willcox local spot —
) as v(item_id, t, n)
join public.items i on i.id = v.item_id
on conflict (destination_id, item_id) do update
  set verification_owner_type = excluded.verification_owner_type,
      verification_owner_name = excluded.verification_owner_name,
      updated_at = now();
