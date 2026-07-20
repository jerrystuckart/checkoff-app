# Curated list content-gap report

Read-only analysis, 2026-07-18. No data was changed producing this report — it's a
snapshot of `curated_lists` / `curated_list_items` / `curated_list_metros` / `items`
against the live database, with the metro-overlay merge from the July 17 work already
in place.

**Method note on the gap check itself:** for every active curated list, visibility was
read from `curated_list_metros` (no rows = universal, visible in all 3 metros + no-metro
users; rows = only those metros). For every visible (list, metro) pair, "effective count"
= `city_slug IS NULL` items + that metro's `city_slug` items. Universal lists also get a
`universal_only` count — what a no-metro or future 4th-metro user sees. **32 (list,
segment) pairs came in under 10** across 18 distinct lists. Full breakdown: Tucson 15,
`universal_only` 13, Phoenix 3, Milwaukee 1 (all counted once per segment a list is
visible in — most lists appear in more than one row above since they're gapped in
multiple segments at once).

---

## Rules for new items

Whether attaching an existing item or writing one from scratch:

- **Voice**: verb + `'Place Name'` in single quotes + em dash + one concrete, specific
  hook. Not a category description — a reason to go *this week*.
- **Forbidden words**: "experience," "enjoy," "discover," "visit." If the sentence needs
  one of these to make sense, it's not specific enough yet.
- **Metro items** need a real venue and a `neighborhood_id` (so they resolve to a metro
  via `neighborhoods.metro_id → metro_areas.slug`, the classification path this whole
  overlay system runs on).
- **Universal items** are chain-free, doable in any metro without naming a specific
  business, and get `is_universal = true`.

---

## Tucson

Every list below is visible in Tucson and currently under 10 effective items there.
Recommendations pull only from the **65 active Tucson items already in the database**
(via `neighborhood_id → neighborhoods.metro_id → metro_areas.slug = 'tucson'`) — **55 of
which aren't attached to any curated list yet.** Attaching an item here means giving its
`curated_list_items` row `city_slug = 'tucson'` on the target list. Confidence is my
read of theme fit from the audience-group name/tagline and the list's existing items —
you approve, not me.

### 🏋️ Main Character Cardio · Summer 2026
Gym first. Smoothie later. Maybe tacos. — **Tucson: 0 / gap to 10: 10** (0 universal
items on this list — Phoenix and Milwaukee are fully served by their own overlays, only
Tucson is empty)
Existing items (Phoenix/Milwaukee flavor, for tone): *Go 'Salt River Tubing'* · *Walk the
loop and cross the pedestrian bridge at 'Tempe Town Lake'* · *Hike up to the scenic
overlook at 'Thunderbird Conservation Park'* · *Hike the Wind Cave Trail at 'Usery
Mountain Regional Park'* · *Climb the observation tower... at 'Riparian Preserve'* ·
*Book a narrated cruise on 'Lake Pleasant Cruises'* · *Race the electric karts at
'Andretti Indoor Karting & Games'* · *Play pinball at 'Castles N' Coasters'*
Season: summer 2026

**Recommended attachments:**
| Item | Category | Why it fits | Confidence |
|---|---|---|---|
| Walk the paved hill at 'Tumamoc Hill' at sunrise | Adventure | Signature Tucson cardio hike, same "climb something before breakfast" energy as the existing overlook/tower items | strong |
| Ride the canyon tram at 'Sabino Canyon' — then hike back down | Adventure | Direct parallel to the Lake Pleasant Cruises + hike combo already on the list | strong |
| Drive or bike the Cactus Forest Loop at 'Saguaro National Park East' | Adventure | Matches the Tempe Town Lake "loop" item exactly | strong |
| Bike or walk part of 'The Loop' shared path | Sports | Same loop-cardio shape as the Tempe Town Lake item | strong |
| Find the short Signal Hill trail at 'Saguaro National Park West' | Adventure | Short hike + payoff (petroglyphs), matches the overlook-hike pattern | strong |
| Book a bay and compete with your crew at 'Topgolf Tucson' | Sports | Active-but-social parallel to Andretti Karting | plausible |
| Climb from cactus to pine forest on the 'Mount Lemmon Scenic Byway' | Adventure | Scenic-drive-with-a-climb, parallel to the Lake Pleasant Cruises tone | plausible |

7 attachments → **7 of 10. Net-new still needed: 3** (ideally literal gym/fitness-venue
items — this list's Phoenix/Milwaukee copies lean outdoor-active rather than gym-specific
too, so a couple of genuine gym/studio items would round it out better than more hikes).

---

### 💅 Ferda Girls · Summer 2026
For-da girls: spa days, brunch plans, cocktails, cute outfits, and absolutely no errands.
— **Tucson: 0 / gap to 10: 10**
Existing items: *Book a cozy boutique massage at 'The Lazy Bee Spa'* · *Book a
Japanese-style head spa treatment at 'Cleanse Modern Day Spa'* · *Enjoy a facial at
'LeMonds - Aveda Salon'* · *Reset with a facial or massage at 'Astonished Spa'* · *Try a
seaweed facial at 'Spa Massaggio'* · *Try the lake-view Inspire Massage at 'Inspire Day
Spa'* · *Dig into all-day breakfast at 'Haymaker'* · *See what all the buzz is about at
'Diego Pops'*
Season: summer 2026

