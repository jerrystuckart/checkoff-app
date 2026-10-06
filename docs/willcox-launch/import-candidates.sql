-- Willcox candidate review import (2026-10-06). Writes ONLY to destination_item_candidates and destination_item_decisions.
-- Never touches public.items. Idempotent: candidates are skipped if the same place_name + candidate_type already exists.
begin;
-- 1. Prefill CheckOff recommendations on the 26 LIVE items (does not overwrite Chamber decisions or owners).
insert into public.destination_item_decisions (destination_id, item_id, chamber_membership_status, recommended_decision, recommendation_note, list_recommendation, research_notes, content_status, decided_by, updated_at)
values ('bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, '84b3ad09-120b-46fa-8e5d-b2339bdcb82d'::uuid, 'not_found', 'discuss', $q$Strong tasting-room item. Not in the public Chamber directory. Tastings are by appointment.$q$, $q$Willcox Wine Trail$q$, $q$Appointment-only tastings (OpenTable, noon to 8 daily per 2025 article). Tank 10 Series, Picpoul Blanc/Malvasia Bianca blend. Source: aridus$q$, 'curated', 'checkoff-research-2026-10-06', now())
on conflict (destination_id, item_id) do update set chamber_membership_status = excluded.chamber_membership_status, recommended_decision = excluded.recommended_decision,
  recommendation_note = excluded.recommendation_note, list_recommendation = excluded.list_recommendation, research_notes = excluded.research_notes,
  content_status = coalesce(public.destination_item_decisions.content_status, excluded.content_status), updated_at = now();
insert into public.destination_item_decisions (destination_id, item_id, chamber_membership_status, recommended_decision, recommendation_note, list_recommendation, research_notes, content_status, decided_by, updated_at)
values ('bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, '5d15ae43-f561-492e-b64f-9a136d086558'::uuid, 'member_public_directory', 'include', $q$Chamber member. Current item is the vineyard estate; a downtown tasting-room item is proposed next to it.$q$, $q$Willcox Wine Trail$q$, $q$Vineyard 5000 E Arzberger Rd, Fri-Sat 11-5, Sun 1-5; downtown 100 N Railroad Ave Thu-Sun 12-6. Source: bb$q$, 'curated', 'checkoff-research-2026-10-06', now())
on conflict (destination_id, item_id) do update set chamber_membership_status = excluded.chamber_membership_status, recommended_decision = excluded.recommended_decision,
  recommendation_note = excluded.recommendation_note, list_recommendation = excluded.list_recommendation, research_notes = excluded.research_notes,
  content_status = coalesce(public.destination_item_decisions.content_status, excluded.content_status), updated_at = now();
insert into public.destination_item_decisions (destination_id, item_id, chamber_membership_status, recommended_decision, recommendation_note, list_recommendation, research_notes, content_status, decided_by, updated_at)
values ('bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, '3c706acd-9a4c-49eb-a46b-7503aed0c8a7'::uuid, 'member_public_directory', 'include', $q$Chamber member. Address needs a quick check: City list says 4511 E Robbs Rd, our item says 4718 E Robbs Rd.$q$, $q$Willcox Wine Trail$q$, $q$Address conflict 4511 vs 4718 E Robbs Rd (vw_wine). Two tasting rooms: Willcox and Clarkdale. Source: bodega$q$, 'curated', 'checkoff-research-2026-10-06', now())
on conflict (destination_id, item_id) do update set chamber_membership_status = excluded.chamber_membership_status, recommended_decision = excluded.recommended_decision,
  recommendation_note = excluded.recommendation_note, list_recommendation = excluded.list_recommendation, research_notes = excluded.research_notes,
  content_status = coalesce(public.destination_item_decisions.content_status, excluded.content_status), updated_at = now();
insert into public.destination_item_decisions (destination_id, item_id, chamber_membership_status, recommended_decision, recommendation_note, list_recommendation, research_notes, content_status, decided_by, updated_at)
values ('bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, '21fdc0b2-374f-4cdf-a0b9-02f7444b1825'::uuid, 'not_found', 'discuss', $q$Strong item: tasting room in the 1917 Willcox Bank and Trust building. Not in the public Chamber directory (it is a Willcox Wine Country partner).$q$, $q$Willcox Wine Trail$q$, $q$1917 Willcox Bank and Trust building, est. 2000, 154 N Railroad Ave. Source: pullcork_ks$q$, 'curated', 'checkoff-research-2026-10-06', now())
on conflict (destination_id, item_id) do update set chamber_membership_status = excluded.chamber_membership_status, recommended_decision = excluded.recommended_decision,
  recommendation_note = excluded.recommendation_note, list_recommendation = excluded.list_recommendation, research_notes = excluded.research_notes,
  content_status = coalesce(public.destination_item_decisions.content_status, excluded.content_status), updated_at = now();
insert into public.destination_item_decisions (destination_id, item_id, chamber_membership_status, recommended_decision, recommendation_note, list_recommendation, research_notes, content_status, decided_by, updated_at)
values ('bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'e2f5020d-37c1-4e53-8076-158173b65316'::uuid, 'not_found', 'exclude', $q$Out of date. Birds and Barrels took over the old Flying Leap tasting room (100 N Railroad Ave) in 2021. Recommend retiring this item.$q$, $q$(retire)$q$, $q$Herald Review May 2021: Birds and Barrels opened its downtown room in the old Flying Leap location. Flying Leap is not on visitwillcox wine list. Source: herald_bb, vw_wine$q$, 'not_included', 'checkoff-research-2026-10-06', now())
on conflict (destination_id, item_id) do update set chamber_membership_status = excluded.chamber_membership_status, recommended_decision = excluded.recommended_decision,
  recommendation_note = excluded.recommendation_note, list_recommendation = excluded.list_recommendation, research_notes = excluded.research_notes,
  content_status = coalesce(public.destination_item_decisions.content_status, excluded.content_status), updated_at = now();
insert into public.destination_item_decisions (destination_id, item_id, chamber_membership_status, recommended_decision, recommendation_note, list_recommendation, research_notes, content_status, decided_by, updated_at)
values ('bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, '455ed6c5-ee89-4280-a5ea-2854c8d169e2'::uuid, 'member_public_directory', 'include', $q$Chamber member. Hidden (secret) experience at its downtown tasting room, Suite C of the historic Commercial building.$q$, $q$Willcox Wine Trail; Only in Willcox$q$, $q$Downtown room is 180 N Railroad Ave Suite C (vw_wine). Farm is 6217 Maranatha Way (strive). Secret body claims "oldest continually operating commercial building in Arizona"; sources say oldest mercantile building still in use / oldest store still operating (est. 1881). Verify the claim wording.$q$, 'curated', 'checkoff-research-2026-10-06', now())
on conflict (destination_id, item_id) do update set chamber_membership_status = excluded.chamber_membership_status, recommended_decision = excluded.recommended_decision,
  recommendation_note = excluded.recommendation_note, list_recommendation = excluded.list_recommendation, research_notes = excluded.research_notes,
  content_status = coalesce(public.destination_item_decisions.content_status, excluded.content_status), updated_at = now();
insert into public.destination_item_decisions (destination_id, item_id, chamber_membership_status, recommended_decision, recommendation_note, list_recommendation, research_notes, content_status, decided_by, updated_at)
values ('bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'd07f42cf-59cb-4060-afae-c656e929d545'::uuid, 'not_found', 'discuss', $q$Historic 1881 Norton store building at 180 N Railroad Ave. It also houses three tasting rooms. Keep alongside the Strive hidden item, or fold into one?$q$, $q$Only in Willcox; Outdoor & Historic Willcox$q$, $q$John H. Norton and Company Store, NRHP 1983, est. 1881 (nrhp_store). Tenants include Strive (Suite C), Copper Horse (Suite B), Soaring Wines, Vin-Tage. Not a duplicate of Strive: building history vs tasting.$q$, 'curated', 'checkoff-research-2026-10-06', now())
on conflict (destination_id, item_id) do update set chamber_membership_status = excluded.chamber_membership_status, recommended_decision = excluded.recommended_decision,
  recommendation_note = excluded.recommendation_note, list_recommendation = excluded.list_recommendation, research_notes = excluded.research_notes,
  content_status = coalesce(public.destination_item_decisions.content_status, excluded.content_status), updated_at = now();
insert into public.destination_item_decisions (destination_id, item_id, chamber_membership_status, recommended_decision, recommendation_note, list_recommendation, research_notes, content_status, decided_by, updated_at)
values ('bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'daf77fc6-c446-4999-bfad-75584070ad8f'::uuid, 'not_found', 'discuss', $q$Great hook (1920 Pullman dining car). Not in the public directory. Chamber to confirm membership and pick one signature dish.$q$, $q$Taste of Willcox; Welcome to Willcox$q$, $q$Address 130 E Maley St (vw_dining). Signature dish not documented.$q$, 'curated', 'checkoff-research-2026-10-06', now())
on conflict (destination_id, item_id) do update set chamber_membership_status = excluded.chamber_membership_status, recommended_decision = excluded.recommended_decision,
  recommendation_note = excluded.recommendation_note, list_recommendation = excluded.list_recommendation, research_notes = excluded.research_notes,
  content_status = coalesce(public.destination_item_decisions.content_status, excluded.content_status), updated_at = now();
insert into public.destination_item_decisions (destination_id, item_id, chamber_membership_status, recommended_decision, recommendation_note, list_recommendation, research_notes, content_status, decided_by, updated_at)
values ('bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, '7018a16a-fc6f-4bc6-a3a2-ce8f097fb87c'::uuid, 'not_found', 'discuss', $q$Very short item. Not in the public directory. Needs the food experience confirmed before we rewrite it.$q$, $q$Taste of Willcox$q$, $q$Address 176 S Haskell Ave (vw_dining). No source describes the grill-your-own concept.$q$, 'discoverable', 'checkoff-research-2026-10-06', now())
on conflict (destination_id, item_id) do update set chamber_membership_status = excluded.chamber_membership_status, recommended_decision = excluded.recommended_decision,
  recommendation_note = excluded.recommendation_note, list_recommendation = excluded.list_recommendation, research_notes = excluded.research_notes,
  content_status = coalesce(public.destination_item_decisions.content_status, excluded.content_status), updated_at = now();
insert into public.destination_item_decisions (destination_id, item_id, chamber_membership_status, recommended_decision, recommendation_note, list_recommendation, research_notes, content_status, decided_by, updated_at)
values ('bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, '132a829f-12e3-407b-b619-0ecaba8ad73b'::uuid, 'not_found', 'discuss', $q$Orchard item is live but bare. A fuller rewrite is proposed, plus separate store and corn maze items. Not in the public directory.$q$, $q$Farm Fresh Willcox; Harvest$q$, $q$Orchard 2081 W Hardy Rd; U-pick apples, peaches, pears July-Oct (apple).$q$, 'curated', 'checkoff-research-2026-10-06', now())
on conflict (destination_id, item_id) do update set chamber_membership_status = excluded.chamber_membership_status, recommended_decision = excluded.recommended_decision,
  recommendation_note = excluded.recommendation_note, list_recommendation = excluded.list_recommendation, research_notes = excluded.research_notes,
  content_status = coalesce(public.destination_item_decisions.content_status, excluded.content_status), updated_at = now();
insert into public.destination_item_decisions (destination_id, item_id, chamber_membership_status, recommended_decision, recommendation_note, list_recommendation, research_notes, content_status, decided_by, updated_at)
values ('bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, '8a9759d7-960a-47c2-804f-285e074880b1'::uuid, 'member_public_directory', 'include', $q$Chamber member. Two more specific Rex Allen items are proposed (Monday music jam, the statue).$q$, $q$Only in Willcox; Outdoor & Historic Willcox$q$, $q$150 N Railroad Ave; Mon 10-1 live country jam, Thu-Sat 11-3; $5, under 10 and veterans free (rexallen).$q$, 'curated', 'checkoff-research-2026-10-06', now())
on conflict (destination_id, item_id) do update set chamber_membership_status = excluded.chamber_membership_status, recommended_decision = excluded.recommended_decision,
  recommendation_note = excluded.recommendation_note, list_recommendation = excluded.list_recommendation, research_notes = excluded.research_notes,
  content_status = coalesce(public.destination_item_decisions.content_status, excluded.content_status), updated_at = now();
insert into public.destination_item_decisions (destination_id, item_id, chamber_membership_status, recommended_decision, recommendation_note, list_recommendation, research_notes, content_status, decided_by, updated_at)
values ('bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, '02decd89-e890-406d-901d-d895a7a61b00'::uuid, 'not_applicable_public_experience', 'include', $q$Museum. Membership does not apply.$q$, $q$Outdoor & Historic Willcox$q$, $q$Mon-Sat 10-4 per vw_museums; Chiricahua Apaches from Cochise to Geronimo.$q$, 'curated', 'checkoff-research-2026-10-06', now())
on conflict (destination_id, item_id) do update set chamber_membership_status = excluded.chamber_membership_status, recommended_decision = excluded.recommended_decision,
  recommendation_note = excluded.recommendation_note, list_recommendation = excluded.list_recommendation, research_notes = excluded.research_notes,
  content_status = coalesce(public.destination_item_decisions.content_status, excluded.content_status), updated_at = now();
insert into public.destination_item_decisions (destination_id, item_id, chamber_membership_status, recommended_decision, recommendation_note, list_recommendation, research_notes, content_status, decided_by, updated_at)
values ('bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'd981fbdc-92f4-4d5f-8143-f1b9f25abe17'::uuid, 'not_found', 'discuss', $q$Historic 1936 theater. Not in the public directory; confirm whether it counts as a business or a community venue.$q$, $q$Welcome to Willcox; Outdoor & Historic Willcox$q$, $q$134 N Railroad Ave. Programming cadence unverified.$q$, 'curated', 'checkoff-research-2026-10-06', now())
on conflict (destination_id, item_id) do update set chamber_membership_status = excluded.chamber_membership_status, recommended_decision = excluded.recommended_decision,
  recommendation_note = excluded.recommendation_note, list_recommendation = excluded.list_recommendation, research_notes = excluded.research_notes,
  content_status = coalesce(public.destination_item_decisions.content_status, excluded.content_status), updated_at = now();
insert into public.destination_item_decisions (destination_id, item_id, chamber_membership_status, recommended_decision, recommendation_note, list_recommendation, research_notes, content_status, decided_by, updated_at)
values ('bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'd23154df-54c9-465a-8600-82aef25eda7a'::uuid, 'member_public_directory', 'include', $q$Willcox Wine Country (Chamber member) anchors this one. Three-plus tasting rooms within a block.$q$, $q$Willcox Wine Trail$q$, $q$Willcox Wine Country = Cochise Graham Wine Council dba (dir). 157 N Railroad Ave consortium address (wwc).$q$, 'curated', 'checkoff-research-2026-10-06', now())
on conflict (destination_id, item_id) do update set chamber_membership_status = excluded.chamber_membership_status, recommended_decision = excluded.recommended_decision,
  recommendation_note = excluded.recommendation_note, list_recommendation = excluded.list_recommendation, research_notes = excluded.research_notes,
  content_status = coalesce(public.destination_item_decisions.content_status, excluded.content_status), updated_at = now();
insert into public.destination_item_decisions (destination_id, item_id, chamber_membership_status, recommended_decision, recommendation_note, list_recommendation, research_notes, content_status, decided_by, updated_at)
values ('bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'f590b131-314b-4d69-bffb-e6666b9a01d9'::uuid, 'not_applicable_public_experience', 'include', $q$National Park Service site. Membership does not apply.$q$, $q$Outdoor & Historic Willcox$q$, $q$Free admission, daily 8:30-4:30 (vw_museums).$q$, 'curated', 'checkoff-research-2026-10-06', now())
on conflict (destination_id, item_id) do update set chamber_membership_status = excluded.chamber_membership_status, recommended_decision = excluded.recommended_decision,
  recommendation_note = excluded.recommendation_note, list_recommendation = excluded.list_recommendation, research_notes = excluded.research_notes,
  content_status = coalesce(public.destination_item_decisions.content_status, excluded.content_status), updated_at = now();
insert into public.destination_item_decisions (destination_id, item_id, chamber_membership_status, recommended_decision, recommendation_note, list_recommendation, research_notes, content_status, decided_by, updated_at)
values ('bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'e620f063-7ff1-4414-ba99-12ece149c7e7'::uuid, 'not_applicable_public_experience', 'include', $q$National Park Service site. Membership does not apply.$q$, $q$Outdoor & Historic Willcox$q$, NULL, 'discoverable', 'checkoff-research-2026-10-06', now())
on conflict (destination_id, item_id) do update set chamber_membership_status = excluded.chamber_membership_status, recommended_decision = excluded.recommended_decision,
  recommendation_note = excluded.recommendation_note, list_recommendation = excluded.list_recommendation, research_notes = excluded.research_notes,
  content_status = coalesce(public.destination_item_decisions.content_status, excluded.content_status), updated_at = now();
insert into public.destination_item_decisions (destination_id, item_id, chamber_membership_status, recommended_decision, recommendation_note, list_recommendation, research_notes, content_status, decided_by, updated_at)
values ('bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'c4b020ca-0782-4b00-bf31-759462ab228f'::uuid, 'not_applicable_public_experience', 'include', $q$Inside Chiricahua National Monument. Membership does not apply.$q$, $q$Outdoor & Historic Willcox$q$, NULL, 'discoverable', 'checkoff-research-2026-10-06', now())
on conflict (destination_id, item_id) do update set chamber_membership_status = excluded.chamber_membership_status, recommended_decision = excluded.recommended_decision,
  recommendation_note = excluded.recommendation_note, list_recommendation = excluded.list_recommendation, research_notes = excluded.research_notes,
  content_status = coalesce(public.destination_item_decisions.content_status, excluded.content_status), updated_at = now();
insert into public.destination_item_decisions (destination_id, item_id, chamber_membership_status, recommended_decision, recommendation_note, list_recommendation, research_notes, content_status, decided_by, updated_at)
values ('bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, '29270440-d54a-44fb-b0ad-5c3469f9c487'::uuid, 'not_applicable_public_experience', 'include', $q$National Park Service site. Membership does not apply.$q$, $q$Outdoor & Historic Willcox$q$, $q$Daily 8:30-4:30 (vw_museums).$q$, 'curated', 'checkoff-research-2026-10-06', now())
on conflict (destination_id, item_id) do update set chamber_membership_status = excluded.chamber_membership_status, recommended_decision = excluded.recommended_decision,
  recommendation_note = excluded.recommendation_note, list_recommendation = excluded.list_recommendation, research_notes = excluded.research_notes,
  content_status = coalesce(public.destination_item_decisions.content_status, excluded.content_status), updated_at = now();
insert into public.destination_item_decisions (destination_id, item_id, chamber_membership_status, recommended_decision, recommendation_note, list_recommendation, research_notes, content_status, decided_by, updated_at)
values ('bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'd397b765-4148-4df6-b758-27a56ddf5901'::uuid, 'not_applicable_public_experience', 'include', $q$Coronado National Forest. Membership does not apply.$q$, $q$Outdoor & Historic Willcox$q$, $q$Camping available; Douglas Ranger District (vw_hiking).$q$, 'curated', 'checkoff-research-2026-10-06', now())
on conflict (destination_id, item_id) do update set chamber_membership_status = excluded.chamber_membership_status, recommended_decision = excluded.recommended_decision,
  recommendation_note = excluded.recommendation_note, list_recommendation = excluded.list_recommendation, research_notes = excluded.research_notes,
  content_status = coalesce(public.destination_item_decisions.content_status, excluded.content_status), updated_at = now();
insert into public.destination_item_decisions (destination_id, item_id, chamber_membership_status, recommended_decision, recommendation_note, list_recommendation, research_notes, content_status, decided_by, updated_at)
values ('bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'f2c29c3b-3dc7-4dbf-9358-770ade99fe50'::uuid, 'not_applicable_public_experience', 'include', $q$Public wildlife area. Membership does not apply. Best October to February for sandhill cranes.$q$, $q$Outdoor & Historic Willcox; Crane Season$q$, $q$Willcox Playa: 20,000+ sandhill cranes Oct-Feb (vw_birding). BLM National Natural Landmark.$q$, 'curated', 'checkoff-research-2026-10-06', now())
on conflict (destination_id, item_id) do update set chamber_membership_status = excluded.chamber_membership_status, recommended_decision = excluded.recommended_decision,
  recommendation_note = excluded.recommendation_note, list_recommendation = excluded.list_recommendation, research_notes = excluded.research_notes,
  content_status = coalesce(public.destination_item_decisions.content_status, excluded.content_status), updated_at = now();
insert into public.destination_item_decisions (destination_id, item_id, chamber_membership_status, recommended_decision, recommendation_note, list_recommendation, research_notes, content_status, decided_by, updated_at)
values ('bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, '984d5c12-0492-4a0d-8bff-b9ea1e8288dc'::uuid, 'not_applicable_public_experience', 'include', $q$Crane season item, off until winter. Cochise Lakes are different from the Playa and from Twin Lakes.$q$, $q$Crane Season$q$, $q$Cochise Lakes (aka Lake Cochise) are town effluent ponds at the north edge of the Playa, separate from Crane Lake in the Wildlife Area and from Twin Lakes (cochise_lakes). Reactivate Oct-Feb after access check.$q$, 'seasonal', 'checkoff-research-2026-10-06', now())
on conflict (destination_id, item_id) do update set chamber_membership_status = excluded.chamber_membership_status, recommended_decision = excluded.recommended_decision,
  recommendation_note = excluded.recommendation_note, list_recommendation = excluded.list_recommendation, research_notes = excluded.research_notes,
  content_status = coalesce(public.destination_item_decisions.content_status, excluded.content_status), updated_at = now();
insert into public.destination_item_decisions (destination_id, item_id, chamber_membership_status, recommended_decision, recommendation_note, list_recommendation, research_notes, content_status, decided_by, updated_at)
values ('bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'b07c6c8b-edd3-42c6-9215-1ce8dfd69d00'::uuid, 'member_public_directory', 'include', $q$Chamber member (listed in the directory). January event. Off until winter.$q$, $q$Crane Season; Wings Over Willcox$q$, $q$Annual January, MLK weekend; started by AZ Game and Fish and the Chamber. Verify 2027 dates before reactivating.$q$, 'seasonal', 'checkoff-research-2026-10-06', now())
on conflict (destination_id, item_id) do update set chamber_membership_status = excluded.chamber_membership_status, recommended_decision = excluded.recommended_decision,
  recommendation_note = excluded.recommendation_note, list_recommendation = excluded.list_recommendation, research_notes = excluded.research_notes,
  content_status = coalesce(public.destination_item_decisions.content_status, excluded.content_status), updated_at = now();
insert into public.destination_item_decisions (destination_id, item_id, chamber_membership_status, recommended_decision, recommendation_note, list_recommendation, research_notes, content_status, decided_by, updated_at)
values ('bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, '814f48c1-e01e-450f-b680-81008b89b693'::uuid, 'not_applicable_public_experience', 'include', $q$Pioneer Cemetery (454 N 3rd Ave). Public history. Membership does not apply. Who maintains it is unconfirmed.$q$, $q$Outdoor & Historic Willcox$q$, $q$Same place as the "Pioneer Cemetery" row in the workbook: Warren Earp is buried at the back (cemetery). City list gives 370 N Sunset Strip, other sources 454 N 3rd Ave: confirm.$q$, 'curated', 'checkoff-research-2026-10-06', now())
on conflict (destination_id, item_id) do update set chamber_membership_status = excluded.chamber_membership_status, recommended_decision = excluded.recommended_decision,
  recommendation_note = excluded.recommendation_note, list_recommendation = excluded.list_recommendation, research_notes = excluded.research_notes,
  content_status = coalesce(public.destination_item_decisions.content_status, excluded.content_status), updated_at = now();
insert into public.destination_item_decisions (destination_id, item_id, chamber_membership_status, recommended_decision, recommendation_note, list_recommendation, research_notes, content_status, decided_by, updated_at)
values ('bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'e4e347d9-2a69-4353-8636-67bfab98c86f'::uuid, 'not_applicable_public_experience', 'exclude', $q$Generic road-trip prompt with no place. Recommend replacing it with the specific coffee items below.$q$, $q$(retire from Hub list)$q$, $q$Replace with Dos Cabezas Coffee Company / Desert Brew items.$q$, 'not_included', 'checkoff-research-2026-10-06', now())
on conflict (destination_id, item_id) do update set chamber_membership_status = excluded.chamber_membership_status, recommended_decision = excluded.recommended_decision,
  recommendation_note = excluded.recommendation_note, list_recommendation = excluded.list_recommendation, research_notes = excluded.research_notes,
  content_status = coalesce(public.destination_item_decisions.content_status, excluded.content_status), updated_at = now();
insert into public.destination_item_decisions (destination_id, item_id, chamber_membership_status, recommended_decision, recommendation_note, list_recommendation, research_notes, content_status, decided_by, updated_at)
values ('bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'fa52507f-f90e-46f3-9703-e7f4f8f52823'::uuid, 'not_applicable_public_experience', 'exclude', $q$Generic road-trip prompt with no place. Recommend retiring it from the Hub list.$q$, $q$(retire from Hub list)$q$, NULL, 'not_included', 'checkoff-research-2026-10-06', now())
on conflict (destination_id, item_id) do update set chamber_membership_status = excluded.chamber_membership_status, recommended_decision = excluded.recommended_decision,
  recommendation_note = excluded.recommendation_note, list_recommendation = excluded.list_recommendation, research_notes = excluded.research_notes,
  content_status = coalesce(public.destination_item_decisions.content_status, excluded.content_status), updated_at = now();
insert into public.destination_item_decisions (destination_id, item_id, chamber_membership_status, recommended_decision, recommendation_note, list_recommendation, research_notes, content_status, decided_by, updated_at)
values ('bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, '504c8b29-71b3-4aa7-9a9a-2e9ca25146e9'::uuid, 'not_applicable_public_experience', 'exclude', $q$Generic downtown meal prompt. Its map address resolves to Isabel's South of the Border (115 S Haskell Ave). Replace with named restaurants.$q$, $q$(retire)$q$, $q$Geocoder artifact: maps_query "Downtown Willcox AZ restaurants" returned 115 S Haskell = Isabel's (vw_dining). Do not treat as Isabel's item.$q$, 'not_included', 'checkoff-research-2026-10-06', now())
on conflict (destination_id, item_id) do update set chamber_membership_status = excluded.chamber_membership_status, recommended_decision = excluded.recommended_decision,
  recommendation_note = excluded.recommendation_note, list_recommendation = excluded.list_recommendation, research_notes = excluded.research_notes,
  content_status = coalesce(public.destination_item_decisions.content_status, excluded.content_status), updated_at = now();
-- 2. Candidates.
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'rewrite', $q$Apple Annie's$q$, $q$Apple Annie's Orchard$q$, $q$Pick your own tree-ripened apples, peaches and pears at 'Apple Annie's Orchard' between July and October.$q$, (select id from public.categories where name = $q$Play$q$), 'production_pilot', '132a829f-12e3-407b-b619-0ecaba8ad73b'::uuid,
  'not_found', 'discuss', $q$Rewrite of the live item with the actual picking season.$q$, 'curated', 'business', NULL,
  'researched', $q$Farm Fresh Willcox; Harvest$q$, $q$Orchard hours 8-5 July-Aug, 9-5 Sept-Oct (apple). Cherries mentioned on site but season unclear: left out.$q$, $j$[{"url": "https://appleannies.com/", "checked": "2026-10-06"}]$j$::jsonb, $q$Confirm current fruit windows.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Apple Annie's Orchard$q$ and x.candidate_type = 'rewrite');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'rewrite', $q$Warren Earp grave$q$, $q$Willcox Pioneer Cemetery$q$, $q$Find Warren Earp's tall dark metal gravestone at the back of the 'Willcox Pioneer Cemetery'.$q$, (select id from public.categories where name = $q$Adventure$q$), 'production_pilot', '814f48c1-e01e-450f-b680-81008b89b693'::uuid,
  'not_applicable_public_experience', 'include', $q$Rewrite of the live item to name the cemetery and give the visitor something to look for.$q$, 'curated', 'checkoff', NULL,
  'needs_verification', $q$Outdoor & Historic Willcox$q$, $q$Roadside America describes a tall dark metal tombstone on concrete at the back of the cemetery. Wild-West-themed marker placed long after 1900.$q$, $j$[{"url": "https://www.roadsideamerica.com/tip/74215", "checked": "2026-10-06"}, {"url": "https://visitwillcox.az.gov/museums", "checked": "2026-10-06"}]$j$::jsonb, $q$Confirm cemetery address (454 N 3rd Ave vs 370 N Sunset Strip) and who maintains it.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Willcox Pioneer Cemetery$q$ and x.candidate_type = 'rewrite');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'rewrite', $q$Flying Leap$q$, $q$Birds and Barrels Vineyards downtown room$q$, $q$Taste small-batch Willcox AVA wine at the 'Birds and Barrels Vineyards' Railroad Avenue tasting room, then ask about adopting a vine.$q$, (select id from public.categories where name = $q$Bar & drinks$q$), 'production_pilot', 'e2f5020d-37c1-4e53-8076-158173b65316'::uuid,
  'member_public_directory', 'include', $q$Replaces the out-of-date Flying Leap item. Same address (100 N Railroad Ave).$q$, 'curated', 'business', NULL,
  'researched', $q$Willcox Wine Trail; Welcome to Willcox$q$, $q$Downtown room Thu-Sun 12-6; Adopt a Vine program; family owned since 2015 (bb). Took over the old Flying Leap room, May 2021 (herald_bb).$q$, $j$[{"url": "https://birdsandbarrels.com/", "checked": "2026-10-06"}, {"url": "https://www.myheraldreview.com/news/willcox/birds-and-barrels-celebrates-new-tasting-room/article_03018ab8-ad23-11eb-b45c-67c6a2400362.html", "checked": "2026-10-06"}]$j$::jsonb, $q$Confirm hours and the Adopt a Vine wording.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Birds and Barrels Vineyards downtown room$q$ and x.candidate_type = 'rewrite');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Golden Rule Vineyards$q$, $q$Golden Rule Vineyards$q$, $q$Pour a tasting at the 'Golden Rule Vineyards' downtown room, then ask about the vineyard tasting by appointment in Cochise.$q$, (select id from public.categories where name = $q$Bar & drinks$q$), 'chamber_workbook_2026-09-01', NULL,
  'member_public_directory', 'include', $q$Chamber member. Address now confirmed from the winery's own site.$q$, 'discoverable', 'business', NULL,
  'researched', $q$Willcox Wine Trail$q$, $q$Own site: 469 S Haskell Ave Wed-Sat 10-5; vineyard 3525 N Golden Rule Rd, Cochise, by appointment. City list says 469 S Haskell; other sources say 180 N Railroad Ave (shared building). Resolved by the winery's own site.$q$, $j$[{"url": "https://www.goldenrulevineyards.com/", "checked": "2026-10-06"}, {"url": "https://visitwillcox.az.gov/wine-tasting", "checked": "2026-10-06"}, {"url": "https://www.willcoxchamberofcommerce.com/ (Chamber Member Directory section on the home page)", "checked": "2026-10-06"}]$j$::jsonb, $q$Confirm current hours; confirm whether it also pours at 180 N Railroad.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Golden Rule Vineyards$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Copper Horse Vineyard$q$, $q$Copper Horse Vineyard$q$, $q$Sample Copper Horse wines inside the historic Willcox Commercial building at 'Copper Horse Vineyard'.$q$, (select id from public.categories where name = $q$Bar & drinks$q$), 'directory_gap_research', NULL,
  'not_found', 'discuss', $q$Tasting room in the same historic building as Strive (Suite B). Not in the public Chamber directory.$q$, 'discoverable', 'business', NULL,
  'needs_verification', $q$Willcox Wine Trail$q$, $q$180 N Railroad Ave Suite B (vw_wine); shares building with Strive and Soaring (pullthatcork).$q$, $j$[{"url": "https://visitwillcox.az.gov/wine-tasting", "checked": "2026-10-06"}]$j$::jsonb, $q$Hours, signature wine, membership.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Copper Horse Vineyard$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Soaring Wines$q$, $q$Soaring Wines$q$, $q$Sip 'Soaring Wines' in the historic Commercial building on Railroad Avenue.$q$, (select id from public.categories where name = $q$Bar & drinks$q$), 'directory_gap_research', NULL,
  'not_found', 'discuss', $q$Willcox Wine Country partner at 180 N Railroad Ave. Not in the public Chamber directory.$q$, 'discoverable', 'business', NULL,
  'needs_verification', $q$Willcox Wine Trail$q$, $q$180 N Railroad Ave (vw_wine); listed as Willcox Wine Country partner (wwc).$q$, $j$[{"url": "https://visitwillcox.az.gov/wine-tasting", "checked": "2026-10-06"}, {"url": "https://willcoxwinecountry.org/", "checked": "2026-10-06"}]$j$::jsonb, $q$Hours, signature wine, membership.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Soaring Wines$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Pillsbury Wine Company$q$, $q$Pillsbury Wine Company$q$, $q$Drive out to 'Pillsbury Wine Company' on South Bennett Place and taste estate wine in the vineyard.$q$, (select id from public.categories where name = $q$Bar & drinks$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_found', 'discuss', $q$Vineyard tasting room near Rhumb Line (6450 S Bennett Pl). Not in the public directory.$q$, 'discoverable', 'business', NULL,
  'needs_verification', $q$Willcox Wine Trail$q$, $q$6450 S Bennett Pl (vw_wine). No source gives hours or signature wine.$q$, $j$[{"url": "https://visitwillcox.az.gov/wine-tasting", "checked": "2026-10-06"}]$j$::jsonb, $q$Hours, signature wine, membership, visitor access.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Pillsbury Wine Company$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Carlson Creek Vineyard$q$, $q$Carlson Creek Vineyard$q$, $q$Sip high-elevation estate wine at 'Carlson Creek Vineyard' on Robbs Road.$q$, (select id from public.categories where name = $q$Bar & drinks$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_found', 'discuss', $q$Willcox Wine Country partner. Address sources disagree, so it needs a quick check. (Our earlier database match was a Scottsdale item, not Willcox.)$q$, 'discoverable', 'business', NULL,
  'needs_verification', $q$Willcox Wine Trail$q$, $q$Robbs Rd address varies: 4574 (vw_wine), 4660 (carlson 2017). Older Railview Ave tasting room. Production's only Carlson item is Old Town Scottsdale, not a match.$q$, $j$[{"url": "https://visitwillcox.az.gov/wine-tasting", "checked": "2026-10-06"}, {"url": "https://tucsonfoodie.com/2017/12/15/carlson-creek-vineyard-groundbreaking/", "checked": "2026-10-06"}, {"url": "https://willcoxwinecountry.org/", "checked": "2026-10-06"}]$j$::jsonb, $q$Current address, hours, visitor access, membership.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Carlson Creek Vineyard$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Willcox Wine Country$q$, $q$Willcox Wine Festival (fall)$q$, $q$Taste your way through the Willcox Wine Festival at 'Railroad Park' on its October weekend.$q$, (select id from public.categories where name = $q$Social$q$), 'directory_gap_research', NULL,
  'member_public_directory', 'include', $q$Chamber member (Willcox Wine Country). Oct 17 and 18, 11 AM to 5 PM, Railroad Park. Seasonal.$q$, 'seasonal', 'destination_partner', $q$Willcox Wine Country$q$,
  'researched', $q$Wine Festival; Willcox Wine Trail$q$, $q$Fall 2026: Oct 17-18, Railroad Park, 11-5 (wwc). Spring festival in April (vw_events).$q$, $j$[{"url": "https://willcoxwinecountry.org/", "checked": "2026-10-06"}, {"url": "https://visitwillcox.az.gov/events", "checked": "2026-10-06"}]$j$::jsonb, $q$Confirm ticket/entry wording.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Willcox Wine Festival (fall)$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Willcox Wine Country$q$, $q$Willcox Wine Festival (spring)$q$, $q$Celebrate spring at the Willcox Wine Festival in 'Railroad Park'.$q$, (select id from public.categories where name = $q$Social$q$), 'directory_gap_research', NULL,
  'member_public_directory', 'include', $q$Chamber member (Willcox Wine Country). April festival. Seasonal.$q$, 'seasonal', 'destination_partner', $q$Willcox Wine Country$q$,
  'needs_verification', $q$Spring Wine Weekend$q$, $q$April per vw_events. 2027 dates unknown.$q$, $j$[{"url": "https://visitwillcox.az.gov/events", "checked": "2026-10-06"}]$j$::jsonb, $q$2027 dates and venue.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Willcox Wine Festival (spring)$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Zarpara Vineyards$q$, $q$Zarpara Vineyards$q$, NULL, (select id from public.categories where name = $q$Bar & drinks$q$), 'directory_gap_research', NULL,
  'not_found', 'discuss', $q$Research backlog. Listed by the City; no hours or specifics found.$q$, 'reserve', 'business', NULL,
  'needs_research', $q$Willcox Wine Trail$q$, $q$6777 S Zarpara Ln (vw_wine).$q$, $j$[{"url": "https://visitwillcox.az.gov/wine-tasting", "checked": "2026-10-06"}]$j$::jsonb, $q$Everything.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Zarpara Vineyards$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Laramita Cellars$q$, $q$Laramita Cellars$q$, NULL, (select id from public.categories where name = $q$Bar & drinks$q$), 'directory_gap_research', NULL,
  'not_found', 'discuss', $q$Research backlog. Listed by the City; no hours or specifics found.$q$, 'reserve', 'business', NULL,
  'needs_research', $q$Willcox Wine Trail$q$, $q$6223 E Cattle Dr (vw_wine).$q$, $j$[{"url": "https://visitwillcox.az.gov/wine-tasting", "checked": "2026-10-06"}]$j$::jsonb, $q$Everything.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Laramita Cellars$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Passion Cellars$q$, $q$Passion Cellars$q$, NULL, (select id from public.categories where name = $q$Bar & drinks$q$), 'directory_gap_research', NULL,
  'not_found', 'discuss', $q$Research backlog. Listed by the City; no hours or specifics found.$q$, 'reserve', 'business', NULL,
  'needs_research', $q$Willcox Wine Trail$q$, $q$3052 N Fort Grant Rd (vw_wine).$q$, $j$[{"url": "https://visitwillcox.az.gov/wine-tasting", "checked": "2026-10-06"}]$j$::jsonb, $q$Everything.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Passion Cellars$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$1764 Vineyards$q$, $q$1764 Vineyards (Pearce)$q$, NULL, (select id from public.categories where name = $q$Bar & drinks$q$), 'directory_gap_research', NULL,
  'not_found', 'discuss', $q$Pearce area, outside Willcox town. Willcox Wine Country partner. Research backlog.$q$, 'reserve', 'business', NULL,
  'needs_research', $q$Willcox Wine Trail$q$, $q$357 W Treasure Rd, Pearce (vw_wine); Seventeen Sixty-Four Vineyards is a Wine Country partner (wwc).$q$, $j$[{"url": "https://visitwillcox.az.gov/wine-tasting", "checked": "2026-10-06"}, {"url": "https://willcoxwinecountry.org/", "checked": "2026-10-06"}]$j$::jsonb, $q$Distance and visitor fit.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$1764 Vineyards (Pearce)$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Four Tails Vineyards$q$, $q$Four Tails Vineyards (Pearce)$q$, NULL, (select id from public.categories where name = $q$Bar & drinks$q$), 'directory_gap_research', NULL,
  'not_found', 'discuss', $q$Pearce area, outside Willcox town. Research backlog.$q$, 'reserve', 'business', NULL,
  'needs_research', $q$Willcox Wine Trail$q$, $q$274 E Pearce Rd (vw_wine).$q$, $j$[{"url": "https://visitwillcox.az.gov/wine-tasting", "checked": "2026-10-06"}]$j$::jsonb, $q$Distance and visitor fit.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Four Tails Vineyards (Pearce)$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Sandor Vineyards$q$, $q$Sandor Vineyards (Pearce)$q$, NULL, (select id from public.categories where name = $q$Bar & drinks$q$), 'directory_gap_research', NULL,
  'not_found', 'discuss', $q$Pearce area, outside Willcox town. Research backlog.$q$, 'reserve', 'business', NULL,
  'needs_research', $q$Willcox Wine Trail$q$, $q$13097 AZ-181, Pearce (vw_wine).$q$, $j$[{"url": "https://visitwillcox.az.gov/wine-tasting", "checked": "2026-10-06"}]$j$::jsonb, $q$Distance and visitor fit.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Sandor Vineyards (Pearce)$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Tortilleria La Unica$q$, $q$Tortilleria La Unica$q$, $q$Crunch through handmade chips with a margarita at 'Tortilleria La Unica', then take fresh tortillas home.$q$, (select id from public.categories where name = $q$Food & drink$q$), 'chamber_workbook_2026-09-01', NULL,
  'member_public_directory', 'include', $q$Chamber member. Restaurant and tortilleria at 142 N Haskell Ave.$q$, 'curated', 'business', NULL,
  'researched', $q$Taste of Willcox; Welcome to Willcox$q$, $q$Handmade tortillas and chips; margaritas; outdoor area (unica). Chamber listing phone 520-384-0010 matches. Own website says 'coming soon'.$q$, $j$[{"url": "https://wanderlog.com/place/details/2252468/la-unica-restaurant--tortilleria", "checked": "2026-10-06"}, {"url": "https://visitwillcox.az.gov/dining", "checked": "2026-10-06"}, {"url": "https://www.willcoxchamberofcommerce.com/ (Chamber Member Directory section on the home page)", "checked": "2026-10-06"}]$j$::jsonb, $q$Confirm they sell tortillas by the bag.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Tortilleria La Unica$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$R&R Pizza Express$q$, $q$R&R Pizza Express$q$, $q$Work the all-you-can-eat pizza buffet at 'R&R Pizza Express', or grab wings and breadsticks from the drive-thru.$q$, (select id from public.categories where name = $q$Food & drink$q$), 'chamber_workbook_2026-09-01', NULL,
  'member_public_directory', 'include', $q$Chamber member. Opened in 2023 by Sean and Cindy Chaffey.$q$, 'discoverable', 'business', NULL,
  'researched', $q$Taste of Willcox$q$, $q$684 N Bisbee Ave, Mon-Sat 11-8; buffet, drive-thru, delivery (rr).$q$, $j$[{"url": "https://www.rrpizza-willcox.com/", "checked": "2026-10-06"}, {"url": "https://www.willcoxchamberofcommerce.com/ (Chamber Member Directory section on the home page)", "checked": "2026-10-06"}]$j$::jsonb, $q$Confirm buffet days and hours.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$R&R Pizza Express$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Isabel's South of the Border$q$, $q$Isabel's South of the Border$q$, $q$Ask for the fire-roasted salsa with dinner at 'Isabel's South of the Border'.$q$, (select id from public.categories where name = $q$Food & drink$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_found', 'discuss', $q$Downtown restaurant at 115 S Haskell Ave. Not in the public directory. Salsa detail came from our earlier research and still needs confirming.$q$, 'curated', 'business', NULL,
  'needs_verification', $q$Taste of Willcox$q$, $q$115 S Haskell Ave (vw_dining). Salsa claim not independently confirmed.$q$, $j$[{"url": "https://visitwillcox.az.gov/dining", "checked": "2026-10-06"}]$j$::jsonb, $q$Signature dish; membership.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Isabel's South of the Border$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Double S Steakhouse$q$, $q$Double S Steakhouse$q$, $q$Settle into a steak dinner at 'Double S Steakhouse' after a day among the vineyards.$q$, (select id from public.categories where name = $q$Food & drink$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_found', 'discuss', $q$1201 W Rex Allen Dr. Not in the public directory. Needs a signature dish.$q$, 'discoverable', 'business', NULL,
  'needs_verification', $q$Taste of Willcox$q$, $q$vw_dining. No signature item found.$q$, $j$[{"url": "https://visitwillcox.az.gov/dining", "checked": "2026-10-06"}]$j$::jsonb, $q$Signature steak/dish; membership.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Double S Steakhouse$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Desert Brew$q$, $q$Desert Brew$q$, $q$Sip a horchata frappe at 'Desert Brew' on North Haskell.$q$, (select id from public.categories where name = $q$Food & drink$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_found', 'discuss', $q$Coffee stop at 622 N Haskell Ave. Not in the public directory. Drink detail from earlier research, not yet confirmed.$q$, 'discoverable', 'business', NULL,
  'needs_verification', $q$Taste of Willcox$q$, $q$vw_dining. Horchata frappe from workbook only.$q$, $j$[{"url": "https://visitwillcox.az.gov/dining", "checked": "2026-10-06"}]$j$::jsonb, $q$Signature drink; membership.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Desert Brew$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Dos Cabezas Coffee Company$q$, $q$Dos Cabezas Coffee Company$q$, $q$Start the morning with a cup at 'Dos Cabezas Coffee Company' on South Haskell.$q$, (select id from public.categories where name = $q$Food & drink$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_found', 'discuss', $q$Coffee stop at 308 S Haskell Ave. Not in the public directory. 'Locally roasted' claim not confirmed.$q$, 'discoverable', 'business', NULL,
  'needs_verification', $q$Taste of Willcox$q$, $q$vw_dining; doscabezascoffeeco.com not read.$q$, $j$[{"url": "https://visitwillcox.az.gov/dining", "checked": "2026-10-06"}]$j$::jsonb, $q$Roasting claim; hours; membership.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Dos Cabezas Coffee Company$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Evermore Coffee$q$, $q$Evermore Coffee$q$, NULL, (select id from public.categories where name = $q$Food & drink$q$), 'directory_gap_research', NULL,
  'member_public_directory', 'discuss', $q$Chamber member with no public address or website found. Needs a quick look.$q$, 'reserve', 'business', NULL,
  'needs_research', $q$Taste of Willcox$q$, $q$Directory links to a Facebook group page only (dir). No other source found.$q$, $j$[{"url": "https://www.willcoxchamberofcommerce.com/ (Chamber Member Directory section on the home page)", "checked": "2026-10-06"}]$j$::jsonb, $q$Where is it, is it open to visitors.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Evermore Coffee$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Adolfo's Taco Shop$q$, $q$Adolfo's Taco Shop$q$, $q$Choose between carne asada tacos and a breakfast burrito at 'Adolfo's Taco Shop'.$q$, (select id from public.categories where name = $q$Food & drink$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_found', 'discuss', $q$910 W Rex Allen Dr. Not in the public directory. Menu detail from earlier research.$q$, 'discoverable', 'business', NULL,
  'needs_verification', $q$Taste of Willcox$q$, $q$vw_dining. Menu detail from workbook only.$q$, $j$[{"url": "https://visitwillcox.az.gov/dining", "checked": "2026-10-06"}]$j$::jsonb, $q$Signature order; membership.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Adolfo's Taco Shop$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Katy's Rico Hot Dogs$q$, $q$Katy's Rico Hot Dogs$q$, $q$Grab a hot dog from the roadside stand at 'Katy's Rico Hot Dogs' on North Haskell.$q$, (select id from public.categories where name = $q$Food & drink$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_found', 'discuss', $q$Roadside stand across from the bank. Not in the public directory. Schedule unconfirmed.$q$, 'reserve', 'business', NULL,
  'needs_verification', $q$Taste of Willcox$q$, $q$vw_dining: N Haskell across from PNC Bank.$q$, $j$[{"url": "https://visitwillcox.az.gov/dining", "checked": "2026-10-06"}]$j$::jsonb, $q$Schedule; membership.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Katy's Rico Hot Dogs$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Peter's Mexican Food$q$, $q$Peter's Mexican Food$q$, $q$Try a local Mexican favorite at 'Peter's Mexican Food' on South Haskell.$q$, (select id from public.categories where name = $q$Food & drink$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_found', 'discuss', $q$119 S Haskell Ave. Not in the public directory. No signature dish found.$q$, 'reserve', 'business', NULL,
  'needs_verification', $q$Taste of Willcox$q$, $q$vw_dining (Yelp link only).$q$, $j$[{"url": "https://visitwillcox.az.gov/dining", "checked": "2026-10-06"}]$j$::jsonb, $q$Signature dish; membership.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Peter's Mexican Food$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Antojitos El Cholo Food Truck$q$, $q$Antojitos El Cholo Food Truck$q$, $q$Eat a made-to-order street-food favorite at 'Antojitos El Cholo Food Truck'.$q$, (select id from public.categories where name = $q$Food & drink$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_found', 'discuss', $q$Food truck at 1190 W Rex Allen Dr. Not in the public directory. Schedule unconfirmed.$q$, 'reserve', 'business', NULL,
  'needs_verification', $q$Taste of Willcox$q$, $q$vw_dining.$q$, $j$[{"url": "https://visitwillcox.az.gov/dining", "checked": "2026-10-06"}]$j$::jsonb, $q$Schedule; signature item; membership.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Antojitos El Cholo Food Truck$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Mack's Bar$q$, $q$Mack's Bar$q$, $q$Have a drink at 'Mack's Bar', a downtown local bar on East Maley Street.$q$, (select id from public.categories where name = $q$Bar & drinks$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_found', 'discuss', $q$116 E Maley St. Not in the public directory.$q$, 'reserve', 'business', NULL,
  'needs_verification', $q$Taste of Willcox$q$, $q$vw_dining.$q$, $j$[{"url": "https://visitwillcox.az.gov/dining", "checked": "2026-10-06"}]$j$::jsonb, $q$Hours; signature order; membership.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Mack's Bar$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Willcox/Cochise KOA$q$, $q$Roadrunner Kafe at the KOA$q$, $q$Dig into prickly pear and cream cheese stuffed French toast at 'Roadrunner Kafe' inside the Willcox/Cochise KOA.$q$, (select id from public.categories where name = $q$Food & drink$q$), 'directory_gap_research', NULL,
  'member_public_directory', 'include', $q$Chamber member. The campground cafe is open to the public.$q$, 'discoverable', 'business', NULL,
  'researched', $q$Taste of Willcox$q$, $q$700 N Virginia Ave; stuffed French toast (prickly pear and cream cheese, maple pecan), pecan cinnamon rolls (koa). City list gives the cafe as KOA's Roadrunner Kafe.$q$, $j$[{"url": "https://koa.com/campgrounds/willcox/blog/eight-of-the-best-places-to-eat-near-willcox-az_d2091879-ba3f-4322-9da0-f08c859f2206/", "checked": "2026-10-06"}, {"url": "https://visitwillcox.az.gov/dining", "checked": "2026-10-06"}, {"url": "https://www.willcoxchamberofcommerce.com/ (Chamber Member Directory section on the home page)", "checked": "2026-10-06"}]$j$::jsonb, $q$Hours.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Roadrunner Kafe at the KOA$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Tirrito Farm$q$, $q$Tirrito Farm tour$q$, $q$Book a farm tour at 'Tirrito Farm' and see the dairy, vineyard and brewery behind its restaurant.$q$, (select id from public.categories where name = $q$Play$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_found', 'discuss', $q$Strongest agritourism item in the set. Not in the public directory.$q$, 'curated', 'business', NULL,
  'researched', $q$Farm Fresh Willcox; Only in Willcox$q$, $q$Tock farm tour; dairy, vineyard (Pinot Grigio, Sangiovese, Barbera), microbrewery and restaurant (2022), cheeses (tirrito_press, tirrito).$q$, $j$[{"url": "https://tirritofarm.com/", "checked": "2026-10-06"}, {"url": "https://tucsonfoodie.com/2024/07/12/tirrito-farm/", "checked": "2026-10-06"}, {"url": "https://visitwillcox.az.gov/dining", "checked": "2026-10-06"}]$j$::jsonb, $q$Tour days and booking; membership.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Tirrito Farm tour$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Tirrito Farm$q$, $q$Tirrito Farm taproom$q$, $q$Order a beer flight in the 'Tirrito Farm' taproom, brewed on the same farm that grows its grapes.$q$, (select id from public.categories where name = $q$Bar & drinks$q$), 'directory_gap_research', NULL,
  'not_found', 'discuss', $q$House-brewed beers, flights and live music.$q$, 'curated', 'business', NULL,
  'researched', $q$Taste of Willcox; Farm Fresh Willcox$q$, $q$Taproom: house-brewed craft beer, seasonal releases, flights, live music (tirrito).$q$, $j$[{"url": "https://tirritofarm.com/", "checked": "2026-10-06"}]$j$::jsonb, $q$Hours; membership.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Tirrito Farm taproom$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Tirrito Farm$q$, $q$Tirrito Farm: The Kitchen$q$, $q$Eat the seasonal farm-to-table menu at 'The Kitchen' at Tirrito Farm.$q$, (select id from public.categories where name = $q$Food & drink$q$), 'directory_gap_research', NULL,
  'not_found', 'discuss', $q$Farm restaurant. No dish named on the site yet.$q$, 'discoverable', 'business', NULL,
  'needs_verification', $q$Taste of Willcox$q$, $q$Seasonal menus, estate wines (tirrito).$q$, $j$[{"url": "https://tirritofarm.com/", "checked": "2026-10-06"}]$j$::jsonb, $q$A signature dish; hours.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Tirrito Farm: The Kitchen$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Tirrito Farm$q$, $q$Tirrito Farm glamping domes$q$, $q$Sleep in a glamping dome at 'Tirrito Farm' with views of the Pinaleno and Chiricahua mountains.$q$, (select id from public.categories where name = $q$Travel$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_found', 'discuss', $q$Opened 2024. Lodging. Chamber to decide whether lodging is a checkable item.$q$, 'reserve', 'business', NULL,
  'researched', $q$Farm Fresh Willcox$q$, $q$Domes added 2024; heating, A/C, king bed, heated bath floor (tirrito_press).$q$, $j$[{"url": "https://tucsonfoodie.com/2024/07/12/tirrito-farm/", "checked": "2026-10-06"}]$j$::jsonb, $q$Booking details.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Tirrito Farm glamping domes$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Apple Annie's$q$, $q$Apple Annie's Country Store$q$, $q$Pick up a fresh-baked pie and a bag of handmade fudge at 'Apple Annie's Country Store'.$q$, (select id from public.categories where name = $q$Food & drink$q$), 'directory_gap_research', NULL,
  'not_found', 'discuss', $q$Open daily 9 to 5 at 1510 N Circle I Rd. Different location from the orchard.$q$, 'discoverable', 'business', NULL,
  'researched', $q$Farm Fresh Willcox; Taste of Willcox$q$, $q$Fresh-baked pies and apple bread, fudge, jams, lunch Mon-Fri (apple).$q$, $j$[{"url": "https://appleannies.com/", "checked": "2026-10-06"}, {"url": "https://visitwillcox.az.gov/dining", "checked": "2026-10-06"}]$j$::jsonb, $q$Membership.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Apple Annie's Country Store$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Apple Annie's$q$, $q$Apple Annie's Corn Maze & Pumpkin Patch$q$, $q$Find your way out of the corn maze, then pick a pumpkin at 'Apple Annie's Corn Maze & Pumpkin Patch'.$q$, (select id from public.categories where name = $q$Play$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_found', 'discuss', $q$Separate location from the orchard (6405 W Williams Rd). Fall season.$q$, 'seasonal', 'business', NULL,
  'researched', $q$Harvest; Summer / Family$q$, $q$Corn maze billed as Southern Arizona's largest, hayrides, sunflower fields, u-pick vegetables; July-Oct (apple).$q$, $j$[{"url": "https://appleannies.com/", "checked": "2026-10-06"}, {"url": "https://visitwillcox.az.gov/attractions-1", "checked": "2026-10-06"}]$j$::jsonb, $q$Confirm season dates.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Apple Annie's Corn Maze & Pumpkin Patch$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Lee's Pecans$q$, $q$Lee's Pecans$q$, $q$Sample the Willcox-grown pecans at 'Lee's Pecans' and buy a pound in the shell straight from the farm.$q$, (select id from public.categories where name = $q$Shopping$q$), 'chamber_workbook_2026-09-01', NULL,
  'member_public_directory', 'include', $q$Chamber member. Family farm since 1982, 12 pecan varieties. Call ahead for hours.$q$, 'curated', 'business', NULL,
  'researched', $q$Farm Fresh Willcox; Welcome to Willcox$q$, $q$2890 Marguerite Rd; in-shell $5/lb, pieces $13, halves $15; samples; harvest in January (lees).$q$, $j$[{"url": "https://leespecans.com/", "checked": "2026-10-06"}, {"url": "https://visitwillcox.az.gov/shopping-beauty", "checked": "2026-10-06"}, {"url": "https://www.willcoxchamberofcommerce.com/ (Chamber Member Directory section on the home page)", "checked": "2026-10-06"}]$j$::jsonb, $q$Hours (call ahead); prices change.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Lee's Pecans$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Rafter M Meats$q$, $q$Rafter M Meats$q$, $q$Buy locally raised beef at the retail shop inside the 'Rafter M Meats' packing house, which has its own smokehouse and dry-aging room.$q$, (select id from public.categories where name = $q$Shopping$q$), 'chamber_workbook_2026-09-01', NULL,
  'member_public_directory', 'include', $q$Chamber member. Weekdays only, 8 to 4.$q$, 'curated', 'business', NULL,
  'researched', $q$Farm Fresh Willcox$q$, $q$3266 Fort Grant Rd; AZDA-inspected; retail space; Mon-Fri 8-4 (rafter). Specific products not listed.$q$, $j$[{"url": "https://raftermmeats.com/", "checked": "2026-10-06"}, {"url": "https://www.willcoxchamberofcommerce.com/ (Chamber Member Directory section on the home page)", "checked": "2026-10-06"}]$j$::jsonb, $q$Signature product (jerky, sausage); weekday hours.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Rafter M Meats$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$L&B Farm$q$, $q$L&B Farm$q$, $q$Book a farm tour or field trip at 'L&B Farm' and meet the pasture-raised animals behind its beef, pork, chicken and goat.$q$, (select id from public.categories where name = $q$Play$q$), 'directory_gap_research', NULL,
  'member_public_directory', 'discuss', $q$Chamber member. Tours by request only, so we need to know if visitors are welcome.$q$, 'discoverable', 'business', NULL,
  'needs_verification', $q$Farm Fresh Willcox$q$, $q$8695 N Ingram Rd; educational farm tours and field trips by contact; sells at Tucson and Glendale markets (lb).$q$, $j$[{"url": "https://www.lb-farm.com/", "checked": "2026-10-06"}, {"url": "https://www.willcoxchamberofcommerce.com/ (Chamber Member Directory section on the home page)", "checked": "2026-10-06"}]$j$::jsonb, $q$Whether casual visitors are welcome.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$L&B Farm$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Reconnect Farm$q$, $q$Reconnect Farm$q$, $q$Shop the farm store at 'Reconnect Farm' for eggs, pork and handmade candles.$q$, (select id from public.categories where name = $q$Shopping$q$), 'directory_gap_research', NULL,
  'member_public_directory', 'discuss', $q$Chamber member. No street address on its website, so we need the location and visitor hours.$q$, 'reserve', 'business', NULL,
  'needs_verification', $q$Farm Fresh Willcox$q$, $q$Farm store, 300+ lavender plants, stay at the farm; owners Larissa and Anthony Peters since 2022 (reconnect).$q$, $j$[{"url": "https://reconnectfarm.com/", "checked": "2026-10-06"}, {"url": "https://www.willcoxchamberofcommerce.com/ (Chamber Member Directory section on the home page)", "checked": "2026-10-06"}]$j$::jsonb, $q$Address, whether the store is open to visitors.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Reconnect Farm$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Olivery Orchards$q$, $q$Olivery Orchards$q$, $q$Taste extra virgin olive oil pressed within hours of harvest at 'Olivery Orchards'.$q$, (select id from public.categories where name = $q$Food & drink$q$), 'directory_gap_research', NULL,
  'member_public_directory', 'discuss', $q$Chamber member, but based in San Simon, about 45 miles east. Confirm visitor access and distance fit.$q$, 'reserve', 'business', NULL,
  'needs_verification', $q$Farm Fresh Willcox$q$, $q$San Simon AZ; mill, tastings, tours (olivery). Not confirmed to be in the Willcox area.$q$, $j$[{"url": "https://oliveryorchards.com/", "checked": "2026-10-06"}, {"url": "https://www.willcoxchamberofcommerce.com/ (Chamber Member Directory section on the home page)", "checked": "2026-10-06"}]$j$::jsonb, $q$Location, visitor hours, distance.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Olivery Orchards$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Mini ASSets Farm & Ranch$q$, $q$Mini ASSets Farm & Ranch$q$, NULL, (select id from public.categories where name = $q$Play$q$), 'directory_gap_research', NULL,
  'member_public_directory', 'discuss', $q$Chamber member. No public information found.$q$, 'reserve', 'business', NULL,
  'needs_research', $q$Farm Fresh Willcox$q$, $q$Directory lists only a phone and an email link (dir).$q$, $j$[{"url": "https://www.willcoxchamberofcommerce.com/ (Chamber Member Directory section on the home page)", "checked": "2026-10-06"}]$j$::jsonb, $q$Everything.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Mini ASSets Farm & Ranch$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Ron Applegate Saddle Shop$q$, $q$Ron Applegate Saddle Shop$q$, NULL, (select id from public.categories where name = $q$Shopping$q$), 'directory_gap_research', NULL,
  'member_public_directory', 'discuss', $q$Chamber member. A strong maker if open to visitors, but its listed website is no longer working, so we need to confirm it.$q$, 'reserve', 'business', NULL,
  'needs_research', $q$Only in Willcox$q$, $q$Listed domain now serves unrelated content. Press reports describe Ron Applegate as a Willcox blacksmith and horseshoe maker (applegate).$q$, $j$[{"url": "https://www.willcoxchamberofcommerce.com/ (Chamber Member Directory section on the home page)", "checked": "2026-10-06"}, {"url": "https://www.arizonahighways.com/archive/issues/chapter/Doc.949.Chapter.6", "checked": "2026-10-06"}]$j$::jsonb, $q$Is it a saddle shop, a blacksmith, or both; is it open to visitors.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Ron Applegate Saddle Shop$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Cross 8 Cast Iron Cottage Creations$q$, $q$Cross (+) 8 Cast Iron Cottage Creations$q$, NULL, (select id from public.categories where name = $q$Shopping$q$), 'directory_gap_research', NULL,
  'member_public_directory', 'discuss', $q$Chamber member and local maker. Facebook only; we need to confirm visitor access.$q$, 'reserve', 'business', NULL,
  'needs_research', $q$Only in Willcox$q$, $q$Directory links to a Facebook page (dir).$q$, $j$[{"url": "https://www.willcoxchamberofcommerce.com/ (Chamber Member Directory section on the home page)", "checked": "2026-10-06"}]$j$::jsonb, $q$Product, location, visitor access.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Cross (+) 8 Cast Iron Cottage Creations$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Momster Creations$q$, $q$Momster Creations$q$, NULL, (select id from public.categories where name = $q$Shopping$q$), 'directory_gap_research', NULL,
  'member_public_directory', 'discuss', $q$Chamber member and local maker. Facebook only.$q$, 'reserve', 'business', NULL,
  'needs_research', $q$Only in Willcox$q$, $q$Directory links to a Facebook profile (dir).$q$, $j$[{"url": "https://www.willcoxchamberofcommerce.com/ (Chamber Member Directory section on the home page)", "checked": "2026-10-06"}]$j$::jsonb, $q$Product, location, visitor access.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Momster Creations$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$All The Things$q$, $q$All The Things$q$, NULL, (select id from public.categories where name = $q$Shopping$q$), 'directory_gap_research', NULL,
  'member_public_directory', 'discuss', $q$Chamber member, likely a shop. Facebook only.$q$, 'reserve', 'business', NULL,
  'needs_research', $q$Welcome to Willcox$q$, $q$Directory links to Facebook (dir).$q$, $j$[{"url": "https://www.willcoxchamberofcommerce.com/ (Chamber Member Directory section on the home page)", "checked": "2026-10-06"}]$j$::jsonb, $q$What it sells, address.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$All The Things$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Buffalo Sisters$q$, $q$Buffalo Sisters$q$, NULL, (select id from public.categories where name = $q$Shopping$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_found', 'discuss', $q$Trading post at 200 N Railroad Ave. Needs a signature product before we can write it.$q$, 'reserve', 'business', NULL,
  'needs_research', $q$Welcome to Willcox$q$, $q$vw_shop.$q$, $j$[{"url": "https://visitwillcox.az.gov/shopping-beauty", "checked": "2026-10-06"}]$j$::jsonb, $q$Signature product; membership.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Buffalo Sisters$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Willcox Traders$q$, $q$Willcox Traders$q$, NULL, (select id from public.categories where name = $q$Shopping$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_found', 'discuss', $q$Trading post at 100 S Haskell Ave. Needs a signature product.$q$, 'reserve', 'business', NULL,
  'needs_research', $q$Welcome to Willcox$q$, $q$vw_shop.$q$, $j$[{"url": "https://visitwillcox.az.gov/shopping-beauty", "checked": "2026-10-06"}]$j$::jsonb, $q$Signature product; membership.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Willcox Traders$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Amarillo by Morning$q$, $q$Amarillo by Morning$q$, NULL, (select id from public.categories where name = $q$Shopping$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_found', 'discuss', $q$Western shop at 104 N Railroad Ave. Needs a signature product.$q$, 'reserve', 'business', NULL,
  'needs_research', $q$Welcome to Willcox$q$, $q$vw_shop.$q$, $j$[{"url": "https://visitwillcox.az.gov/shopping-beauty", "checked": "2026-10-06"}]$j$::jsonb, $q$Signature product; membership.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Amarillo by Morning$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Vin-Tage$q$, $q$Vin-Tage$q$, NULL, (select id from public.categories where name = $q$Shopping$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_found', 'discuss', $q$Vintage shop in the historic Commercial building (180 N Railroad Ave). Needs a signature item.$q$, 'reserve', 'business', NULL,
  'needs_research', $q$Welcome to Willcox$q$, $q$vw_shop.$q$, $j$[{"url": "https://visitwillcox.az.gov/shopping-beauty", "checked": "2026-10-06"}]$j$::jsonb, $q$Signature item; membership.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Vin-Tage$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Bear's Vintage Thrift$q$, $q$Bear's Vintage Thrift$q$, NULL, (select id from public.categories where name = $q$Shopping$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_found', 'discuss', $q$Thrift store at 233 N Haskell Ave. Needs specifics.$q$, 'reserve', 'business', NULL,
  'needs_research', $q$Welcome to Willcox$q$, $q$vw_shop.$q$, $j$[{"url": "https://visitwillcox.az.gov/shopping-beauty", "checked": "2026-10-06"}]$j$::jsonb, $q$Signature item; membership.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Bear's Vintage Thrift$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Friendly Bookstore$q$, $q$Friendly Bookstore$q$, NULL, (select id from public.categories where name = $q$Shopping$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_found', 'discuss', $q$Bookstore at 125 E Maley St. Needs specifics.$q$, 'reserve', 'business', NULL,
  'needs_research', $q$Welcome to Willcox$q$, $q$vw_shop.$q$, $j$[{"url": "https://visitwillcox.az.gov/shopping-beauty", "checked": "2026-10-06"}]$j$::jsonb, $q$Signature item; membership.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Friendly Bookstore$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$The Moore House$q$, $q$The Moore House$q$, $q$Stay in the restored 1919 'Moore House', within walking distance of the Railroad Avenue tasting rooms.$q$, (select id from public.categories where name = $q$Travel$q$), 'directory_gap_research', NULL,
  'member_public_directory', 'discuss', $q$Chamber member. Vacation rental. Chamber to decide whether lodging is checkable.$q$, 'reserve', 'business', NULL,
  'researched', $q$Welcome to Willcox$q$, $q$Built 1919, three bedrooms, Airbnb (moore).$q$, $j$[{"url": "https://www.moorehouseaz.com/", "checked": "2026-10-06"}, {"url": "https://www.willcoxchamberofcommerce.com/ (Chamber Member Directory section on the home page)", "checked": "2026-10-06"}]$j$::jsonb, $q$Whether lodging belongs.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$The Moore House$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Stagecoach Inn$q$, $q$Stagecoach Inn$q$, NULL, (select id from public.categories where name = $q$Travel$q$), 'directory_gap_research', NULL,
  'member_public_directory', 'discuss', $q$Chamber member. Inn at 100 W Rex Allen Dr. No visitor-experience detail found.$q$, 'reserve', 'business', NULL,
  'needs_research', $q$Welcome to Willcox$q$, $q$vw_lodging; directory booking link only.$q$, $j$[{"url": "https://visitwillcox.az.gov/lodging", "checked": "2026-10-06"}, {"url": "https://www.willcoxchamberofcommerce.com/ (Chamber Member Directory section on the home page)", "checked": "2026-10-06"}]$j$::jsonb, $q$Whether lodging belongs.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Stagecoach Inn$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Arizona Sunset Inn$q$, $q$Arizona Sunset Inn$q$, NULL, (select id from public.categories where name = $q$Travel$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_found', 'discuss', $q$Inn at 340 S Haskell Ave. Chamber to decide whether lodging is checkable.$q$, 'reserve', 'business', NULL,
  'needs_research', $q$Welcome to Willcox$q$, $q$vw_lodging.$q$, $j$[{"url": "https://visitwillcox.az.gov/lodging", "checked": "2026-10-06"}]$j$::jsonb, $q$Whether lodging belongs; membership.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Arizona Sunset Inn$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Lazul Med Spa$q$, $q$Lazul Aesthetics & Wellness Med Spa$q$, NULL, (select id from public.categories where name = $q$Spa & self-care$q$), 'chamber_workbook_2026-09-01', NULL,
  'member_public_directory', 'discuss', $q$Chamber member. Wellness is a stretch for most visitors; services need confirming.$q$, 'reserve', 'business', NULL,
  'needs_research', $q$Welcome to Willcox$q$, $q$135 N Haskell Ave (vw_shop); dir.$q$, $j$[{"url": "https://visitwillcox.az.gov/shopping-beauty", "checked": "2026-10-06"}, {"url": "https://www.willcoxchamberofcommerce.com/ (Chamber Member Directory section on the home page)", "checked": "2026-10-06"}]$j$::jsonb, $q$Services; visitor fit.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Lazul Aesthetics & Wellness Med Spa$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$The Neighborhood Studio$q$, $q$The Neighborhood Studio (Pilates)$q$, NULL, (select id from public.categories where name = $q$Spa & self-care$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_found', 'discuss', $q$Pilates studio. No public listing found.$q$, 'reserve', 'business', NULL,
  'needs_research', $q$Welcome to Willcox$q$, $q$No source found.$q$, $j$[]$j$::jsonb, $q$Address, schedule; membership.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$The Neighborhood Studio (Pilates)$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Rhumb Line Vineyard & Lavender Farm$q$, $q$Rhumb Line lavender bloom$q$, $q$Walk the lavender fields at 'Rhumb Line Vineyard & Lavender Farm' during peak bloom in June and July.$q$, (select id from public.categories where name = $q$Play$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_found', 'discuss', $q$Peak bloom is June and July. Not in the public directory.$q$, 'seasonal', 'business', NULL,
  'researched', $q$Lavender / Farms; Farm Fresh Willcox$q$, $q$Peak bloom June-July; Lavender Festival every June (rhumb, vw_events).$q$, $j$[{"url": "https://rhumblinevineyard.com/", "checked": "2026-10-06"}, {"url": "https://visitwillcox.az.gov/events", "checked": "2026-10-06"}]$j$::jsonb, $q$Membership; weekday access.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Rhumb Line lavender bloom$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Rhumb Line Vineyard & Lavender Farm$q$, $q$Olive's Vineyard Cafe$q$, $q$Pair a homemade focaccia sandwich with estate wine at 'Olive's Vineyard Cafe'.$q$, (select id from public.categories where name = $q$Food & drink$q$), 'directory_gap_research', NULL,
  'not_found', 'discuss', $q$Cafe at 6345 S Rhumb Line Way. Thursday to Sunday.$q$, 'discoverable', 'business', NULL,
  'researched', $q$Taste of Willcox; Farm Fresh Willcox$q$, $q$Thu-Fri 11-5, Sat 9-5, Sun 9-3; focaccia sandwiches and pizzas (rhumb).$q$, $j$[{"url": "https://rhumblinevineyard.com/", "checked": "2026-10-06"}, {"url": "https://visitwillcox.az.gov/dining", "checked": "2026-10-06"}]$j$::jsonb, $q$Membership.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Olive's Vineyard Cafe$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Rhumb Line Vineyard & Lavender Farm$q$, $q$Rhumb Line Harvest Hootenanny$q$, $q$Join the Harvest Hootenanny at 'Rhumb Line Vineyard & Lavender Farm' on October 17.$q$, (select id from public.categories where name = $q$Social$q$), 'directory_gap_research', NULL,
  'not_found', 'discuss', $q$Festival-day event on Oct 17. Needs confirming.$q$, 'seasonal', 'business', NULL,
  'needs_verification', $q$Wine Festival; Harvest$q$, $q$Listed on rhumb as an October 17 event.$q$, $j$[{"url": "https://rhumblinevineyard.com/", "checked": "2026-10-06"}]$j$::jsonb, $q$Time, cost, what it includes.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Rhumb Line Harvest Hootenanny$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Rhumb Line Vineyard & Lavender Farm$q$, $q$The Huts at Rhumb Line$q$, $q$Sleep in a Quonset hut at 'The Huts at Rhumb Line' and walk the lavender fields in the morning.$q$, (select id from public.categories where name = $q$Travel$q$), 'directory_gap_research', NULL,
  'not_found', 'discuss', $q$Vineyard lodging. Chamber to decide whether lodging is checkable.$q$, 'reserve', 'business', NULL,
  'researched', $q$Lavender / Farms$q$, $q$vw_lodging, rhumb.$q$, $j$[{"url": "https://rhumblinevineyard.com/", "checked": "2026-10-06"}, {"url": "https://visitwillcox.az.gov/lodging", "checked": "2026-10-06"}]$j$::jsonb, $q$Whether lodging belongs.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$The Huts at Rhumb Line$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Inde Motor Sports$q$, $q$Inde Motorsports Ranch$q$, $q$Take a driver-development session on the 2.75-mile, 21-turn road course at 'Inde Motorsports Ranch'.$q$, (select id from public.categories where name = $q$Adventure$q$), 'chamber_workbook_2026-09-01', NULL,
  'member_public_directory', 'include', $q$Chamber member. Most unusual item in the set. Needs the visitor-access options confirmed.$q$, 'curated', 'business', NULL,
  'researched', $q$Only in Willcox$q$, $q$9301 W Airport Rd; Driver Development, Challenge Series, SCCA licensing school; waiver required (inde).$q$, $j$[{"url": "https://indemotorsports.com/", "checked": "2026-10-06"}, {"url": "https://visitwillcox.az.gov/attractions-1", "checked": "2026-10-06"}, {"url": "https://www.willcoxchamberofcommerce.com/ (Chamber Member Directory section on the home page)", "checked": "2026-10-06"}]$j$::jsonb, $q$Whether non-members can book a session; booking page.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Inde Motorsports Ranch$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Willcox West Fest$q$, $q$Willcox West Fest$q$, $q$Eat from a chuck wagon at the 'Willcox West Fest Ranch Rodeo & Chuck Wagon Cook-Off' every April.$q$, (select id from public.categories where name = $q$Social$q$), 'directory_gap_research', NULL,
  'member_public_directory', 'include', $q$Chamber member. April event at the Event Center. Dates need confirming.$q$, 'seasonal', 'chamber', NULL,
  'needs_verification', $q$Spring Wine Weekend; Only in Willcox$q$, $q$1138 N Quail Dr; chuck wagon cook-off, ranch rodeo, blacksmithing demos; sources disagree on 2026 dates (westfest).$q$, $j$[{"url": "https://visitwillcox.az.gov/willcox-west-fest", "checked": "2026-10-06"}, {"url": "https://visitwillcox.az.gov/events", "checked": "2026-10-06"}, {"url": "https://www.willcoxchamberofcommerce.com/ (Chamber Member Directory section on the home page)", "checked": "2026-10-06"}]$j$::jsonb, $q$2027 dates.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Willcox West Fest$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Rex Allen Days$q$, $q$Rex Allen Days$q$, $q$Watch the parade and walk the car show at 'Rex Allen Days' every October.$q$, (select id from public.categories where name = $q$Social$q$), 'directory_gap_research', NULL,
  'not_applicable_public_experience', 'discuss', $q$October festival (Oct 1 to 4 this year). Organizer needs confirming.$q$, 'seasonal', 'chamber', NULL,
  'needs_verification', $q$Harvest; Only in Willcox$q$, $q$vw_events: Oct 1-4, 2026; parade, car show, carnival, rodeo.$q$, $j$[{"url": "https://visitwillcox.az.gov/events", "checked": "2026-10-06"}]$j$::jsonb, $q$Organizer; 2027 dates.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Rex Allen Days$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Rex Allen Arizona Cowboy Museum$q$, $q$Rex Allen statue$q$, $q$Find KoKo's grave at the base of the bronze 'Rex Allen' statue and learn what is inside it.$q$, (select id from public.categories where name = $q$Arts & Culture$q$), 'directory_gap_research', NULL,
  'not_applicable_public_experience', 'include', $q$Public statue across the street from the museum. Needs the exact spot and owner confirmed.$q$, 'discoverable', 'city', NULL,
  'needs_verification', $q$Only in Willcox; Outdoor & Historic Willcox$q$, $q$Bronze statue by Buck McCain with a molded bronze heart; horse KoKo buried at its base (rexallen).$q$, $j$[{"url": "https://www.rexallenmuseum.org/", "checked": "2026-10-06"}]$j$::jsonb, $q$Exact location, who owns the statue.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Rex Allen statue$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Rex Allen Arizona Cowboy Museum$q$, $q$Rex Allen Monday music jam$q$, $q$Catch the live country music jam on Monday mornings inside the 'Rex Allen Arizona Cowboy Museum'.$q$, (select id from public.categories where name = $q$Arts & Culture$q$), 'directory_gap_research', NULL,
  'member_public_directory', 'include', $q$Chamber member. Mondays 10 to 1 (verify).$q$, 'discoverable', 'business', NULL,
  'researched', $q$Only in Willcox$q$, $q$Monday 10-1 live country music jam (rexallen).$q$, $j$[{"url": "https://www.rexallenmuseum.org/", "checked": "2026-10-06"}]$j$::jsonb, $q$Confirm still running.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Rex Allen Monday music jam$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Historic Railroad Depot$q$, $q$Historic Railroad Depot$q$, $q$Step inside the restored 1880 'Southern Pacific Depot', the only original redwood frame Southern Pacific station left in Arizona.$q$, (select id from public.categories where name = $q$Arts & Culture$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_applicable_public_experience', 'include', $q$Public history at 101 S Railroad Ave. It is also City Hall and the Visitor Center.$q$, 'curated', 'city', NULL,
  'needs_verification', $q$Outdoor & Historic Willcox; Welcome to Willcox$q$, $q$Built 1880; NRHP; saved from demolition in 1994; City Hall and depot museum (depot).$q$, $j$[{"url": "https://www.hmdb.org/m.asp?m=28180", "checked": "2026-10-06"}, {"url": "https://visitwillcox.az.gov/attractions-1", "checked": "2026-10-06"}]$j$::jsonb, $q$Public hours; the 'only remaining' claim wording.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Historic Railroad Depot$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Historic Railroad Park$q$, $q$Historic Railroad Park$q$, $q$Photograph a piece of Willcox railroad history in 'Historic Railroad Park' next to the depot.$q$, (select id from public.categories where name = $q$Arts & Culture$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_applicable_public_experience', 'include', $q$City park at 151 N Railroad Ave. It is also the Wine Festival site.$q$, 'discoverable', 'city', NULL,
  'needs_verification', $q$Outdoor & Historic Willcox$q$, $q$vw_attr. Best photo point not documented.$q$, $j$[{"url": "https://visitwillcox.az.gov/attractions-1", "checked": "2026-10-06"}]$j$::jsonb, $q$Best photo point or marker.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Historic Railroad Park$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Railroad Avenue Walk$q$, $q$Railroad Avenue Walk$q$, $q$Walk 'Railroad Avenue' from the depot to the Rex Allen Museum and count the tasting rooms in its historic storefronts.$q$, (select id from public.categories where name = $q$Adventure$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_applicable_public_experience', 'include', $q$Public walk. Replaces the separate 'photo walk' row to avoid duplicates.$q$, 'curated', 'chamber', NULL,
  'researched', $q$Outdoor & Historic Willcox; Welcome to Willcox$q$, $q$Depot 101 S Railroad, Rex Allen 150 N Railroad, tasting rooms at 100, 154, 180 N Railroad (vw_attr, vw_wine).$q$, $j$[{"url": "https://visitwillcox.az.gov/attractions-1", "checked": "2026-10-06"}, {"url": "https://visitwillcox.az.gov/wine-tasting", "checked": "2026-10-06"}]$j$::jsonb, $q$Preferred start and stops.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Railroad Avenue Walk$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Historic Schwertner House$q$, $q$Historic Schwertner House$q$, $q$See the 'Historic Schwertner House', built in 1880 as an Army officer reception center.$q$, (select id from public.categories where name = $q$Arts & Culture$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_applicable_public_experience', 'discuss', $q$Public history. Needs to be confirmed as viewable.$q$, 'reserve', 'city', NULL,
  'needs_verification', $q$Outdoor & Historic Willcox$q$, $q$Built 1880, family home from 1897 (vw_museums).$q$, $j$[{"url": "https://visitwillcox.az.gov/museums", "checked": "2026-10-06"}]$j$::jsonb, $q$Address; exterior only?$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Historic Schwertner House$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Amerind Museum$q$, $q$Amerind Museum$q$, $q$Browse archaeology and art at the 'Amerind Museum' in Texas Canyon, founded in 1937.$q$, (select id from public.categories where name = $q$Arts & Culture$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_applicable_public_experience', 'discuss', $q$Museum. Membership does not apply. Roughly 35 miles west, so confirm it belongs in the Willcox Hub.$q$, 'discoverable', 'checkoff', NULL,
  'researched', $q$Outdoor & Historic Willcox$q$, $q$Tue-Sat 10-4, est. 1937 (vw_museums).$q$, $j$[{"url": "https://visitwillcox.az.gov/museums", "checked": "2026-10-06"}]$j$::jsonb, $q$Hub radius fit; admission.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Amerind Museum$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Studio 128$q$, $q$Studio 128$q$, NULL, (select id from public.categories where name = $q$Arts & Culture$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_found', 'discuss', $q$Downtown art studio at 128 N Railroad Ave. Needs to confirm what visitors can do.$q$, 'reserve', 'business', NULL,
  'needs_research', $q$Welcome to Willcox$q$, $q$vw_attr.$q$, $j$[{"url": "https://visitwillcox.az.gov/attractions-1", "checked": "2026-10-06"}]$j$::jsonb, $q$What visitors can do; membership.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Studio 128$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Willcox Art League$q$, $q$Willcox Art League$q$, NULL, (select id from public.categories where name = $q$Arts & Culture$q$), 'directory_gap_research', NULL,
  'member_public_directory', 'exclude', $q$Chamber member, but it is a club that meets monthly. No gallery. Not a visitor experience.$q$, 'not_included', 'business', NULL,
  'researched', NULL, $q$Meets 3rd Tuesday Sept-May; guests welcome; no gallery address (artleague).$q$, $j$[{"url": "https://www.willcoxartleague.com", "checked": "2026-10-06"}, {"url": "https://www.willcoxchamberofcommerce.com/ (Chamber Member Directory section on the home page)", "checked": "2026-10-06"}]$j$::jsonb, NULL
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Willcox Art League$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Twin Lakes birding$q$, $q$Twin Lakes birding$q$, $q$Scan 'Twin Lakes' for shorebirds and waterfowl at an Audubon-recognized Important Bird Area.$q$, (select id from public.categories where name = $q$Adventure$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_applicable_public_experience', 'include', $q$Public birding. Membership does not apply.$q$, 'discoverable', 'city', NULL,
  'needs_verification', $q$Crane Season; Outdoor & Historic Willcox$q$, $q$300+ bird species documented; Audubon Important Bird Area (vw_birding). Public access point not documented.$q$, $j$[{"url": "https://visitwillcox.az.gov/birding", "checked": "2026-10-06"}]$j$::jsonb, $q$Best public access point and parking.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Twin Lakes birding$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Twin Lakes Golf Course$q$, $q$Twin Lakes Golf Course$q$, $q$Play nine holes at 'Twin Lakes Golf Course' with the high desert around you.$q$, (select id from public.categories where name = $q$Sports$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_applicable_public_experience', 'include', $q$City golf course at 1000 S Rex Allen Jr Dr.$q$, 'discoverable', 'city', NULL,
  'needs_verification', $q$Summer / Family$q$, $q$vw_attr. Nine holes claim from workbook only.$q$, $j$[{"url": "https://visitwillcox.az.gov/attractions-1", "checked": "2026-10-06"}]$j$::jsonb, $q$Holes, fees.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Twin Lakes Golf Course$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Keiller Park$q$, $q$Keiller Park$q$, $q$Take a break in 'Keiller Park' on Bisbee Avenue.$q$, (select id from public.categories where name = $q$Play$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_applicable_public_experience', 'include', $q$City park at 500 N Bisbee Ave.$q$, 'discoverable', 'city', NULL,
  'needs_verification', $q$Summer / Family$q$, $q$vw_attr. Amenities not documented.$q$, $j$[{"url": "https://visitwillcox.az.gov/attractions-1", "checked": "2026-10-06"}]$j$::jsonb, $q$Best amenity.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Keiller Park$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Quail Park$q$, $q$Quail Park$q$, $q$Walk the trail or catch a game at 'Quail Park'.$q$, (select id from public.categories where name = $q$Play$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_applicable_public_experience', 'include', $q$City park at 1138 N Quail Dr.$q$, 'discoverable', 'city', NULL,
  'needs_verification', $q$Summer / Family$q$, $q$vw_attr. Trail and games detail from workbook only.$q$, $j$[{"url": "https://visitwillcox.az.gov/attractions-1", "checked": "2026-10-06"}]$j$::jsonb, $q$Confirm trail and fields.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Quail Park$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Railroad Dog Park$q$, $q$Railroad Dog Park$q$, $q$Give your dog a travel break at 'Railroad Dog Park' downtown.$q$, (select id from public.categories where name = $q$Play$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_applicable_public_experience', 'include', $q$City dog park at 130 N Railroad Ave.$q$, 'discoverable', 'city', NULL,
  'researched', $q$Welcome to Willcox$q$, $q$vw_attr.$q$, $j$[{"url": "https://visitwillcox.az.gov/attractions-1", "checked": "2026-10-06"}]$j$::jsonb, $q$Rules and hours.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Railroad Dog Park$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Willcox Pool & Splash Pad$q$, $q$Willcox City Pool & Splash Pad$q$, $q$Cool off at the 'Willcox City Pool & Splash Pad' on a summer visit.$q$, (select id from public.categories where name = $q$Play$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_applicable_public_experience', 'include', $q$City pool at 500 N Bisbee Ave. Summer only.$q$, 'seasonal', 'city', NULL,
  'needs_verification', $q$Summer / Family$q$, $q$vw_attr.$q$, $j$[{"url": "https://visitwillcox.az.gov/attractions-1", "checked": "2026-10-06"}]$j$::jsonb, $q$Season dates.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Willcox City Pool & Splash Pad$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Event Center & Rodeo Grounds$q$, $q$Event Center & Rodeo Grounds$q$, $q$Catch a rodeo or community event at the 'Willcox Event Center'.$q$, (select id from public.categories where name = $q$Social$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_applicable_public_experience', 'include', $q$City Event Center at 1138 N Quail Dr. Seasonal.$q$, 'seasonal', 'city', NULL,
  'needs_verification', $q$Spring Wine Weekend; Summer / Family$q$, $q$vw_attr; hosts West Fest.$q$, $j$[{"url": "https://visitwillcox.az.gov/attractions-1", "checked": "2026-10-06"}, {"url": "https://visitwillcox.az.gov/willcox-west-fest", "checked": "2026-10-06"}]$j$::jsonb, $q$Event calendar.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Event Center & Rodeo Grounds$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Willcox Community Center Playground$q$, $q$Willcox Community Center Playground$q$, NULL, (select id from public.categories where name = $q$Play$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_applicable_public_experience', 'discuss', $q$Needs confirming it is open to casual public use.$q$, 'reserve', 'city', NULL,
  'needs_research', $q$Summer / Family$q$, $q$No source found.$q$, $j$[]$j$::jsonb, $q$Public use.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Willcox Community Center Playground$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Dos Cabezas$q$, $q$Dos Cabezas$q$, $q$Take in the 'Dos Cabezas' granite peaks and the old townsite in the Dos Cabezas Mountains.$q$, (select id from public.categories where name = $q$Adventure$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_applicable_public_experience', 'discuss', $q$Public land. Needs a safe public access point before we promote it.$q$, 'discoverable', 'checkoff', NULL,
  'needs_verification', $q$Outdoor & Historic Willcox$q$, $q$Granite peaks, ghost town (vw_hiking). No access point documented.$q$, $j$[{"url": "https://visitwillcox.az.gov/hiking", "checked": "2026-10-06"}]$j$::jsonb, $q$Safe access point.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Dos Cabezas$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Willcox Flyer Bike Ride$q$, $q$Willcox Flyer Bike Ride$q$, $q$Ride the 'Willcox Flyer' and see the Sulphur Springs Valley from two wheels.$q$, (select id from public.categories where name = $q$Sports$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_applicable_public_experience', 'discuss', $q$August event. Organizer needs confirming.$q$, 'seasonal', 'chamber', NULL,
  'needs_verification', $q$Summer / Family$q$, $q$Every August, Active.com listing (vw_events).$q$, $j$[{"url": "https://visitwillcox.az.gov/events", "checked": "2026-10-06"}]$j$::jsonb, $q$Organizer; 2027 date.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Willcox Flyer Bike Ride$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Boulderdash Trail Run$q$, $q$Boulderdash Trail Run$q$, NULL, (select id from public.categories where name = $q$Sports$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_applicable_public_experience', 'discuss', $q$Event details not found.$q$, 'reserve', 'checkoff', NULL,
  'needs_research', $q$Summer / Family$q$, $q$No source found.$q$, $j$[]$j$::jsonb, $q$Organizer; date.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Boulderdash Trail Run$q$ and x.candidate_type = 'new');
insert into public.destination_item_candidates (destination_id, candidate_type, group_key, place_name, proposed_body, category_id, origin, existing_item_id,
  chamber_membership_status, recommended_decision, recommendation_note, proposed_content_status, verification_owner_type, verification_owner_name,
  research_status, list_recommendation, research_notes, research_sources, needs_confirmation)
select 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid, 'new', $q$Amerind Texas Canyon Trail Run$q$, $q$Amerind Texas Canyon Trail Run$q$, NULL, (select id from public.categories where name = $q$Sports$q$), 'chamber_workbook_2026-09-01', NULL,
  'not_applicable_public_experience', 'discuss', $q$Event details not found.$q$, 'reserve', 'checkoff', NULL,
  'needs_research', $q$Summer / Family$q$, $q$No source found.$q$, $j$[]$j$::jsonb, $q$Organizer; date.$q$
where not exists (select 1 from public.destination_item_candidates x where x.destination_id = 'bb4f0caf-c6ce-4eae-a7fd-c622bf115639'::uuid and x.place_name = $q$Amerind Texas Canyon Trail Run$q$ and x.candidate_type = 'new');
commit;
