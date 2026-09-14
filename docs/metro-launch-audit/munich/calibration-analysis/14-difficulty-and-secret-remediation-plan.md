# Difficulty & Secret Remediation Plan (Part 7)

**A plan only. No update SQL is included or should be inferred from this file. `difficulty` remains `1` and `is_secret` remains `false` for all 184 live Munich items unless and until Jerry reviews and a separate, explicit remediation pass is executed.**

## Why this matters more than it looks

Every one of Munich's 184 active items — the 9 UUID-certain rewrites, the ~47 name-matched originals, and all ~128 items added since — is `difficulty=1` and `is_secret=false`. `00-executive-summary.md` and `03-category-geography-comparison.md` already established this as unchanged by the Bulk Add process; this file is the first place a concrete, evidence-based rubric plus a real per-item queue is proposed.

## Part A — Difficulty rubric

### Proposed rule

Difficulty should evaluate **the experience itself**, never venue fame, and never be distributed for the sake of variety. Concrete evidence-based factors, in rough order of how often they actually appear in Munich's real catalog:

| Factor | Raises difficulty when... | Munich examples |
|---|---|---|
| Cost | The experience requires a meaningful paid admission/ticket beyond an ordinary meal/drink price | Therme Erding admission, SAP Garden skate session, KartPalast Funpark |
| Advance booking / scheduling | The experience cannot be walked into — it requires a reservation, a guided tour slot, or a specific scheduled event | Juristische Bibliothek's "book the official guided visit," Weihenstephan's guided tasting, Andechs's VR-glasses tour |
| Timing restriction | The experience is only available/valid during a narrow window, not "any time the venue is open" | Café Frischhut's "at dawn," Augustiner-Keller's "when the bell announces a fresh barrel," Munich Hot Springs' "Sunday 11 AM" |
| Physical effort / skill | The experience requires real physical exertion or a trained skill, not just showing up | DAV Kletter- und Boulderzentrum's climbing challenge, Surftown MUC's standing-wave surf session, Maisinger Schlucht's hike |
| Travel distance | The experience requires leaving central Munich, with real transit/driving time | Every Day Trips & Big Adventures list item (Erding ~35km, Andechs ~35km, Starnberg ~25km) |
| Limited availability | The experience is capacity-constrained, seasonal, or otherwise not reliably repeatable on demand | Giesinger Grünspitz Mitbringdinner's hard-coded "September 20, 2026" date (flagged in `02-new-item-contributions.md` as a durability risk — also a difficulty-adjacent signal: a one-off event is a different completion profile than a standing venue) |
| Special ordering / completion complexity | The experience requires knowing to ask for something not on a visible menu, or completing a multi-step process | Alva Morgaine's "find the strangest treasure" (browse-and-choose, not order-and-done) |

**None of these factors is venue prestige.** A famous landmark with a walk-up, no-cost, no-booking experience (Marienplatz, a public church interior) should score low; an obscure but logistically demanding venue should score high. This is the explicit correction the rubric makes against a "famous = hard" or "obscure = hard" intuition, either of which would misclassify Munich's real catalog.

### Proposed 1/5/10/25 bands

- **1 (walk-in, no friction):** no cost beyond an ordinary purchase, no booking, no travel beyond central Munich, no physical/skill requirement, available essentially any normal operating hours.
- **5 (one planning step):** requires ONE of: a modest admission fee, a same-day/short-notice reservation, a narrow-but-daily timing window (e.g. "before noon," "at dawn"), or travel to a close-in outer neighborhood (a real Munich Stadtbezirk outside the original 10, still inside the city).
- **10 (real advance commitment):** requires TWO or more of the level-5 factors, OR a single higher-cost/higher-commitment factor: a genuinely advance-booked guided tour, a meaningful admission price tied to a specific attraction, or travel to a surrounding metro municipality (Erding, Freising, Starnberg, etc.).
- **25 (a planned trip, not a stop):** requires significant travel time (a genuine day-trip distance) COMBINED WITH either a paid, booked activity or a real physical/skill challenge — i.e., the experience is realistically its own outing, not something folded into a day of central-Munich exploring.

### Worked examples from the real 184-item catalog

