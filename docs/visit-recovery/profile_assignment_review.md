# Visit profile assignments — rule_v1 (review)

Generated 2026-09-26 from a full catalog export (2167 rows). Rules: `lib/visitDetection/profileClassifier.js`. Tests: `profileClassifier.test.js`.

## Coverage by city (active, non-universal, geocoded items)

| City | Items | Profiled before | + rule_v1 | Profiled after | Coverage after | Left unassigned (no confident rule) |
|---|---|---|---|---|---|---|
| Phoenix Metro | 295 | 15 | 215 | 230 | 78% | 65 |
| San Diego Metro | 257 | 145 | 96 | 241 | 94% | 16 |
| Denver Metro | 208 | 0 | 164 | 164 | 79% | 44 |
| Vienna Metro | 207 | 0 | 166 | 166 | 80% | 41 |
| Tucson Metro | 168 | 0 | 120 | 120 | 71% | 48 |
| Milwaukee Metro | 116 | 0 | 82 | 82 | 71% | 34 |
| Green Bay Metro | 100 | 0 | 76 | 76 | 76% | 24 |
| Florence Metro | 91 | 90 | 0 | 90 | 99% | 1 |
| Munich Metro | 65 | 57 | 7 | 64 | 98% | 1 |

## Assignments by category × profile

| Category | quick_stop | fast_casual | restaurant | bar | retail | attraction | outdoor | event | Total |
|---|---|---|---|---|---|---|---|---|---|
| Arts & Culture | 0 | 0 | 0 | 0 | 0 | 152 | 0 | 0 | 152 |
| Bar & drinks | 0 | 0 | 0 | 202 | 0 | 0 | 0 | 0 | 202 |
| Food & drink | 73 | 0 | 253 | 0 | 0 | 0 | 0 | 0 | 326 |
| Nightlife | 0 | 0 | 0 | 53 | 0 | 2 | 0 | 0 | 55 |
| Play | 0 | 0 | 0 | 0 | 0 | 52 | 0 | 0 | 52 |
| Shopping | 0 | 0 | 0 | 0 | 60 | 0 | 0 | 0 | 60 |
| Spa & self-care | 0 | 0 | 0 | 0 | 0 | 43 | 0 | 0 | 43 |
| Sports | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 8 | 8 |
| Travel | 0 | 0 | 0 | 0 | 0 | 20 | 8 | 0 | 28 |

## Assignments by city × profile

| City | quick_stop | fast_casual | restaurant | bar | retail | attraction | outdoor | event | Total |
|---|---|---|---|---|---|---|---|---|---|
| Denver Metro | 15 | 0 | 34 | 43 | 9 | 59 | 2 | 2 | 164 |
| Green Bay Metro | 0 | 0 | 11 | 37 | 2 | 22 | 2 | 2 | 76 |
| Milwaukee Metro | 4 | 0 | 25 | 25 | 3 | 24 | 1 | 0 | 82 |
| Munich Metro | 0 | 0 | 4 | 2 | 0 | 1 | 0 | 0 | 7 |
| Phoenix Metro | 23 | 0 | 68 | 59 | 10 | 52 | 1 | 2 | 215 |
| San Diego Metro | 13 | 0 | 35 | 25 | 6 | 16 | 0 | 1 | 96 |
| Tucson Metro | 10 | 0 | 36 | 29 | 9 | 33 | 2 | 1 | 120 |
| Vienna Metro | 8 | 0 | 40 | 35 | 21 | 62 | 0 | 0 | 166 |

## Never assigned (guards) — counts over the whole catalog

| Reason | Rows |
|---|---|
| already_profiled | 343 |
| universal | 289 |
| no_confident_rule | 236 |
| inactive | 180 |
| no_coordinates | 130 |
| no_named_venue | 28 |
| no_metro | 28 |
| brief_stop_cue | 4 |
| secret | 3 |

Rows the category rules alone WOULD have assigned but a guard blocked: inactive=77, universal=5, secret=2, no_coordinates=112, no_metro=16, already_profiled=283 (so each guard is load-bearing, and `manual_only` rows are never overwritten: 4 such rows untouched).

## Samples (up to 3 per category × profile, spread across cities)

**Arts & Culture → attraction** (152)

