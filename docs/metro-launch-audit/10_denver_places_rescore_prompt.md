# Fix two similarity-scoring bugs in geocode-denver-items.js, re-run only the 53 WEAK/NONE rows

Paste into Claude Code from inside the `checkoff` repo. This follows the Pass 1 run reported back
already (`scripts/output/denver-geocode-2026-08-22.csv`: 96 STRONG / 46 WEAK / 7 NONE). I reviewed
that CSV directly and found two real bugs in `scripts/geocode-denver-items.js`'s similarity
scoring — this prompt fixes them and re-runs only the affected 53 rows, at roughly $1.70
additional Places API cost (53 calls @ $32/1000), not the full $4.77 again.

## Guardrails

* Still dry-run only — no writes to `items`, `geo_corrections`, or any other table.
* Do NOT re-run the 96 already-STRONG items — they don't need re-billing for this fix.
* Do NOT touch `scripts/geocode-items.js` (the other metros' re-geocode tool).
* Do NOT commit or push.

## Bug 1 — `extractBusinessName()` grabs the first quoted phrase, not the last

```js
function extractBusinessName(body) {
  const match = (body || '').match(/'([^']+)'|"([^"]+)"|‘([^’]+)’/)
  return match ? (match[1] || match[2] || match[3]) : body
}
```

`.match()` without the `g` flag returns only the first match. Every item body in this catalog
follows the convention "... at 'Venue Name'" — the venue is always the *last* quoted phrase, not
the first. This silently breaks on any body with 2+ quotes, which includes every one of the 43
items Checkoffized earlier in this project (e.g. "...the five-course 'Ellington Experience'
beneath the Art Deco staircase at 'Nocturne'" extracts "Ellington Experience" instead of
"Nocturne").

Fix: find *all* quoted matches and take the last one. Before trusting this for all 53 rows, verify
the "last quote is always the venue name" assumption actually holds across all 53 target bodies —
if you find a body where it doesn't, don't force it, flag that specific item_id instead.

## Bug 2 — the query-based similarity signal is diluted by the query's own suffix, and ignores a stronger signal that already exists

```js
const simVsQuery = similarity(returnedName, item.maps_query)
```

`item.maps_query` includes a trailing ", City, CO" (or, for the ~30 "hidden gem" items whose
`maps_query` already contains a full street address, the entire address). Comparing a short
returned name like "Linger" against "Linger, Denver, CO" tanks the Levenshtein ratio purely from
length difference, independent of whether the match is right.

Two fixes, both additive (keep taking the max across all signals — don't remove the existing
ones):

1. Strip everything from the first comma onward in `maps_query` before comparing (i.e. compare
   against just the business-name portion), as a third `simVsQueryName` signal.
2. For the items whose `maps_query` contains a street address (a number followed by a street name
   before the first comma), add an explicit address-match check: extract the leading street number
   from `maps_query` and check whether it appears in `formattedAddress`. If it does, that's strong
   independent evidence of a correct match — treat it as satisfying the STRONG bar on its own
   (still subject to the existing `!multipleCandidates` requirement), regardless of what the text
   similarity score says. Record which promotion path fired (name-similarity vs. address-match) in
   a new CSV column so it's auditable, not just asserted.

Keep the `multipleCandidates` (`places.length > 1`) gate exactly as-is — it already caught a real
problem (see below) and isn't part of what's broken.

## Re-run scope

Re-run the fixed logic against only these 53 item_ids (the current WEAK + NONE set) — do not
re-fetch by `maps_lat IS NULL` (all 149 still qualify by that filter since nothing's been
committed yet; you need the explicit list of 53 ids from the existing CSV, not a fresh DB query).
Append `num_candidates_returned` as a new CSV column on this re-run (not present in the original
run) so a future review can tell "genuinely low similarity" apart from "good match, but ambiguous
result count" without guessing.

Write the re-run to `scripts/output/denver-geocode-rescore-<today's date>.csv` (all 53 rows, not
merged into the original file — I want to diff old vs. new, not overwrite).

## Specific items to call out explicitly in your report, regardless of how they reclassify

* **`de1208e6` (Denver Zoo Conservation Alliance → "Denver Zoo")** — this is very likely correct
  (the venue rebranded; Google Places may still show the old/shorter name) but no text-similarity
  fix will make "Denver Zoo Conservation Alliance" score high against "Denver Zoo" — flag this one
  for manual acceptance rather than expecting the algorithm to resolve it.
* **`a7df3180` (Tennyson Street Cultural District → "Art District on Santa Fe")** — 6.2km away, a
  genuinely different and well-known Denver district. This is a bad `maps_query`, not a scoring
  bug — propose a more specific replacement query (e.g. include a cross-street or the district's
  own address range) rather than expecting a re-run with the same query to fix it.
* **`cd98da3e` (Brewhop Trolley)** — returned zero results entirely. This is a mobile tour
  service and may not have a fixed Places listing at all; flag for manual sourcing (e.g. their
  ticketing page's pickup address) rather than retrying the same query.
* **`b05c509c` (The Art of Cheese, Longmont)** — perfect name similarity (1.0) but 11.3km from
  Longmont's center, and only WEAK because of `multipleCandidates`. Check what the *other*
  candidate(s) Places returned for this query were (the API response has them even though the
  script only keeps `places[0]`) — that'll likely show a same-named business in a different town,
  confirming the bias radius or query needs tightening rather than this being a scoring-formula
  problem.
* **`7789de88` (Larimer Street murals → "Denver - Love This City Mural")** — the item's body is
  intentionally generic ("choose your favorite mural"), so there may not be one single correct
  Places result at all. Note this as a product question (accept any mural along that street as
  correct? anchor to the street/neighborhood's own coordinates instead?) rather than a matching
  problem to solve.

## Report back

1. The two bug fixes as diffs (not applied in place to the existing dated CSV — this is a new
   script run, but if you changed `geocode-denver-items.js` itself, show me that diff too).
2. Before/after match_signal counts for the 53 re-run rows.
3. The full re-run CSV and its path.
4. For every row that's STILL WEAK or NONE after the fix, explicit reasoning why (ambiguous
   candidates? a bad query? a genuine rebrand/name mismatch no algorithm fix will solve?) — I want
   the final "needs a human" list to be as small and well-justified as possible, not a residual
   pile with no explanation.
5. Direct answers on the five specific items called out above.
6. Confirmation nothing was written to any table, nothing committed or pushed.
