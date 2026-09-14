// agent-service/playbooks/__fixtures__/munichGoldStandard.ts
//
// STANDALONE FIXTURE — NOT WIRED INTO ANY TEST OR PIPELINE CODE.
//
// A sanitized, deterministic regression fixture derived from the real
// Munich metro build (Winston's original 70-item/10-neighborhood catalog,
// and the external "Bulk Add Agent" rebuild that took it to 184 items
// across 36 neighborhoods). See
// docs/metro-launch-audit/munich/calibration-analysis/06-gold-standard-fixture-proposal.md
// for the full analysis this fixture is drawn from and the recommended
// next steps for actually consuming it in tests.
//
// Every entry below is either (a) a close paraphrase of a real Munich
// item/candidate with only cosmetic changes (no production secrets,
// credentials, or personal information included — these are all public
// venue names and publicly-visible CheckOff-style descriptions), or
// (b) a synthetic entry modeled on a real documented pattern where no
// single real example fully demonstrated the case. Each entry's comment
// says which.
//
// Shape follows SeedCandidateInput from ../seedPortfolioAudit.ts.

import type { SeedCandidateInput } from '../seedPortfolioAudit'

export interface MunichGoldStandardEntry {
  /** Short label for what failure mode / success pattern this entry demonstrates. */
  label: string
  /** Real, paraphrased, or synthetic — see file header. */
  provenance: 'real-paraphrased' | 'synthetic-modeled-on-real-pattern'
  candidate: SeedCandidateInput
  /** What a correct M5_75 (or later-stage) evaluation should conclude, for a future test to assert against. Not itself an assertion — this fixture makes no assertions. */
  expectedVerdictNote: string
}