**Recommended attachments:**
| Item | Category | Why it fits | Confidence |
|---|---|---|---|
| Go full brunch mode with pastry-forward breakfast plates at 'Prep & Pastry' | Food & drink | Direct brunch match to the Haymaker/Diego Pops items | strong |
| Taste estate wines from Elgin at 'Los Milics' | Bar & drinks | Upscale cocktails/wine matches the "cute outfits, no errands" tone | strong |
| Pick up a prickly pear caramel bonbon at 'Tucson Chocolate Factory' | Food & drink | Treat-yourself, girls-day-out register | strong |
| Shop local gifts after walking desert gardens at 'Tohono Chul' | Shopping | Cute-outfits/shopping adjacent | plausible |
| Wander a historic adobe courtyard of galleries and gifts at 'Old Town Artisans' | Shopping | Boutique-shopping fit | plausible |
| Walk botanical gardens, see art and grab brunch at 'Tohono Chul' | Arts & Culture | Second brunch anchor, same venue as above but a different item | plausible |

6 attachments → **6 of 10. Net-new still needed: 4.** Real gap signal: **zero spa/salon
items exist in the Tucson pool at all** — this list's whole Phoenix/Milwaukee identity is
spa treatments, and Tucson has nothing to offer there. That's the strongest single
"go find this" signal in the whole report.

---

### 💘 Soft Launch Season · Summer 2026
Dates, mates, and people who "don't need a label." — **Tucson: 0 / gap to 10: 10**
Existing items: *Share a Riviera-inspired dinner at 'Lupi & Iris'* · *Book a seasonal
open-hearth dinner at 'Birch'* · *Linger over French bistro plates and wine at 'Cassis'*
· *Grab cocktails and dinner at hidden-gem 'Moxie Food + Drink'* · *Split a flatbread...
at 'Cooper's Hawk Winery & Restaurant'* · *Order a wine flight at 'Cooper's Hawk'* · *Eat
at 'Conejito's Place'* · *Eat a pretzel at 'Miller Time Pub & Grill'*
Season: summer 2026

**Recommended attachments:**
| Item | Category | Why it fits | Confidence |
|---|---|---|---|
| Taste estate wines from Elgin at 'Los Milics' | Bar & drinks | Direct wine-date parallel to Cooper's Hawk | strong |
| Taste the President's Plate or classic Sonoran comfort food at 'Mi Nidito' | Food & drink | Date-dinner institution, same register as Lupi & Iris/Birch | strong |
| Order carne seca or a chimichanga at 'El Charro Café' | Food & drink | Century-old dinner-date spot, parallel to Cassis | strong |
| Drink a beer and browse movies at 'Casa Film Bar' | Bar & drinks | Distinctive date-night activity, matches "hidden-gem" Moxie tone | strong |
| Grab a beer in a colorful downtown taproom at 'Crooked Tooth Brewing Co.' | Bar & drinks | Casual date-drinks parallel to Miller Time Pub | plausible |
| Try a Tucson-brewed beer in the warehouse arts district at 'Borderlands Brewing' | Bar & drinks | Same casual-date register | plausible |
| Catch live music or an event at 'Hotel Congress' | Social | Date-night-out anchor | plausible |

7 attachments → **7 of 10. Net-new still needed: 3.**

---

### 🥾 Trail Mix Crew · Summer 2026
Hydration, elevation, and pretending this was your idea. — **Tucson: 0 / gap to 10: 10**
Existing items: *Smell the flowers at the 'Desert Botanical Garden'* · *Walk the loop...
'Tempe Town Lake'* · *Climb the observation tower... 'Riparian Preserve'* · *Hike up to
the scenic overlook at 'Thunderbird Conservation Park'* · *Hike the Wind Cave Trail at
'Usery Mountain Regional Park'* · *Go 'Salt River Tubing'* · *Book a narrated cruise on
'Lake Pleasant Cruises'* · *Walk around... 'Anthem Veterans Memorial'*
Season: summer 2026

**Recommended attachments:** this is the best natural fit in the whole report — Tucson's
unattached inventory is heavily outdoor/hiking, and this is the one list built exactly
for that.
| Item | Category | Why it fits | Confidence |
|---|---|---|---|
| Walk the paved hill at 'Tumamoc Hill' at sunrise | Adventure | Direct hike-with-a-view match | strong |
| Ride the canyon tram at 'Sabino Canyon' — then hike back down | Adventure | Matches the cruise+hike combo already on the list | strong |
| Drive or bike the Cactus Forest Loop at 'Saguaro National Park East' | Adventure | Loop-trail match | strong |
| Find the short Signal Hill trail at 'Saguaro National Park West' | Adventure | Hike-to-a-payoff match | strong |
| Climb from cactus to pine forest on the 'Mount Lemmon Scenic Byway' | Adventure | Elevation-gain, literally matches "elevation" in the tagline | strong |
| Tour a desert cave then add a trail ride at 'Colossal Cave Mountain Park' | Adventure | Hike/adventure match | strong |
| Birdwatch at 'Sweetwater Wetlands' | Adventure | Outdoor-nature match, parallel to Riparian Preserve | strong |
| Bike or walk part of 'The Loop' shared path | Sports | Loop-trail match | strong |

8 attachments → **8 of 10. Net-new still needed: 2** — smallest gap in the report.

---

