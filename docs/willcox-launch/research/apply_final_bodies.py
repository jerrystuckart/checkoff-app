# Applies Jerry's final proposed CheckOff bodies (2026-10-07) to destination_item_candidates, plus availability tags and notes.
# Writes only to destination_item_candidates / destination_item_decisions. Never touches public.items.
B = [  # (candidate_id, expected place_name in DB, EXACT approved body)
 ('b33054f6-9508-4816-9787-6a853bedbbd3','1764 Vineyards (Pearce)',"Sip a Willcox AVA wine at '1764 Vineyards' with Cochise Stronghold filling the horizon"),
 ('ba1ae9ee-839b-438b-91d1-87c52a80b725','All The Things',"Pick out a local gift at 'All The Things'"),
 ('f8949a6d-030f-492e-b6c9-37a5aa676421','Amarillo by Morning',"Try on a little Arizona western flair at 'Amarillo by Morning' on Railroad Avenue"),
 ('a2022d6d-e0c2-47be-a9ef-7d2402b393a2','Amerind Texas Canyon Trail Run',"Cross the finish line among the granite boulders at 'Amerind's Texas Canyon Trail Run'"),
 ('bef03bb3-2e9b-4c7e-b1c0-3b6bfa82ace2','Arizona Sunset Inn',"Wake up to the house breakfast at 'Arizona Sunset Inn & Suites' before heading into wine country"),
 ('5df29c39-9875-475d-8823-4c070a64e1a8',"Bear's Vintage Thrift","Go junking for rusty metal or Western oddities at 'Bear's Vintage Thrift'"),
 ('c6eac0ac-734e-468a-a737-e0910c26559f','Boulderdash Trail Run',"Run the 'Boulderdash Trail Run' through Texas Canyon"),
 ('7b723a1e-b730-4db0-b922-838fef717f1f','Buffalo Sisters',"Hunt for an antique with a little Arizona mileage at 'Buffalo Sisters Trading Post'"),
 ('eace590c-3331-47d3-b9b2-c1f02c3f6263','Cross (+) 8 Cast Iron Cottage Creations',"Shop the handmade creations at 'Cross (+) 8 Cast Iron Cottage Creations'"),
 ('590efcfd-d30a-4b2c-9f76-c06574b8af00','Evermore Coffee',"Grab a coffee from 'Evermore Coffee' at a local Willcox event"),
 ('b212c26a-244e-4212-99aa-44486d343b96','Four Tails Vineyards (Pearce)',"Match the tails to their labels at 'Four Tails Vineyard' while tasting the wines they inspired"),
 ('e7657a93-275a-4d28-b7ca-5e3c6c24285d','Friendly Bookstore',"Purchase a road trip read at 'Friendly Bookstore' before heading back out across Cochise County"),
 ('ff2f01fa-b3e8-459d-9ab0-a944b05e5949','Laramita Cellars',"Ask about the wine club perks at 'Laramita Cellars' while tasting Arizona-grown wine"),
 ('208d4384-9e7f-48a4-a690-257c4166cee6','Lazul Aesthetics & Wellness Med Spa',"Book a little recovery time at 'Lazul Aesthetics & Wellness' between Willcox adventures"),
 ('05a86bc4-98df-415f-a5af-5f25fe7afb0e','Mini ASSets Farm & Ranch',"Explore 'Mini ASSets Farm & Ranch' and see what they're raising"),
 ('26476d60-c71b-4965-8ea1-67e0e9ecd52d','Momster Creations',"Find a Willcox made freshie or custom cup from 'Momster Creations' at a local market"),
 ('0853b2bd-8bb9-41fd-b988-bfbab90384e5','Passion Cellars',"Sip beside the barrels at 'Passion Cellars' where the tasting room looks straight into the working barrel room"),
 ('4e9ccd66-0949-4f56-95bb-ed8c222ed741','Ron Applegate Saddle Shop',"Watch for the marks of traditional ranch blacksmithing at 'Ron Applegate Saddle Shop & Blacksmith Shop'"),
 ('b180c10d-dce1-4c9b-9c21-e8c47384a2a2','Sandor Vineyards (Pearce)',"Taste a current release at 'Sándor Vineyards'"),
 ('2ed669fa-d027-4b32-9011-90fa4296d148','Stagecoach Inn',"Take a pool break at 'Stagecoach Inn' after a dusty day around Willcox"),
 ('5dd8d987-e3fd-45d1-8265-f05dc9da4481','Studio 128',"Make something at an arts or STEAM workshop inside 'Studio 128'"),
 ('2cc8fd4a-7537-48e5-b127-38d5abae3eb7','The Neighborhood Studio (Pilates)',"Take a Pilates class at 'The Neighborhood Studio' while you're in Willcox"),
 ('9872d08a-8d52-4301-ba89-f9b132fb7ae2','Vin-Tage',"Hunt for a vintage find inside the 1881 Commercial Store at 'Vin•Tage'"),
 ('3817009d-9ac7-436a-bdb2-516d7bf4a24f','Willcox Community Center Playground',"Give the kids a playground break at 'Willcox Community Center'"),
 ('5e14cb92-c093-4e13-a28a-7cab02bacc00','Willcox Traders',"Pick up a bottle of local honey at 'Willcox Traders'"),
 ('27319ca1-fca4-4756-8d1a-b3bedc25df02','Zarpara Vineyards',"Pack a picnic for 'Zarpara Vineyards' and pair it with estate wine beneath the Dos Cabezas Mountains"),
]
ART_LEAGUE='f513fb4a-c16f-41d3-9a79-4b5ba7fbd9ce'   # intentionally left NULL / Exclude / Not Included
NOTE = {  # internal notes appended to needs_confirmation (existing notes preserved)
 'ba1ae9ee-839b-438b-91d1-87c52a80b725':'Provisional wording: CheckOff wants a more distinctive local hook if approved.',
 'eace590c-3331-47d3-b9b2-c1f02c3f6263':'Provisional wording: ask the Chamber/business for the specific product and visitor hook.',
 '05a86bc4-98df-415f-a5af-5f25fe7afb0e':'Provisional wording: Chamber/business should confirm what visitors can actually do there.',
 'b180c10d-dce1-4c9b-9c21-e8c47384a2a2':'Provisional wording: confirm current tasting access.',
 '2cc8fd4a-7537-48e5-b127-38d5abae3eb7':'Provisional wording until address, schedule and visitor booking are confirmed.',
 'a2022d6d-e0c2-47be-a9ef-7d2402b393a2':'EVENT-ONLY (not evergreen): verify organizer and date; set active_from/active_until only after a verified event window and approval; consider a Spotlight. No dates set.',
 'c6eac0ac-734e-468a-a737-e0910c26559f':'EVENT-ONLY (not evergreen): organizer and date unverified; set active_from/active_until only after a verified event window and approval; consider a Spotlight. No dates set.',
 '590efcfd-d30a-4b2c-9f76-c06574b8af00':'POP-UP inventory: do not assume an evergreen storefront unless the Chamber confirms a dependable visitor-facing location.',
 '26476d60-c71b-4965-8ea1-67e0e9ecd52d':'MAKER/MARKET inventory: do not assume a permanent visitor location unless confirmed.',
 'b212c26a-244e-4212-99aa-44486d343b96':'Preserve appointment/visitor logistics: confirm how visitors book and when.',
 'e7657a93-275a-4d28-b7ca-5e3c6c24285d':'Do not include any unverified library-benefit claim.',
 'ff2f01fa-b3e8-459d-9ab0-a944b05e5949':'Do not imply a vineyard tour is available to every visitor; confirm current visitor access.',
 'bef03bb3-2e9b-4c7e-b1c0-3b6bfa82ace2':'LODGING-ONLY: Nearby/Closest for guests; not for curated destination lists.',
 '2ed669fa-d027-4b32-9011-90fa4296d148':'LODGING-ONLY: Nearby/Closest for guests; not for curated destination lists.',
 '208d4384-9e7f-48a4-a690-257c4166cee6':'Not for a core curated list.',
 '5e14cb92-c093-4e13-a28a-7cab02bacc00':'Address conflict: verify the address with the Chamber before any promotion.',
}
PROVISIONAL=['ba1ae9ee-839b-438b-91d1-87c52a80b725','eace590c-3331-47d3-b9b2-c1f02c3f6263','05a86bc4-98df-415f-a5af-5f25fe7afb0e','b180c10d-dce1-4c9b-9c21-e8c47384a2a2','2cc8fd4a-7537-48e5-b127-38d5abae3eb7']
SEASONAL_RUNS=['a2022d6d-e0c2-47be-a9ef-7d2402b393a2','c6eac0ac-734e-468a-a737-e0910c26559f']
NOLIST=['bef03bb3-2e9b-4c7e-b1c0-3b6bfa82ace2','2ed669fa-d027-4b32-9011-90fa4296d148','208d4384-9e7f-48a4-a690-257c4166cee6']
# availability tags by place_name (other candidates already in the set)
EVENT_ONLY_PLACES=['Willcox Wine Festival (fall)','Willcox Wine Festival (spring)','Willcox West Fest','Rex Allen Days','Willcox Flyer Bike Ride','Rhumb Line Harvest Hootenanny']
LODGING_PLACES=['The Moore House','Tirrito Farm glamping domes','The Huts at Rhumb Line']
POPUP=['590efcfd-d30a-4b2c-9f76-c06574b8af00','26476d60-c71b-4965-8ea1-67e0e9ecd52d']
def q(s): return '$q$'+s+'$q$'
