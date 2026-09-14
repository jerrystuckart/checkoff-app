# M9 Training Requirements — Turning the Final Munich Lists into a Design Spec (Part 6)

**Analysis and proposed design only — no M9/`buildHomeListPlan`/`listFitScoring.ts` code changes made in this task.**

## What the real M9 does today (read directly, `agent-service/specialists/metroLaunchDriver.ts`)

`buildHomeListPlan` (line ~2499): builds the flagship seasonal list via `selectFlagshipList` (keyword/category/tag pattern matching against `themeable` certified items, capped at `FLAGSHIP_LIST_TARGET_SIZE = 30`), then for each `THEMED_LIST_DEFINITIONS` entry calls `buildEditorialThemedLists` (pattern/category/tag matching, min `THEMED_LIST_MIN_ITEMS = 8`) to get a candidate membership set, then runs that set through `listFitScoring.ts`'s `scoreItemsForLists` to attach an independent 0-1 fit score + INCLUDE/EXCLUDE verdict per item, purely as an auditable annotation layered on top of what `buildEditorialThemedLists` already selected — **`scoreItemsForLists`'s output is not shown filtering the list back down anywhere in this function**; `fitScores` is attached to the plan entry, but the membership itself (`theme.candidateNames`) comes from `buildEditorialThemedLists`, not from `filterCandidatesByListFit`. `listFitScoring.ts`'s own doc comments already state the right principle ("catalog membership itself contributes nothing to this score," "an item must be able to score zero fit for every list and still remain a perfectly valid catalog item") — the *scoring* module is correctly designed for catalog/list independence; what's not yet confirmed by reading this code is that `buildHomeListPlan` actually *enforces* a fit-score floor before finalizing a list's membership, as opposed to only recording the score for later human/audit review.

This matters because Munich's real final lists (rebuilt by a completely separate, external SQL process — not `buildHomeListPlan` at all) demonstrate exactly the discipline the module's doc comments describe in principle: 89/184 catalog items belong to zero lists, multi-list membership is used only for defensible distinct reasons (`10-original-vs-final-list-decisions.md`), and no list was padded with catalog filler to hit a target size. **The gap is not in the scoring math — it's in whether a future automated M9 run, using `buildHomeListPlan`'s actual selection logic (keyword/category/tag pattern matching via `buildEditorialThemedLists`), would reproduce that same discipline, or would default toward the "catalog inclusion implies list inclusion" failure mode the module's own comments warn against.** This can't be confirmed without reading `homeListThemes.ts`'s `buildEditorialThemedLists`/`selectFlagshipList` directly (out of scope for tonight's read), so it's flagged as an open question, not asserted either way.

## Required decision record per item-to-list pairing

Munich's real final lists make this concrete. A future M9 should require, for every candidate/list pairing it considers (not just the ones it includes):

```ts
interface ItemListFitDecision {
  listId: string | null           // null when proposing a brand-new list identity
  proposedListIdentity?: string   // required when listId is null
  itemId: string                  // production UUID once resolved — never body text (see 13-list-sql-generation-safeguards.md)
  verdict: 'INCLUDE' | 'EXCLUDE' | 'HOLD'
  fitScore: number                // 0-1, from listFitScoring.ts's existing scoreItemForList
  fitReason: string                // already produced by scoreItemForList — reusable as-is
  listSpecificEvidence: string    // NEW — the concrete claim-text evidence this item satisfies THIS list's promise (e.g. Hidden Gems needs a stated discoveryBasis, not just a category match)
  diversityContribution: 'CATEGORY_BALANCING' | 'GEOGRAPHIC_BALANCING' | 'NEITHER' | 'BOTH'
  geographicContribution?: string // neighborhood, flagged if it's a single-item or surrounding-municipality neighborhood
  exclusionReason?: string        // REQUIRED when verdict is EXCLUDE and the item was seriously considered (catalog-eligible, list-adjacent category/tags) — not required for items with zero plausible relevance
}
```

The `listSpecificEvidence` field is the one real gap identified against the existing `ListFitScore` shape: `scoreItemForList`'s `reason` string already explains *why the score is what it is* (which signals matched), but it does not capture the qualitative claim — e.g. for Hidden Gems, "the venue is a public shop, but the item's claim ('find the strangest treasure') is itself a discovery mechanic" (Alva Morgaine, `11-list-portfolio-scorecards.md`) is a judgment `scoreItemForList`'s category/tag/pattern signals cannot express on their own.

## Required behaviors, evaluated against what Munich's real rebuild actually did