### 🧃 Snack Pack Survivors · Summer 2026
Low stakes. High snacks. — **Tucson: 0 / gap to 10: 10**
Existing items (Milwaukee flavor, for tone): *Enjoy the 'Milwaukee County Zoo'* · *Go to
the 'Betty Brinn Children's Museum'* · *Check out the 'Mitchell Park Domes'* · *Play a
round of WhirlyBall* · *Ride the rides at the State Fair* · *Tan at Bradford Beach* ·
*Throw a frisbee at Bradford Beach* · *Get rowdy at a non-opening day 'Milwaukee
Brewers' game*
Season: summer 2026

**Recommended attachments:**
| Item | Category | Why it fits | Confidence |
|---|---|---|---|
| Do a compact city zoo visit with giraffes, elephants... at 'Reid Park Zoo' | Play | Direct zoo parallel to Milwaukee County Zoo | strong |
| Let kids burn energy downtown with hands-on exhibits at 'Children's Museum Tucson' | Play | Direct parallel to Betty Brinn | strong |
| Play retro mini golf or arcade games on Tanque Verde at 'Golf N' Stuff' | Play | Low-stakes casual-fun match, parallel to WhirlyBall | strong |
| See a planetarium show after exploring UA campus at 'Flandrau Science Center' | Play | Casual family outing, parallel to Mitchell Park Domes | strong |
| Find tiny worlds inside 'Mini Time Machine Museum of Miniatures' | Misc | Quirky low-key fun, same register as the whole list | strong |
| Walk among hundreds of aircraft... at 'Pima Air & Space Museum' | Play | Family day-out parallel | plausible |
| Find butterflies, desert plants and rotating art at 'Tucson Botanical Gardens' | Play | Casual outdoor parallel to Bradford Beach items | plausible |

7 attachments → **7 of 10. Net-new still needed: 3.**

---

### Best of Tucson
**No audience group linked, 0 items total. Tucson: 0 / gap to 10: 10** — also gaps
Phoenix (0) and Milwaukee (0), see the flag below.

There's no existing-item tone signal here (no title text, no items) — this is a genuinely
empty shell, not a thin list. Given the list name itself, I picked a broad "greatest
hits" set across categories rather than one narrow theme:

| Item | Category | Why it fits | Confidence |
|---|---|---|---|
| Do the 'Arizona-Sonora Desert Museum' as zoo, botanical garden and natural history museum | Adventure | Tucson's single most-recommended attraction | strong |
| Visit the 'White Dove of the Desert' at Mission San Xavier del Bac | Travel | Iconic landmark, near-universal "best of" pick | strong |
| Ride the canyon tram at 'Sabino Canyon' | Adventure | Signature natural landmark | strong |
| See art in a downtown museum campus at 'Tucson Museum of Art' | Arts & Culture | Flagship cultural institution | strong |
| Find a weird local shop on Fourth Ave... at the 'Fourth Avenue Shopping District' | Shopping | Defining Tucson neighborhood experience | strong |
| Tour one of the strangest science facilities in the desert at 'Biosphere 2' | Travel | Nationally-known, distinctly Tucson-area | strong |
| Visit a world-class observatory... at 'Kitt Peak National Observatory' | Travel | Flagship dark-sky attraction | strong |
| Order carne seca or a chimichanga at 'El Charro Café' | Food & drink | Century-old culinary landmark | strong |
| See a concert in a restored 1920s downtown theater at 'Rialto Theatre' | Arts & Culture | Flagship live-music venue | strong |
| Check off the 'Tucson Rodeo' — La Fiesta de los Vaqueros | Sports | Signature annual Tucson event | strong |

10 attachments → **10 of 10, gap closed exactly at the "at minimum" line. Net-new
needed: 0** for the item count itself.

**Flag, not a content problem:** this list is scoped as *universal* (no
`curated_list_metros` row), which is why it also shows as a Phoenix/Milwaukee gap even
though it's named "Best of Tucson." Attaching the 10 items above as `city_slug='tucson'`
closes the Tucson view but does nothing for Phoenix/Milwaukee/no-metro users, who'd still
see 0 — because they're not supposed to see this list at all. The actual fix here isn't
content, it's scoping: give this list a `curated_list_metros` row for `tucson` (same
pattern as Tucson Hidden Bars / Mercado District) so it stops appearing as a false gap
everywhere else. That's an admin-tool action, flagging for you rather than doing it.

---

### I Don't Live Here...Yet · Summer 2026
Just here for a long weekend. Or maybe forever. — **Tucson: 0 / gap to 10: 10**
Existing items: *Check out all the animals at the 'Phoenix Zoo'* · *Smell the flowers at
the 'Desert Botanical Garden'* · *Wander around the 'Heard Museum'* · *Eat a hot dog at
an 'Arizona Diamondbacks' game* · *Walk the loop... 'Tempe Town Lake'* · *Book a narrated
cruise on 'Lake Pleasant Cruises'* · *Ride the OdySea Voyager at 'OdySea Aquarium'* ·
*Snag a picture... at the 'Gammage Theatre'*
Season: summer 2026