| Item | Rubric walk-through | Proposed difficulty | Confidence |
|---|---|---|---|
| "Sip a coffee at the legendary coffee counter inside 'Dallmayr'." | No cost beyond a coffee, no booking, central Munich, no skill/timing gate | **1** | Deterministic |
| "Take on the famously oversized schnitzel at 'Steinheil 16'." | No booking required for a walk-in meal (though a popular restaurant may need a same-day wait), central Munich, no travel | **1** | Deterministic |
| "Squeeze into Munich's smallest bar, 'Barroom'." | Walk-in, central, no cost beyond a drink | **1** | Deterministic |
| "Watch an Auszogne hit the fryer at dawn at 'Café Frischhut'." | Central, no booking, no real cost gate — BUT a real timing restriction ("at dawn" is a genuine, narrow window most visitors will not naturally be there for) | **5** | Deterministic — timing factor alone is enough to move it off 1 |
| "Book the official guided visit to see the Art Nouveau spiral staircases inside 'Juristische Bibliothek'." | Explicit advance booking required, central Munich (no travel factor) | **5** | Deterministic |
| "Float beneath real palm trees in the glass-domed thermal pools at 'Therme Erding'." | Meaningful paid admission AND travel to a surrounding municipality (~35km) — two factors | **10** | Deterministic |
| "Tour the brewhouse and storage cellars, then finish with a guided tasting at 'Weihenstephan'." | Advance-bookable guided tour AND travel to Freising (~35km) | **10** | Deterministic |
| "Lace up for a public-skating session on one of the ice sheets inside 'SAP Garden'." | Admission/rental cost, some physical activity, but central Munich, no travel, no advance-booking requirement confirmed | **5** | Requires review — physical-effort weighting for a low-intensity, walk-in-friendly activity like public skating is a judgment call, not fully deterministic |
| "Climb the tallest route you can finish at 'DAV Kletter- und Boulderzentrum Thalkirchen'." | Real skill/physical-effort factor, day-pass cost, central-adjacent (Thalkirchen, inside the city) | **5** | Deterministic on the physical-effort factor; would be 10 if the venue required advance class booking, which is not confirmed either way |
| "Book a session on the artificial surf wave at 'Surftown MUC'." | Advance booking AND a real physical/skill requirement AND travel to Hallbergmoos (near the airport, outer municipality) | **10-25** | Requires review — this is a genuine boundary case between "one demanding outer-municipality booking" (10) and "the whole visit is realistically its own trip" (25); Hallbergmoos is closer-in than Erding/Andechs, which argues for 10, but surf-specific booking + skill argues toward 25 |
| "Bring your own Brotzeit or carry a tray of monastery food with an Andechser beer into 'Andechs Bräustüberl'." | No admission cost, no booking, BUT real travel (~35km) to a village destination that most visitors would treat as a half-day trip | **10** | Deterministic on travel distance alone; not 25 because there's no paid/booked/skill component once you arrive |
| "Race electric karts around the multi-level track at 'KartPalast Funpark'." | Paid, timed session; likely bookable; outer-municipality (Bergkirchen, ~25km) travel | **10** | Deterministic |
| "Hike the shaded gorge path along Maisinger Bach through 'Maisinger Schlucht'." | Real physical effort (a hike) AND travel to Starnberg-area outer geography (~25-35km) | **25** | Deterministic — both a real day-trip distance and a genuine physical-effort component, the clearest 25 in the sample |

**Items deterministically classifiable without further research:** the majority of the catalog — any item whose claim text already states a clear cost/booking/timing/travel/physical fact (roughly two-thirds of the worked sample above resolves cleanly). **Items requiring review:** anything where the physical-effort or booking-requirement fact is implied but not explicit in the body text (SAP Garden, DAV Kletter-, Surftown MUC above) — these need either a source check (does the venue actually require advance booking?) or a human call on how much weight a moderate-intensity activity should carry.

## Part B — Secret-status review

### Proposed rule

`is_secret=true` requires a **concrete, supported mechanic**: a concealed/unmarked entrance, a hidden room, an off-menu item, a secret drink/order, an unusual access route, a hidden exit, or a comparable structural fact. It must **not** be inferred from: "hidden gem" framing, local-popularity language, general obscurity, or evocative/discovery-style descriptive language alone (the exact over-inference the task brief warns against). `is_secret=false` is preserved as the default unless the evidence clears this bar.

### Real Hidden-Gems-list items, worked as the review queue