export const MUNICH_GOLD_STANDARD_CANDIDATES: readonly MunichGoldStandardEntry[] = [
  // ---------------------------------------------------------------------
  // Strong, distinctive candidates across every required experience type
  // ---------------------------------------------------------------------
  {
    label: 'Strong independent restaurant with a specific order',
    provenance: 'real-paraphrased',
    candidate: {
      name: 'Gaststätte Großmarkthalle',
      category: 'Food & drink',
      neighborhood: 'Sendling',
      claimSupported: "Eat the cellar-made Weißwurst before noon at 'Gaststätte Großmarkthalle'.",
      address: 'Sendling, Munich, Germany',
      placeId: null,
      ownershipType: 'UNKNOWN_REQUIRES_VERIFICATION',
    },
    expectedVerdictNote: 'Specific dish + a real constraint (before noon) — should evaluate READY.',
  },
  {
    label: 'Strong café or bakery experience',
    provenance: 'real-paraphrased',
    candidate: {
      name: 'Café Frischhut',
      category: 'Food & drink',
      neighborhood: 'Altstadt-Lehel',
      claimSupported: "Watch an Auszogne hit the fryer at dawn at 'Café Frischhut'.",
      address: 'Altstadt-Lehel, Munich, Germany',
    },
    expectedVerdictNote: 'Specific, time-bound, sensory action — should evaluate READY.',
  },
  {
    label: 'Strong bar or nightlife experience',
    provenance: 'real-paraphrased',
    candidate: {
      name: 'SPIN Listening Bar',
      category: 'Bar & drinks',
      neighborhood: 'Ludwigsvorstadt-Isarvorstadt',
      claimSupported: "Choose a record-side soundtrack with your drink at 'SPIN Listening Bar'.",
      address: 'Ludwigsvorstadt-Isarvorstadt, Munich, Germany',
    },
    expectedVerdictNote: 'Concept-specific action — should evaluate READY.',
  },
  {
    label: 'Strong retail or maker experience',
    provenance: 'real-paraphrased',
    candidate: {
      name: 'Magnus Bauch',
      category: 'Shopping',
      neighborhood: 'Sendling',
      claimSupported: "Buy a house-made Munich sausage from fourth-generation butcher 'Magnus Bauch'.",
      address: 'Sendling, Munich, Germany',
      ownershipType: 'INDEPENDENT_LOCAL',
    },
    expectedVerdictNote: 'Named generational ownership + specific product — should evaluate READY, strong commercial-mix contributor.',
  },
  {
    label: 'Strong play, adventure, or wellness experience',
    provenance: 'real-paraphrased',
    candidate: {
      name: 'DAV Kletter- und Boulderzentrum Thalkirchen',
      category: 'Adventure',
      neighborhood: 'Thalkirchen',
      claimSupported: "Climb the tallest route you can finish at 'DAV Kletter- und Boulderzentrum Thalkirchen'.",
      address: 'Thalkirchner Straße 207, 81371 München, Germany',
    },
    expectedVerdictNote: 'Concrete personal-challenge framing — should evaluate READY.',
  },
  {
    label: 'Essential Arts & Culture item',
    provenance: 'real-paraphrased',
    candidate: {
      name: 'Asamkirche',
      category: 'Arts & Culture',
      neighborhood: 'Altstadt-Lehel',
      claimSupported: "Step from the shopping street into the maximalist private chapel 'Asamkirche'.",
      address: 'Altstadt-Lehel, Munich, Germany',
    },
    expectedVerdictNote: 'Specific, surprising framing of a landmark — should evaluate READY; contributes to Arts & Culture minimum without over-concentrating it.',
  },

  // ---------------------------------------------------------------------
  // Secret mechanics
  // ---------------------------------------------------------------------
  {
    label: 'Genuine secret mechanic with evidence',
    provenance: 'synthetic-modeled-on-real-pattern',
    candidate: {
      name: 'HiT Bar',
      category: 'Bar & drinks',
      neighborhood: 'Altstadt-Lehel',
      claimSupported: "Find the rooftop bar hidden inside 'Haus im Tal'.",
      address: 'Altstadt-Lehel, Munich, Germany',
      isSecretClaimed: true,
      secretEvidence: {
        // Synthetic evidence shape — no such evidence record exists for the
        // real venue today (the live research_verifier contract does not
        // populate this field for any real Munich candidate; see
        // calibration-analysis/00-executive-summary.md). This models what a
        // SUPPORTED secret evidence record should look like once that
        // contract exists, for a future test to assert isSecretRetained === true.
        sourceUrl: 'https://example-verified-local-guide.test/hit-bar-rooftop',
        sourceType: 'LOCAL_EDITORIAL_GUIDE',
        confidence: 'HIGH',
      } as unknown as SeedCandidateInput['secretEvidence'],
    },
    expectedVerdictNote: 'With real supported evidence, isSecretRetained should be true and verdict READY.',
  },
  {
    label: '"Hidden gem" wording that is not actually secret',
    provenance: 'real-paraphrased',
    candidate: {
      name: 'Alva Morgaine',
      category: 'Shopping',
      neighborhood: 'Ludwigsvorstadt-Isarvorstadt',
      claimSupported: "Find the strangest wearable treasure in the vintage cabinet of curiosities at 'Alva Morgaine'.",
      address: 'Ludwigsvorstadt-Isarvorstadt, Munich, Germany',
      isSecretClaimed: true,
      secretEvidence: null,
    },
    expectedVerdictNote: '"Find the..." is editorial voice, not a verified secret — isSecretClaimed true but no evidence, so isSecretRetained should be false while the item can still be READY on its own merits (claim is stripped, item is not rejected, per seedPortfolioAudit.ts adjustment 5).',
  },

  // ---------------------------------------------------------------------
  // Duplicate handling — modeled directly on the real Kunst Oase / Vereinsheim case
  // ---------------------------------------------------------------------
  {
    label: 'Duplicate venue with slightly different spelling/wording',
    provenance: 'real-paraphrased',
    candidate: {
      name: 'Vereinsheim',
      category: 'Nightlife',
      neighborhood: 'Schwabing',
      claimSupported: "Join the pub quiz or catch a tiny concert at 'Vereinsheim'.",
      address: 'Occamstraße 8, 80802 München, Germany',
    },
    expectedVerdictNote: 'Real Munich case: this exact venue was later re-proposed with different wording ("Play along with \'Königs Musik-Express\'...") and BOTH were inserted live with no dedup. A future seedDuplicateNormalization.ts pass should cluster this with the entry below via SAME_NORMALIZED_NAME and route both to HOLD.',
  },
  {
    label: 'Duplicate venue — second, differently-worded proposal for the same venue',
    provenance: 'real-paraphrased',
    candidate: {
      name: 'Vereinsheim',
      category: 'Nightlife',
      neighborhood: 'Schwabing',
      claimSupported: "Play along with 'Königs Musik-Express', the quiz-and-live-music night at 'Vereinsheim'.",
      address: 'Occamstraße 8, 80802 München, Germany',
    },
    expectedVerdictNote: 'Paired with the entry above — real Munich outcome was both inserted as separate live items. Gold-standard expectation: HOLD both pending explicit review, not silent dual-insertion.',
  },
  {
    label: 'Two valid distinct experiences at one venue',
    provenance: 'real-paraphrased',
    candidate: {
      name: 'Kunst Oase',
      category: 'Shopping',
      neighborhood: 'Schwabing',
      claimSupported: "Find an antique lamp among the ceiling-high collection at 'Kunst Oase'.",
      address: 'Hohenzollernstraße, München, Germany',
    },
    expectedVerdictNote: 'Paired with the entry below at the same venue but a genuinely different physical zone/experience (main floor vs. basement). Real Munich outcome: both inserted live. Gold-standard question this pair exists to force: should SAME_NORMALIZED_NAME clustering distinguish "same venue, same experience" from "same venue, distinct experience," or should every same-name cluster require the same manual HOLD review regardless? Currently seedDuplicateNormalization.ts treats both alike (by design — see its own doc: "must never be silently merged or silently kept as if reviewed").',
  },
  {
    label: 'Two valid distinct experiences at one venue (basement counterpart)',
    provenance: 'real-paraphrased',
    candidate: {
      name: 'Kunst Oase',
      category: 'Shopping',
      neighborhood: 'Schwabing',
      claimSupported: "Follow the antique mirrors into the basement and find your favorite chandelier among hundreds at 'Kunst Oase'.",
      address: 'Hohenzollernstraße, München, Germany',
    },
    expectedVerdictNote: 'See pair above.',
  },

  // ---------------------------------------------------------------------
  // Structural / quality failure modes
  // ---------------------------------------------------------------------
  {
    label: 'Improperly combined businesses',
    provenance: 'real-paraphrased',
    candidate: {
      name: 'Beirut Beirut and Backsteinchen at Luise-Kiesselbach-Platz',
      category: 'Food & drink',
      neighborhood: 'Sendling-Westpark',
      claimSupported:
        "Order Lebanese street food from Beirut Beirut or try breakfast and rent sports equipment at the new Backsteinchen café in 'Beirut Beirut and Backsteinchen at Luise-Kiesselbach-Platz'.",
      address: 'Luise-Kiesselbach-Platz 1B, 81377 München, Germany',
    },
    expectedVerdictNote: 'Real original-70 item that did not survive into the live catalog under this form. Two unrelated independent businesses bundled behind an "or" — should be REJECTed or split into two separate single-business candidates before READY.',
  },
  {
    label: 'Malformed venue name',
    provenance: 'real-paraphrased',
    candidate: {
      name: 'Flaucher – riverside leisure stretch on the Isar with beer garden, barbecues, swimming and natural setting',
      category: 'Adventure',
      neighborhood: 'Sendling',
      claimSupported:
        "Barbecue along the Isar, swim in the river, and relax at the Zum Flaucher beer garden at 'Flaucher – riverside leisure stretch on the Isar with beer garden, barbecues, swimming and natural setting'.",
      address: 'Isarauen, 81379 München, Germany',
    },
    expectedVerdictNote: 'Real original-70 item, later manually rewritten to name "Flaucher" with body "Grill on the Isar riverbank, then cool off with a swim at \'Flaucher\'." — the single most extreme malformed-name example found in the whole Munich dataset. A name-hygiene check (not yet implemented anywhere in the read pipeline code) should flag this before it reaches M6.5.',
  },
  {
    label: 'Generic "visit" or "check out" action',
    provenance: 'real-paraphrased',
    candidate: {
      name: 'Goldmarie',
      category: 'Food & drink',
      neighborhood: 'Ludwigsvorstadt-Isarvorstadt',
      claimSupported: "Savor an Alpine cuisine dish at 'Goldmarie'.",
      address: 'Schmellerstraße 23, 80337 München, Germany',
    },
    expectedVerdictNote: 'Real original-70 item, one of 14 probable retirements identified in this analysis. checkDistinctiveExperience should mark this generic — expected verdict REJECT.',
  },
  {
    label: 'National chain or unsuitable commercial candidate',
    provenance: 'synthetic-modeled-on-real-pattern',
    candidate: {
      name: 'Starbucks Marienplatz',
      category: 'Food & drink',
      neighborhood: 'Altstadt-Lehel',
      claimSupported: "Order a seasonal latte at the Marienplatz 'Starbucks'.",
      address: 'Marienplatz, 80331 München, Germany',
      ownershipType: 'NATIONAL_OR_INTERNATIONAL_CHAIN',
    },
    expectedVerdictNote: 'No real Munich chain candidate was found in any of the four accepted-candidate CSVs (the Bulk Add process appears to have simply never proposed one) — this entry is synthetic, modeled on categoryPolicy.ts\'s evaluateCommercialMix needing a NATIONAL_OR_INTERNATIONAL_CHAIN example to test against. Expected: counted against commercial-mix local-percentage minimum, not auto-rejected outright (ownership alone doesn\'t reject a candidate in the read code — only the aggregate mix gate does).',
  },
  {
    label: 'Missing ownership evidence',
    provenance: 'real-paraphrased',
    candidate: {
      name: 'Fausto Kaffeerösterei',
      category: 'Food & drink',
      neighborhood: 'Obergiesing-Fasangarten',
      claimSupported: "Smell the roast and order a single-origin espresso at 'Fausto Kaffeerösterei'.",
      address: 'Birkenleiten 43, 81543 München, Germany',
      // ownershipType intentionally omitted — this is the REAL, universal
      // state of every actual Munich candidate today (see
      // calibration-analysis/00-executive-summary.md): omitted resolves to
      // UNKNOWN_REQUIRES_VERIFICATION per SeedCandidateInput's own doc
      // comment, never silently treated as INDEPENDENT_LOCAL.
    },
    expectedVerdictNote: 'Representative of all 184 live Munich items (0 have partner_id set, and no CSV/SQL artifact ever captured ownership as structured data). Should count toward the commercial-mix UNKNOWN_REQUIRES_VERIFICATION volume threshold, not be assumed independent.',
  },
  {
    label: 'Missing Place ID',
    provenance: 'real-paraphrased',
    candidate: {
      name: 'Steinheil 16',
      category: 'Food & drink',
      neighborhood: 'Maxvorstadt',
      claimSupported: "Take on the famously oversized schnitzel at 'Steinheil 16'.",
      address: null,
      placeId: null,
    },
    expectedVerdictNote: 'Representative of 135/184 (73%) of live Munich items, which have no google_place_id. Sourced from a wave1 "R"-tier candidate ("Official venue website; verify current URL and Places record during intake") — accepted at full score despite this gap; see calibration-analysis/02-new-item-contributions.md.',
  },

  // ---------------------------------------------------------------------
  // Geography
  // ---------------------------------------------------------------------
  {
    label: 'Central Munich neighborhood',
    provenance: 'real-paraphrased',
    candidate: {
      name: 'Man Versus Machine',
      category: 'Food & drink',
      neighborhood: 'Ludwigsvorstadt-Isarvorstadt',
      claimSupported: "Order a flat white with the cinnamon-loaded Franzbrötchen at 'Man Versus Machine'.",
      address: 'Ludwigsvorstadt-Isarvorstadt, Munich, Germany',
    },
    expectedVerdictNote: 'One of the original 10 canonical neighborhoods — no geography question.',
  },
  {
    label: 'Outer neighborhood (real Munich Stadtbezirk missing from the original 10)',
    provenance: 'real-paraphrased',
    candidate: {
      name: 'Giesinger Bräustüberl',
      category: 'Bar & drinks',
      neighborhood: 'Obergiesing-Fasangarten',
      claimSupported: "Order a Giesinger beer brewed just uphill from 'Giesinger Bräustüberl'.",
      address: 'Martin-Luther-Straße 2, 81539 München, Germany',
    },
    expectedVerdictNote: 'Real, administratively legitimate Munich Stadtbezirk that Winston\'s original M1 geography map never surfaced — should PASS a future M1 completeness check against the full 25-Stadtbezirk enumeration.',
  },
  {
    label: 'Surrounding metro municipality — explicitly excluded in m0.json, later added anyway',
    provenance: 'real-paraphrased',
    candidate: {
      name: 'Dachau Palace',
      category: 'Adventure',
      neighborhood: 'Dachau',
      claimSupported: "Look all the way to the Alps from the ridge-top garden at 'Dachau Palace'.",
      address: 'Schlossstraße 7, 85221 Dachau, Germany',
    },
    expectedVerdictNote: 'Real live item. m0.json\'s own geographicScope text names Dachau as explicitly excluded "for this initial launch." This entry exists to force a future M0/M1 boundary-reconciliation check to confront the contradiction directly — see calibration-analysis/03-category-geography-comparison.md.',
  },

  // ---------------------------------------------------------------------
  // Verdict-boundary cases
  // ---------------------------------------------------------------------
  {
    label: 'Candidate that appropriately receives HOLD',
    provenance: 'synthetic-modeled-on-real-pattern',
    candidate: {
      name: 'Kunst Oase',
      category: 'Shopping',
      neighborhood: 'Schwabing',
      claimSupported: "Browse the antique collection at 'Kunst Oase'.",
      address: 'Hohenzollernstraße, München, Germany',
    },
    expectedVerdictNote: 'A third, generic-adjacent proposal for the same already-clustered venue — should HOLD both for the duplicate-cluster reason AND for weak distinctiveness, whichever the evaluator surfaces first.',
  },
  {
    label: 'Candidate that appropriately receives REJECT',
    provenance: 'real-paraphrased',
    candidate: {
      name: 'Kunstareal Munich',
      category: 'Arts & Culture',
      neighborhood: 'Maxvorstadt',
      claimSupported:
        'Visit a cluster of 18 museums and over 20 galleries, including Alte Pinakothek, Pinakothek der Moderne, Lenbachhaus, Museum Brandhorst, and Glyptothek at \'Kunstareal Munich\'.',
      address: '80333 Munich-Maxvorstadt, Germany',
    },
    expectedVerdictNote: 'Real original-70 item, not found live. "Visit a cluster of 18 museums" is the most generic possible action, and the "venue" is a whole district, not one business — its constituent museums are separately and specifically represented elsewhere in the live catalog. Expected verdict REJECT.',
  },
] as const