**Recommended attachments:**
| Item | Category | Why it fits | Confidence |
|---|---|---|---|
| Do the 'Arizona-Sonora Desert Museum' as zoo, garden and museum | Adventure | Direct parallel to Phoenix Zoo + Desert Botanical Garden combined | strong |
| Visit the 'White Dove of the Desert' at Mission San Xavier del Bac | Travel | First-visit landmark, tourist/newcomer bucket-list tier | strong |
| Tour one of the strangest science facilities in the desert at 'Biosphere 2' | Travel | Bucket-list newcomer attraction, parallel to OdySea | strong |
| Visit a world-class observatory at 'Kitt Peak National Observatory' | Travel | Bucket-list tier | strong |
| See a concert in a restored 1920s downtown theater at 'Rialto Theatre' | Arts & Culture | Direct parallel to Gammage Theatre | strong |
| Do a compact city zoo visit at 'Reid Park Zoo' | Play | Direct parallel to Phoenix Zoo | strong |
| See art in a downtown museum campus at 'Tucson Museum of Art' | Arts & Culture | Parallel to Heard Museum | plausible |
| Start a Tucson history day inside the reconstructed 'Presidio San Agustín' | Travel | Newcomer-orientation history stop | plausible |

8 attachments → **8 of 10. Net-new still needed: 2.**

---

### Little League Parents on Parole · Summer 2026
The kids are at grandma's. Now what? — **Tucson: 4 / gap to 10: 6** (universal core: *Get
a hotel room* · *Take an old friend out to dinner* · *Send someone flowers for no
reason* · *Tell someone that you love them* — all non-venue, already Tucson-visible)
Season: summer 2026

**Recommended attachments:**
| Item | Category | Why it fits | Confidence |
|---|---|---|---|
| Taste the President's Plate or classic Sonoran comfort food at 'Mi Nidito' | Food & drink | Kid-free dinner-date venue | strong |
| Order carne seca or a chimichanga at 'El Charro Café' | Food & drink | Kid-free dinner-date venue | strong |
| Taste estate wines from Elgin at 'Los Milics' | Bar & drinks | Adults-only wine outing | strong |
| Go full brunch mode... at 'Prep & Pastry' | Food & drink | Grown-up morning-out option | plausible |
| Drink a beer and browse movies at 'Casa Film Bar' | Bar & drinks | Distinctive date-night pick | plausible |

5 attachments → **9 of 10. Net-new still needed: 1** — one item away from closed.

---

### The Brunch Bloc · Summer 2026
Saturday doesn't exist before 10am or after the third mimosa. — **Tucson: 5 / gap to 10:
5** (universal core: *Grab a coffee from somewhere other than Starbucks* · *Eat
something you've never tried before* · *Invite a new friend to join your group* · *Give a
friend a fitting nickname* · *Eat Ice Cream at a Park*)
Season: summer 2026

**Recommended attachments:**
| Item | Category | Why it fits | Confidence |
|---|---|---|---|
| Go full brunch mode with pastry-forward breakfast plates at 'Prep & Pastry' | Food & drink | The literal, direct brunch match this list is missing | strong |
| Walk botanical gardens, see art and grab brunch at 'Tohono Chul' | Arts & Culture | Second brunch anchor, different venue/angle | plausible |
| Taste the President's Plate or classic Sonoran comfort food at 'Mi Nidito' | Food & drink | Weekend-brunch-adjacent institution | plausible |
| Pick up a prickly pear caramel bonbon at 'Tucson Chocolate Factory' | Food & drink | Post-brunch treat, matches the ice-cream-at-a-park register | plausible |

4 attachments → **9 of 10. Net-new still needed: 1.**

---

### The New Kids on the Block · Summer 2026
Moved here 6 months ago. Still eating at chains. — **Tucson: 5 / gap to 10: 5** (universal
core: *Attend First Friday's* · *Meet your neighbors* · *Eat something you've never tried
before* · *Invite a new friend* · *Cruise around town with your windows open*)
Season: summer 2026

**Recommended attachments:**
| Item | Category | Why it fits | Confidence |
|---|---|---|---|
| Start a Tucson history day inside the reconstructed 'Presidio San Agustín' | Travel | Literal newcomer-orientation content — get to know your new city's origin | strong |
| Follow the painted turquoise line through downtown history on the 'Turquoise Trail Walking Tour' | Travel | Purpose-built newcomer orientation tour | strong |
| Find a weird local shop on Fourth Ave and take the streetcar at the 'Fourth Avenue Shopping District' | Shopping | "Get out of the chains" is the whole point of this list | plausible |
| Ride the streetcar from Mercado to Fourth Ave... on the 'Sun Link Tucson Streetcar' | Travel | Learn-the-city transit item | plausible |

4 attachments → **9 of 10. Net-new still needed: 1.**

---

### The Ungoogleable City · Summer 2026
I've lived here 10 years and I've never heard of that. — **Tucson: 2 / gap to 10: 8**
(universal core: *Eat something you've never tried before* · *Visit an Ethnic Festival* —
thinnest universal core in the whole report)
Season: summer 2026

**Recommended attachments:**
| Item | Category | Why it fits | Confidence |
|---|---|---|---|
| Find tiny worlds inside 'Mini Time Machine Museum of Miniatures' — Tucson's most unexpected | Misc | Literally described in its own item text as unexpected/hidden — exact tone match | strong |
| Drink a beer and browse movies at 'Casa Film Bar' | Bar & drinks | Quirky neighborhood secret, not a place most people know | strong |
| Ride the mini train, see a stunt show at 'Trail Dust Town' | Social | Retro local institution most newer residents skip | strong |
| Birdwatch at 'Sweetwater Wetlands' — a reclaimed-water wetland hiding in the middle of the city | Adventure | "Hiding" is in the item's own description — direct thematic match | strong |
| Visit Ted DeGrazia's desert-built gallery and chapel at 'DeGrazia Gallery in the Sun' | Arts & Culture | Offbeat local-artist site, low-awareness even among residents | plausible |
| Pick up a loaf from James Beard-winning baker Don Guerra at 'Barrio Bread' | Food & drink | Local-institution status without mainstream visibility | plausible |
| Browse used books, games, vinyl at 'Bookmans Entertainment Exchange' | Shopping | Local institution, not something newcomers stumble on | plausible |
| Wander a historic adobe courtyard of galleries and gifts at 'Old Town Artisans' | Shopping | Easy to have lived here years and never turned down that street | plausible |