| Item | Concrete mechanic present? | Verdict | Evidence needed if verifying |
|---|---|---|---|
| "Find the rooftop bar hidden inside 'Haus im Tal'." | Claims "hidden inside" — a spatial-concealment claim (the bar is inside/atop another building, not obviously signposted from the street) | **Requires verification** | Confirm whether the rooftop entrance is genuinely unmarked/hard to find from street level, vs. simply an upstairs bar with a normal sign. This is the single most secret-shaped claim in the whole catalog and the best real candidate for `is_secret=true` if verified — but "requires verification" not "supported," since no source evidence exists in any artifact read for this task. |
| "Find the strangest wearable treasure in the vintage cabinet of curiosities at 'Alva Morgaine'." | No concealment claim at all — the shop itself is an openly public retail business; "find the strangest X" is a browse-and-choose mechanic, not a hidden-access mechanic | **Unsupported for `is_secret`** | None — this should stay `is_secret=false` regardless of further research. It is correctly classified as a "hidden gem" in the *editorial/discovery* sense (see `11-list-portfolio-scorecards.md`) but that is a different claim than a structural secret. This is the clean negative example the task brief asks for. |
| "Descend into the tiny basement Boazn 'Zur Gruam'." | "Descend into... tiny basement" — physical, below-street-level concealment is a real, specific structural claim | **Requires verification** | Confirm the basement entrance isn't obviously marked (many basement bars in Munich do have visible street-level signage even for a below-grade entrance) |
| "Drink one of the three house beers inside the former public toilet under 'Boazn' at Ludwigsbrücke." | "Under... former public toilet" — a genuinely unusual, structurally concealed access route (adaptive reuse of a below-bridge former-toilet building) | **Requires verification, strongest candidate after Haus im Tal** | Confirm the space is not clearly signed/marketed by the venue itself, which would undercut the "hidden" framing even with an unusual physical location |
| "Use the late-night bottle shop built into 'BROY' for a Munich craft beer after normal shop hours." | "Built into... after normal shop hours" — an access-timing mechanic (available outside normal retail hours), not a concealment mechanic | **Unsupported for `is_secret` as currently worded** | This is a genuine special-access case but the *mechanism* is time-gating, not concealment — the rubric's "unusual access route" category could arguably stretch to cover it, but a conservative read keeps this `false` unless the bottle shop is itself physically hidden within BROY (not established) |
| "Find the self-built witch's cottage bar 'Hexenhäusl' beside the Grünspitz." | "Self-built... beside" — describes an unusual, homemade structure, not concealment; "beside" implies visible adjacency, not hiding | **Unsupported** | None — distinctive and quirky, not secret |
| "Find the carved plague dragon climbing the corner of 'Neues Rathaus'." | "Find the carved... corner of" — a famous, fully public building; the detail is small/overlooked but the building itself is maximally unhidden | **Unsupported, and a good negative example of "famous attraction incorrectly labeled hidden"** | None — this is architecture-detail discovery, not a secret |
| "Have a beer inside the converted rail bus 'Minna Thiel'." | "Converted rail bus" is a distinctive physical fact, not a concealment claim | **Unsupported** | None |

**Verdict pattern:** across the 8 real candidates reviewed, 2 (Haus im Tal, 'Boazn' at Ludwigsbrücke) have a genuinely secret-shaped structural claim and are the correct starting point if Jerry wants to spend verification effort; 1 (Zur Gruam) is a softer version of the same pattern; the remaining 5 are correctly `is_secret=false` and should stay that way regardless of further research — their "hidden gem" framing is legitimate editorial voice (discovery-basis, per `11-list-portfolio-scorecards.md`) but not a secret-mechanic claim.

### What this proposes, concretely

- **Items safe for deterministic correction:** none, technically — even the strongest candidates (Haus im Tal, 'Boazn' at Ludwigsbrücke) require a real evidence check (a source confirming the entrance is actually unmarked/non-obvious) before flipping `is_secret=true`, per the rubric's own "requires concrete, supported mechanic" bar. This is a deliberate, conservative recommendation: **nothing in this file should be auto-applied.**
- **Items requiring research:** Haus im Tal, 'Boazn' at Ludwigsbrücke, Zur Gruam (secret-status verification); the difficulty boundary cases flagged in Part A (SAP Garden, DAV Kletter-, Surftown MUC).
- **Items requiring Jerry's judgment (not resolvable by more research alone):** whether the difficulty rubric's exact point-band boundaries (the 5/10/25 cutoffs proposed above) match his intended user experience of "difficulty," and whether he wants any Munich items to actually receive `is_secret=true` at all as a matter of editorial policy (a metro can legitimately ship with zero verified secrets if none clear the bar — this file does not assume secrets must exist just because "Hidden Gems" is a list name).

### Future UUID-based remediation structure (not executable, proposed shape only)

```sql
-- PROPOSED SHAPE ONLY — NOT AN EXECUTABLE MIGRATION. Every item_id below
-- is a placeholder; a real remediation pass must resolve each item's
-- actual production UUID (SELECT id FROM items WHERE body = '...' once,
-- capture it, then use ONLY the UUID from that point forward — see
-- 13-list-sql-generation-safeguards.md's core lesson) rather than
-- re-matching by body text at update time.

-- UPDATE public.items SET difficulty = 5  WHERE id = '<Café Frischhut item_id>';
-- UPDATE public.items SET difficulty = 10 WHERE id = '<Therme Erding item_id>';
-- UPDATE public.items SET difficulty = 25 WHERE id = '<Maisinger Schlucht item_id>';
-- UPDATE public.items SET is_secret = true, secret_reveal_text = '<verified reveal text>'
--   WHERE id = '<Haus im Tal item_id>' -- ONLY after source verification, never from wording alone
```

**Explicitly: no update SQL is included in this task's deliverables, executable or otherwise, beyond the illustrative placeholder above. `difficulty` remains 1 and `is_secret` remains false for all 184 live items as of this analysis.**