- Tucson Metro: Walk the edible history rows at 'Mission Garden' — Tucson's food story grows beside the Santa Cruz River, from Hohokam t
- Phoenix Metro: Browse the local artwork on the walls at 'Arts HQ Gallery'
- Milwaukee Metro: Walk through 'China Lights' after dark — Boerner Botanical Gardens becomes a glowing world of enormous lanterns

**Bar & drinks → bar** (202)

- Milwaukee Metro: Get a beer in the outdoor beer garden at 'Titletown Brewing Co' and stay for at least two
- Phoenix Metro: Catch happy hour and order the sliders at 'Legends Bar & Grill'
- Tucson Metro: Taste estate wines from Elgin at 'Los Milics' — the Sonoita wine corridor's most decorated vineyard, now pouring in a hi

**Food & drink → quick_stop** (73)

- Phoenix Metro: Get the prickly pear soft serve twist with a lime dip at 'Topo' — a $2.50 Arizona original next to the water tower in do
- Milwaukee Metro: Order a scoop of something you've never tried at 'Wilson's Ice Cream' — open since 1906
- Tucson Metro: Crack through the caramelized cinnamon crust of the Snickerdoodle Pancake at ‘Baja Cafe’

**Food & drink → restaurant** (253)

- Phoenix Metro: Order an appetizer at 'Citizen Public House'
- Milwaukee Metro: Order the beer brat at 'State Street Brats' — no trip to Madison is complete without it
- Tucson Metro: Take a seat at the monthly five course Tu Nidito Chef's Table at 'The Coronet' — 20 percent of the evening is donated an

**Nightlife → attraction** (2)

- Milwaukee Metro: Take the ghost tour inside 'Shaker's Cigar Bar' — the former speakeasy and brothel has more stories than most museums
- Denver Metro: Watch a show from the 100-seat balcony inside the old movie palace at 'The Oriental Theater'

**Nightlife → bar** (53)

- Milwaukee Metro: Show up at 'High Noon Saloon' on a night you didn't plan for and catch whatever's playing
- Phoenix Metro: Order a Hacker-Pschorr with a fat lemon slice at 'George & Dragon'
- Denver Metro: Walk beneath the lights at 'Larimer Square' after dark

**Play → attraction** (52)

- Phoenix Metro: Race a full heat at 'Andretti Indoor Karting & Games'
- Milwaukee Metro: Ride something at 'Bay Beach Amusement Park' for a quarter — yes an actual quarter
- Tucson Metro: Tour tonight's sky inside 'Flandrau Science Center' — then check for public telescope viewing after the planetarium show

**Shopping → retail** (60)

- Phoenix Metro: Shop at 'Biltmore Fashion Park'
- Tucson Metro: Wander through a historic adobe courtyard of galleries, gifts and local art at 'Old Town Artisans'.
- Milwaukee Metro: Test out the furniture before you buy at 'Steinhafels'

**Spa & self-care → attraction** (43)

- Milwaukee Metro: Try an Ayurvedic treatment at 'Neroli Salon & Spa'
- Phoenix Metro: Enjoy a facial at 'LeMonds - Aveda Salon at The Wigwam'
- Tucson Metro: Walk the stone labyrinth at ‘Sanctuary Cove’ — leave your phone untouched until you return to the entrance

**Sports → event** (8)

- Phoenix Metro: Watch a game inside one of the eight miniature MLB ballparks at ‘Cactus Yards’ — Fenway, Wrigley and Yankee Stadium have
- Tucson Metro: Catch a local soccer match at Kino Sports Complex with 'FC Tucson'.
- Denver Metro: Watch part of a game on the giant outdoor screen at 'McGregor Square'

**Travel → attraction** (20)

- Milwaukee Metro: Walk the full loop around the 'Wisconsin State Capitol' at golden hour and stop when the light hits the dome
- Tucson Metro: Visit the 'White Dove of the Desert' at Mission San Xavier del Bac and take a free docent-led tour.
- Phoenix Metro: Stay after dark and walk the district at 'Westgate Entertainment District'

**Travel → outdoor** (8)

- Milwaukee Metro: Walk through 'Heritage Hill State Historical Park' and find the oldest building on the property
- Phoenix Metro: Watch the city lights reflect off the water at 'Tempe Town Lake'
- Tucson Metro: Stay after sunset at 'Gates Pass' — wait for the overlook to empty and let the stars replace the view