8 attachments → **10 of 10, gap closed exactly. Net-new needed: 0.**

---

### Mercado District *(Tucson-scoped single-market list)*
**Tucson: 5 / gap to 10: 5.** Existing items are all specific to the Mercado San Agustín
complex (Seis Kitchen, BŌS Burger, Mission Garden, the Marketplace, the Annex).

**No recommended attachments.** Checked all 55 unattached Tucson items — none are
Mercado-district venues; everything else in the pool is elsewhere in Tucson. This is a
genuinely hyper-local list and the existing inventory doesn't reach it.
**Net-new needed: 5**, and it has to be net-new *at that specific complex* — no amount of
general Tucson content substitutes.

---

### Tucson Hidden Bars *(Tucson-scoped single-market list)*
**Tucson: 5 / gap to 10: 5.** Existing items are all genuine speakeasy/hidden-entrance
bars (Tough Luck Club, The Owls Club, Snake & Barrel, The Shelter, Portal).

**Recommended attachments:**
| Item | Category | Why it fits | Confidence |
|---|---|---|---|
| Drink a beer and browse movies at 'Casa Film Bar' | Bar & drinks | Distinctive/unconventional bar concept, closest tonal match available | plausible |
| Try a Tucson-brewed beer in the warehouse arts district at 'Borderlands Brewing Company' | Bar & drinks | Off-the-beaten-path arts-district location gives it some "hidden" flavor | plausible |
| Grab a beer in a colorful downtown taproom at 'Crooked Tooth Brewing Co.' | Bar & drinks | Weakest fit of the three — a known taproom, not really hidden | plausible |

3 attachments → **8 of 10. Net-new still needed: 2.** Honest caveat: none of these are
true speakeasy-style finds like the existing five — the Tucson pool has essentially
exhausted its "secret entrance" bar content. The 2 remaining items should ideally be
genuinely hidden spots, not just "a bar that happens to be unattached."

---

### Remote and Restless · Summer 2026
Work from home. Slightly feral. Needs a reason to leave. — **Tucson: 8 / gap to 10: 2**
(universal core: *Go for a walk by yourself* · *Go for a jog* · *Read a book* · *Check
out a book from your local library* · *Grab a coffee from somewhere other than
Starbucks* · *Attend First Friday's* · *Eat something you've never tried before* · *Invite
a new friend*)

**Recommended attachments:**
| Item | Category | Why it fits | Confidence |
|---|---|---|---|
| Browse used books, games, vinyl and weird Arizona finds at 'Bookmans Entertainment Exchange' | Shopping | Direct extension of the "library/read a book" WFH-break register | strong |
| Catch live music or an event at 'Hotel Congress' | Social | A concrete "reason to leave the house" | plausible |

2 attachments → **10 of 10, gap closed exactly. Net-new needed: 0.**

---

### The College Dropout · Summer 2026
Broke, free, and has nowhere to be until Tuesday. — **Tucson: 8 / gap to 10: 2**
(universal core is all free/goofy non-venue actions: water balloon fight, roll down a
hill, swing on swings, jump in a puddle, glue a quarter to steps, popsicle on the curb,
challenge friends, pub crawl)

**Recommended attachments:**
| Item | Category | Why it fits | Confidence |
|---|---|---|---|
| Find a weird local shop on Fourth Ave and take the streetcar at the 'Fourth Avenue Shopping District' | Shopping | Free/cheap wandering, broke-and-curious register | strong |
| Browse used books, games, vinyl at 'Bookmans Entertainment Exchange' | Shopping | Classic broke-college browsing spot | strong |

2 attachments → **10 of 10, gap closed exactly. Net-new needed: 0.**

---

## Phoenix

Only genuinely Phoenix content closes these — nothing in the Tucson pool applies, so no
attachments are recommended here. Flagging for a separate Phoenix-inventory pass.

| List | Effective | Gap to 10 | Existing items (sample) |
|---|---|---|---|
| Rediscover Downtown Peoria *(Peoria-scoped)* | 5 | 5 | Caldwell County BBQ · Driftwood Coffee Co. · The Monastery AZ pottery · Jefferson House · Osuna Park mosaics |
| Phoenix Hidden Gems *(Phoenix-scoped)* | 9 | 1 | Undertow tiki bar · Pigtails Downtown · Cobra Arcade Bar · Rough Rider speakeasy · Century Grand · Ghost Donkey · La Bamba · The Compass (Hyatt Regency) |
| Best of Tucson | 0 | 10 | *(see Tucson section — this is the scoping artifact, not a real Phoenix content need)* |

**Net-new Phoenix content needed: 6** (5 for Rediscover Downtown Peoria, 1 for Phoenix
Hidden Gems — Phoenix Hidden Gems is one item from closed).

---

## Milwaukee

**Only one gap: Best of Tucson (0 everywhere).** Same scoping artifact as above — not a
Milwaukee content problem. Every genuinely Milwaukee-visible list clears 10.