| Required behavior | Munich evidence it's achievable | Munich evidence of the risk if unenforced |
|---|---|---|
| Catalog inclusion never implies list inclusion | 89/184 Munich items are in zero lists — proves the discipline is achievable | Winston's ORIGINAL lists (Fall 30, After Dark 10, etc.) were built entirely from generic catalog items with no distinctiveness filter — proves the failure mode is real without this rule |
| Each list curated independently | The six final lists have materially different category profiles (Munich After Dark 75% Bar & drinks; Cafés/Markets 95% Food & drink) — proves independent curation happened | n/a |
| An item may belong to no lists | 89/184 — confirmed | n/a |
| Multi-list membership only for distinct documented reasons | 43 Munich items are multi-list, and `10-original-vs-final-list-decisions.md` found no case of undocumented padding | The Kunst Oase/Vereinsheim wave1-vs-wave3 pattern (`02-new-item-contributions.md`) shows the *catalog* side of this discipline failing when reasons aren't required — the risk is real even though the *final lists* didn't repeat it |
| Seasonal and themed fit are separate judgments | Fall 2026 (seasonal) and Beer Gardens/Day Trips (themed) share several items (Andechs Bräustüberl, Weihenstephan) with different, independently valid framings per list | n/a |
| List count alone cannot justify filler | No list was found padded with filler (`11-list-portfolio-scorecards.md`) | Winston's original Hidden Gems (9 items, several duplicated from other Winston lists with zero discovery mechanic) is the counter-example this rule exists to prevent |
| Coherence prioritized over filling every category | Beer Gardens/Day Trips both stay tightly on-theme rather than diluting for category breadth | n/a |
| Repetition/geographic-concentration checked at the end | Munich After Dark's 4 "not structurally nighttime" bar items (`11-list-portfolio-scorecards.md`) show this check is still worth automating — the real list has a soft spot here that a stricter post-hoc check would have caught |
| List SQL generated only after every item identity resolves to a production UUID | **This SQL violates this principle throughout** — see `13-list-sql-generation-safeguards.md`, the single biggest reusable lesson of Part 5 |
| Completed production lists not retroactively changed unless explicitly reopened | Not evaluable from this task (no second rebuild occurred to test against) — flagged as untested, not failing |

## Proposed regression fixtures (data only, in this doc — not wired into tests)

Each fixture below is real Munich source material, cross-referenced to the actual final-list outcome:

```ts
// Proposed shape — NOT implemented, NOT wired into any test file.
// Modeled on MunichGoldStandardEntry from munichGoldStandard.ts, extended
// with the list-fit dimension munichListCurationFixtures.ts (this task's
// companion fixture file) actually implements.

const M9_TRAINING_FIXTURES = [
  {
    label: 'Strong Fall list inclusion',
    item: "Eat the cellar-made Weißwurst before noon at 'Gaststätte Großmarkthalle'.",
    list: 'Fall 2026 — Munich Metro',
    expectedVerdict: 'INCLUDE',
    note: 'Real member. Specific dish + timing constraint + independent venue.',
  },
  {
    label: 'Catalog item excluded from Fall',
    item: "Take a stadium tour at 'Allianz Arena and surrounding'.",
    list: 'Fall 2026 — Munich Metro',
    expectedVerdict: 'EXCLUDE',
    note: "Winston's original Fall-30 member; absent from the final Fall list even though it is a legitimate, still-plausible catalog experience — a real example of catalog-worthy but not this-list-worthy.",
  },
  {
    label: 'Strong nightlife inclusion',
    item: "Show up after midnight, when 'Schumann's Bar' says it truly becomes a bar.",
    list: 'Munich After Dark',
    expectedVerdict: 'INCLUDE',
    note: 'Real member. Explicit before/after-midnight claim — structurally nighttime-specific, not just a bar that happens to be open at night.',
  },
  {
    label: 'Bar-or-restaurant rejected from nightlife because not meaningfully nighttime-specific',
    item: "Choose a small-brewery pour from 14 rotating taps at 'Frisches Bier'.",
    list: 'Munich After Dark',
    expectedVerdict: 'INCLUDE (real outcome) — flagged as the WEAK case a stricter rule should reconsider',
    note: 'Real member, but the claim has no time gate at all — could truthfully be CheckOff\'d at 2pm. Included in production; `11-list-portfolio-scorecards.md` flags this as the softest membership case in the list. A future M9 rule requiring an explicit `nighttimeSpecific: boolean` justification (not just a Bar & drinks category match) would force this decision to be made deliberately rather than by category default.',
  },
  {
    label: 'Strong local-flavor inclusion',
    item: "Smell the roast and order a single-origin espresso at 'Fausto Kaffeerösterei'.",
    list: 'Cafés, Markets & Local Flavor',
    expectedVerdict: 'INCLUDE',
    note: 'Real member. Specific product + specific ritual (smell, then order) + independent business signal.',
  },
  {
    label: 'Generic restaurant rejected from local flavor',
    item: "Settle in for coffee at 'Café Maria'.",
    list: 'Cafés, Markets & Local Flavor',
    expectedVerdict: 'EXCLUDE',
    note: "Winston's original member; no specific order, no ritual — fails the list's own required bar ('a specific order/ritual/stall/product'). Also a probable catalog retirement per 01-original-70-disposition.md.",
  },
  {
    label: 'Defensible overlooked gem',
    item: "Find the carved plague dragon climbing the corner of 'Neues Rathaus'.",
    list: 'Hidden Gems',
    expectedVerdict: 'INCLUDE',
    note: 'Real member. The building is famous; the specific carved detail is genuinely overlooked — correct use of "famous building, hidden detail," distinct from mislabeling the whole landmark as hidden.',
  },
  {
    label: 'Famous attraction rejected from Hidden Gems',
    item: 'Visit a cluster of 18 museums and over 20 galleries, including Alte Pinakothek, Pinakothek der Moderne, Lenbachhaus, Museum Brandhorst, and Glyptothek at \'Kunstareal Munich\'.',
    list: 'Hidden Gems',
    expectedVerdict: 'EXCLUDE',
    note: 'Not a Hidden Gems candidate in any version of the catalog (retired outright, per 01-original-70-disposition.md) — included here as the clean "famous, not hidden, no discovery mechanic" boundary case.',
  },
  {
    label: 'One item validly fitting multiple lists',
    item: "Tour the brewhouse and storage cellars, then finish with a guided tasting at 'Weihenstephan'.",
    lists: ['Beer Gardens, Breweries & Bavarian Rituals', 'Day Trips & Big Adventures', 'Fall 2026 — Munich Metro'],
    expectedVerdict: 'INCLUDE on all three',
    note: 'Real member of all three, each for a distinct framing (brewery ritual / day-trip destination / seasonal-worthy experience) — see 10-original-vs-final-list-decisions.md.',
  },
  {
    label: 'Strong catalog item fitting no curated list',
    item: 'One of the 89 live Munich items not in any of the 6 lists (e.g. a single-item-neighborhood item not thematically aligned with any of the 6 current list identities).',
    expectedVerdict: 'zero-list membership, still catalog-valid',
    note: 'Confirms an item can be fully certified and still belong nowhere — the plurality case (89/184), not an edge case.',
  },
  {
    label: 'Category-balancing selection',
    item: "Lace up for a public-skating session on one of the ice sheets inside 'SAP Garden'.",
    list: 'Fall 2026 — Munich Metro',
    expectedVerdict: 'INCLUDE',
    note: 'Real member — the only Sports-category item in the Fall list, in a catalog where Sports sits below its healthy target (03-category-geography-comparison.md). A future rule should be able to state this explicitly as a category-balancing reason, not just a generic fit score.',
  },
  {
    label: 'Geographic-balancing selection',
    item: "Climb into the treehouse-like café at 'Gans Woanders'.",
    list: 'Fall 2026 — Munich Metro',
    expectedVerdict: 'INCLUDE',
    note: 'Real member — Ramersdorf-Perlach\'s only active item, included partly for geographic reach (16/36 Munich neighborhoods have exactly 1 item; this is one of them getting real list visibility).',
  },
  {
    label: 'Filler rejected despite an open slot',
    item: "Sample local specialties at 'Viktualienmarkt'.",
    list: 'Hidden Gems',
    expectedVerdict: 'EXCLUDE',
    note: "Winston's original Hidden Gems member (9 items — well under the module's THEMED_LIST_MIN_ITEMS=8 floor, meaning the ORIGINAL list may have been padded specifically to clear that minimum). No discovery mechanic whatsoever ('sample specialties' is the generic-action pattern Failure 7 in 05-pipeline-failure-stage-mapping.md already flags). Absent from the final Hidden Gems list.",
  },
  {
    label: 'Additional themed-list opportunity derived from a sufficiently strong cluster',
    items: ['Andechs Bräustüberl', 'Weihenstephan', 'Privatbrauerei Aying', 'ERDINGER Weißbräu', 'Ayinger Bräustüberl', '... (20 total)'],
    proposedList: 'Beer Gardens, Breweries & Bavarian Rituals',
    expectedVerdict: 'CREATE_NEW_LIST',
    note: 'Real, newly created list — see 09-final-list-rebuild-analysis.md and the "why Winston never proposed this" analysis in 15-final-calibration-implementation-plan.md. Modeled on the same detection this fixture set argues M9 should be able to perform: a category+neighborhood+pattern cluster of 20 real items sharing a specific ritual (brewery tour, monastery Brotzeit, mug-rinsing) is exactly the shape `buildEditorialThemedLists`\' pattern/category/tag matching is built to find, but `THEMED_LIST_DEFINITIONS` would need a Beer-Gardens-shaped definition registered before it could ever surface — the gap is in the definition set being static/curated, not in the matching mechanism.',
  },
]
```

## What this means for `THEMED_LIST_DEFINITIONS` specifically

The Beer Gardens and Day Trips lists prove a real, sizeable, coherent themed cluster can exist in a metro's expanded catalog with no corresponding entry in `THEMED_LIST_DEFINITIONS` at build time. Since `buildEditorialThemedLists` only finds what a *predefined* theme definition tells it to look for, a future M9 improvement worth proposing (design only, not implemented here) is a **cluster-discovery pass**: after category/neighborhood/pattern data is available for the full certified catalog, look for naturally dense clusters (e.g. "20+ items sharing a category + a small set of repeated keywords/ritual nouns not already claimed by an existing theme") and surface them as *candidate* new theme definitions for a human to approve — rather than requiring every metro's themes to be anticipated in a static, metro-agnostic definition list before the run starts. This is exactly the gap Part 4 (`15-final-calibration-implementation-plan.md`) identifies as the reason Winston never proposed Beer Gardens or Day Trips despite the underlying material clearly supporting both.