---

## Universal items needed

This section is the same 13 lists that show up as Tucson gaps above (the ones with
`curated_list_metros` scope = universal), but it's a **different fix**, not a duplicate
ask. Attaching a Tucson-tagged item (the recommendations above) raises the count for
Tucson users specifically — it does nothing for a no-metro user or a future 4th metro,
who only ever see `city_slug IS NULL` items. Closing this view requires genuinely
**universal** items: chain-free, doable in any metro, no specific venue named,
`is_universal = true`.

**None of the 55 unattached Tucson items qualify** — they're all real, specific venues
tied to a `neighborhood_id` by definition, which is the opposite of what a universal item
is. This entire section is net-new, full stop.

| List | `universal_only` count | Gap to 10 |
|---|---|---|
| 🏋️ Main Character Cardio · Summer 2026 | 0 | 10 |
| 💅 Ferda Girls · Summer 2026 | 0 | 10 |
| 💘 Soft Launch Season · Summer 2026 | 0 | 10 |
| 🥾 Trail Mix Crew · Summer 2026 | 0 | 10 |
| 🧃 Snack Pack Survivors · Summer 2026 | 0 | 10 |
| Best of Tucson | 0 | 10 |
| I Don't Live Here...Yet · Summer 2026 | 0 | 10 |
| The Ungoogleable City · Summer 2026 | 2 | 8 |
| Little League Parents on Parole · Summer 2026 | 4 | 6 |
| The Brunch Bloc · Summer 2026 | 5 | 5 |
| The New Kids on the Block · Summer 2026 | 5 | 5 |
| Remote and Restless · Summer 2026 | 8 | 2 |
| The College Dropout · Summer 2026 | 8 | 2 |

---

## Tucson items that fit no current gap list

10 of the 55 unattached items didn't earn a recommendation anywhere above — not because
they're bad content, but because nothing in the current 15 gap lists matches their
theme. Worth knowing as a standalone signal:

- **Spectator sports** (no current list is about watching, only doing): *Catch a local
  soccer match at Kino Sports Complex with 'FC Tucson'* · *Experience a Wildcats
  basketball game inside 'McKale Center'* · *Go to a Wildcats football game... at
  'Arizona Stadium'* · *Go to a 'Tucson Roadrunners' hockey game*
- **Casual/quick food** (existing food-forward lists lean upscale-date or brunch, not
  quick-service): *Eat a Sonoran hot dog... at 'BK Carne Asada & Hot Dogs'* · *Eat
  plant-based Mexican food at 'Tumerico'* · *Order colorful corn tortillas and tacos at
  'Taqueria Pico de Gallo'*
- **Performing arts / film** (Rialto already covers the "concert venue" niche on two
  lists above; these are adjacent but unclaimed): *See a professional theatre
  performance at 'Arizona Theatre Company'* · *See a show at 'Fox Tucson Theatre'* ·
  *Watch an indie film at 'The Loft Cinema'*

None of these are wrong for CheckOff — they just don't have a home in the current 15 gap
lists. If a "Tucson sports fan" or "local arts & film" themed list ever gets built, this
is a ready-made starting roster.

---

## Summary table 1 — all gaps, sorted by size, net-new need after recommended attachments

| List | Segment | Effective | Gap to 10 | Recommended | New total | Net-new still needed |
|---|---|---|---|---|---|---|
| Mercado District | tucson | 5 | 5 | 0 | 5 | **5** |
| Rediscover Downtown Peoria | phoenix | 5 | 5 | 0 (Phoenix, out of scope) | 5 | **5** |
| Ferda Girls | tucson | 0 | 10 | 6 | 6 | **4** |
| Main Character Cardio | tucson | 0 | 10 | 7 | 7 | **3** |
| Soft Launch Season | tucson | 0 | 10 | 7 | 7 | **3** |
| Snack Pack Survivors | tucson | 0 | 10 | 7 | 7 | **3** |
| I Don't Live Here...Yet | tucson | 0 | 10 | 8 | 8 | **2** |
| Trail Mix Crew | tucson | 0 | 10 | 8 | 8 | **2** |
| Tucson Hidden Bars | tucson | 5 | 5 | 3 | 8 | **2** |
| Little League Parents on Parole | tucson | 4 | 6 | 5 | 9 | **1** |
| The Brunch Bloc | tucson | 5 | 5 | 4 | 9 | **1** |
| The New Kids on the Block | tucson | 5 | 5 | 4 | 9 | **1** |
| Phoenix Hidden Gems | phoenix | 9 | 1 | 0 (Phoenix, out of scope) | 9 | **1** |
| Best of Tucson | tucson | 0 | 10 | 10 | 10 | **0** |
| The Ungoogleable City | tucson | 2 | 8 | 8 | 10 | **0** |
| Remote and Restless | tucson | 8 | 2 | 2 | 10 | **0** |
| The College Dropout | tucson | 8 | 2 | 2 | 10 | **0** |

*(Universal-item gaps for the 13 lists above aren't in this table — see the dedicated
section above; every one of them needs net-new universal items regardless of what's
recommended here, since no existing item qualifies as universal.)*

**Total genuinely net-new Tucson/Phoenix items needed after all recommended attachments
are approved and applied: 33** (27 Tucson + 6 Phoenix).

---

## Summary table 2 — proposed attachments (flat list for one-pass execution)

| Item title | List | Metro tag |
|---|---|---|
| Walk the paved hill at 'Tumamoc Hill' at sunrise | Main Character Cardio · Summer 2026 | tucson |
| Ride the canyon tram at 'Sabino Canyon' — then hike back down | Main Character Cardio · Summer 2026 | tucson |
| Drive or bike the Cactus Forest Loop at 'Saguaro National Park East' | Main Character Cardio · Summer 2026 | tucson |
| Bike or walk part of 'The Loop' shared path | Main Character Cardio · Summer 2026 | tucson |
| Find the short Signal Hill trail at 'Saguaro National Park West' | Main Character Cardio · Summer 2026 | tucson |
| Book a bay and compete with your crew at 'Topgolf Tucson' | Main Character Cardio · Summer 2026 | tucson |
| Climb from cactus to pine forest on the 'Mount Lemmon Scenic Byway' | Main Character Cardio · Summer 2026 | tucson |
| Go full brunch mode with pastry-forward breakfast plates at 'Prep & Pastry' | Ferda Girls · Summer 2026 | tucson |
| Taste estate wines from Elgin at 'Los Milics' | Ferda Girls · Summer 2026 | tucson |
| Pick up a prickly pear caramel bonbon at 'Tucson Chocolate Factory' | Ferda Girls · Summer 2026 | tucson |
| Shop local gifts after walking desert gardens at 'Tohono Chul' | Ferda Girls · Summer 2026 | tucson |
| Wander a historic adobe courtyard of galleries and gifts at 'Old Town Artisans' | Ferda Girls · Summer 2026 | tucson |
| Walk botanical gardens, see art and grab brunch at 'Tohono Chul' | Ferda Girls · Summer 2026 | tucson |
| Taste estate wines from Elgin at 'Los Milics' | Soft Launch Season · Summer 2026 | tucson |
| Taste the President's Plate or classic Sonoran comfort food at 'Mi Nidito' | Soft Launch Season · Summer 2026 | tucson |
| Order carne seca or a chimichanga at 'El Charro Café' | Soft Launch Season · Summer 2026 | tucson |
| Drink a beer and browse movies at 'Casa Film Bar' | Soft Launch Season · Summer 2026 | tucson |
| Grab a beer in a colorful downtown taproom at 'Crooked Tooth Brewing Co.' | Soft Launch Season · Summer 2026 | tucson |
| Try a Tucson-brewed beer in the warehouse arts district at 'Borderlands Brewing' | Soft Launch Season · Summer 2026 | tucson |
| Catch live music or an event at 'Hotel Congress' | Soft Launch Season · Summer 2026 | tucson |
| Walk the paved hill at 'Tumamoc Hill' at sunrise | Trail Mix Crew · Summer 2026 | tucson |
| Ride the canyon tram at 'Sabino Canyon' — then hike back down | Trail Mix Crew · Summer 2026 | tucson |
| Drive or bike the Cactus Forest Loop at 'Saguaro National Park East' | Trail Mix Crew · Summer 2026 | tucson |
| Find the short Signal Hill trail at 'Saguaro National Park West' | Trail Mix Crew · Summer 2026 | tucson |
| Climb from cactus to pine forest on the 'Mount Lemmon Scenic Byway' | Trail Mix Crew · Summer 2026 | tucson |
| Tour a desert cave then add a trail ride at 'Colossal Cave Mountain Park' | Trail Mix Crew · Summer 2026 | tucson |
| Birdwatch at 'Sweetwater Wetlands' | Trail Mix Crew · Summer 2026 | tucson |
| Bike or walk part of 'The Loop' shared path | Trail Mix Crew · Summer 2026 | tucson |
| Do a compact city zoo visit with giraffes, elephants at 'Reid Park Zoo' | Snack Pack Survivors · Summer 2026 | tucson |
| Let kids burn energy downtown with hands-on exhibits at 'Children's Museum Tucson' | Snack Pack Survivors · Summer 2026 | tucson |
| Play retro mini golf or arcade games on Tanque Verde at 'Golf N' Stuff' | Snack Pack Survivors · Summer 2026 | tucson |
| See a planetarium show after exploring UA campus at 'Flandrau Science Center' | Snack Pack Survivors · Summer 2026 | tucson |
| Find tiny worlds inside 'Mini Time Machine Museum of Miniatures' | Snack Pack Survivors · Summer 2026 | tucson |
| Walk among hundreds of aircraft at 'Pima Air & Space Museum' | Snack Pack Survivors · Summer 2026 | tucson |
| Find butterflies, desert plants and rotating art at 'Tucson Botanical Gardens' | Snack Pack Survivors · Summer 2026 | tucson |
| Do the 'Arizona-Sonora Desert Museum' as zoo, garden and museum | Best of Tucson | tucson |
| Visit the 'White Dove of the Desert' at Mission San Xavier del Bac | Best of Tucson | tucson |
| Ride the canyon tram at 'Sabino Canyon' | Best of Tucson | tucson |
| See art in a downtown museum campus at 'Tucson Museum of Art' | Best of Tucson | tucson |
| Find a weird local shop on Fourth Ave at the 'Fourth Avenue Shopping District' | Best of Tucson | tucson |
| Tour one of the strangest science facilities at 'Biosphere 2' | Best of Tucson | tucson |
| Visit a world-class observatory at 'Kitt Peak National Observatory' | Best of Tucson | tucson |
| Order carne seca or a chimichanga at 'El Charro Café' | Best of Tucson | tucson |
| See a concert in a restored 1920s downtown theater at 'Rialto Theatre' | Best of Tucson | tucson |
| Check off the 'Tucson Rodeo' — La Fiesta de los Vaqueros | Best of Tucson | tucson |
| Do the 'Arizona-Sonora Desert Museum' as zoo, garden and museum | I Don't Live Here...Yet · Summer 2026 | tucson |
| Visit the 'White Dove of the Desert' at Mission San Xavier del Bac | I Don't Live Here...Yet · Summer 2026 | tucson |
| Tour one of the strangest science facilities at 'Biosphere 2' | I Don't Live Here...Yet · Summer 2026 | tucson |
| Visit a world-class observatory at 'Kitt Peak National Observatory' | I Don't Live Here...Yet · Summer 2026 | tucson |
| See a concert in a restored 1920s downtown theater at 'Rialto Theatre' | I Don't Live Here...Yet · Summer 2026 | tucson |
| Do a compact city zoo visit at 'Reid Park Zoo' | I Don't Live Here...Yet · Summer 2026 | tucson |
| See art in a downtown museum campus at 'Tucson Museum of Art' | I Don't Live Here...Yet · Summer 2026 | tucson |
| Start a Tucson history day inside the reconstructed 'Presidio San Agustín' | I Don't Live Here...Yet · Summer 2026 | tucson |
| Taste the President's Plate or classic Sonoran comfort food at 'Mi Nidito' | Little League Parents on Parole · Summer 2026 | tucson |
| Order carne seca or a chimichanga at 'El Charro Café' | Little League Parents on Parole · Summer 2026 | tucson |
| Taste estate wines from Elgin at 'Los Milics' | Little League Parents on Parole · Summer 2026 | tucson |
| Go full brunch mode with pastry-forward breakfast plates at 'Prep & Pastry' | Little League Parents on Parole · Summer 2026 | tucson |
| Drink a beer and browse movies at 'Casa Film Bar' | Little League Parents on Parole · Summer 2026 | tucson |
| Go full brunch mode with pastry-forward breakfast plates at 'Prep & Pastry' | The Brunch Bloc · Summer 2026 | tucson |
| Walk botanical gardens, see art and grab brunch at 'Tohono Chul' | The Brunch Bloc · Summer 2026 | tucson |
| Taste the President's Plate or classic Sonoran comfort food at 'Mi Nidito' | The Brunch Bloc · Summer 2026 | tucson |
| Pick up a prickly pear caramel bonbon at 'Tucson Chocolate Factory' | The Brunch Bloc · Summer 2026 | tucson |
| Start a Tucson history day inside the reconstructed 'Presidio San Agustín' | The New Kids on the Block · Summer 2026 | tucson |
| Follow the painted turquoise line on the 'Turquoise Trail Walking Tour' | The New Kids on the Block · Summer 2026 | tucson |
| Find a weird local shop on Fourth Ave at the 'Fourth Avenue Shopping District' | The New Kids on the Block · Summer 2026 | tucson |
| Ride the streetcar from Mercado to Fourth Ave on the 'Sun Link Tucson Streetcar' | The New Kids on the Block · Summer 2026 | tucson |
| Find tiny worlds inside 'Mini Time Machine Museum of Miniatures' | The Ungoogleable City · Summer 2026 | tucson |
| Drink a beer and browse movies at 'Casa Film Bar' | The Ungoogleable City · Summer 2026 | tucson |
| Ride the mini train, see a stunt show at 'Trail Dust Town' | The Ungoogleable City · Summer 2026 | tucson |
| Birdwatch at 'Sweetwater Wetlands' | The Ungoogleable City · Summer 2026 | tucson |
| Visit Ted DeGrazia's gallery and chapel at 'DeGrazia Gallery in the Sun' | The Ungoogleable City · Summer 2026 | tucson |
| Pick up a loaf from Don Guerra at 'Barrio Bread' | The Ungoogleable City · Summer 2026 | tucson |
| Browse used books, games, vinyl at 'Bookmans Entertainment Exchange' | The Ungoogleable City · Summer 2026 | tucson |
| Wander a historic adobe courtyard at 'Old Town Artisans' | The Ungoogleable City · Summer 2026 | tucson |
| Drink a beer and browse movies at 'Casa Film Bar' | Tucson Hidden Bars | tucson |
| Try a Tucson-brewed beer in the warehouse arts district at 'Borderlands Brewing' | Tucson Hidden Bars | tucson |
| Grab a beer in a colorful downtown taproom at 'Crooked Tooth Brewing Co.' | Tucson Hidden Bars | tucson |
| Browse used books, games, vinyl at 'Bookmans Entertainment Exchange' | Remote and Restless · Summer 2026 | tucson |
| Catch live music or an event at 'Hotel Congress' | Remote and Restless · Summer 2026 | tucson |
| Find a weird local shop on Fourth Ave at the 'Fourth Avenue Shopping District' | The College Dropout · Summer 2026 | tucson |
| Browse used books, games, vinyl at 'Bookmans Entertainment Exchange' | The College Dropout · Summer 2026 | tucson |

**81 proposed attachments** across 15 lists (Mercado District has none — see its section
above). Several items appear on more than one list by design (e.g. Los Milics on 3, Prep
& Pastry on 3, Casa Film Bar on 4) — each row is a separate `curated_list_items` insert
with its own `id`, so reuse across lists is fine and doesn't conflict with the `UNIQUE
(curated_list_id, item_id)` constraint.
