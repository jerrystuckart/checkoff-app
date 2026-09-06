// Chief — Item Intake (San Diego "Winston Night Shift," 2026-09). Pure,
// reusable logic for the permanent Jerry-facing Item Intake workflow.
//
// ARCHITECTURE (explicit, per Jerry's requirement): this module owns only
// the deterministic pieces — schema/category/tag/SQL shape, duplicate
// detection, and specificity qualification. It does NOT resolve a venue
// from a screenshot, does NOT do live web research, and does NOT author
// final CheckOff wording itself:
//   - venue resolution (name/URL/screenshot -> real business)  -> the
//     ChatGPT Item Intake conversation (has image understanding; Winston
//     does not have an image-input provider today — see module doc below,
//     never faked)
//   - live web research (verify open, find the hook, confirm tags)      -> a
//     research provider (research_verifier specialist, when Winston drives
//     this programmatically) or ChatGPT's own browsing (phone workflow)
//   - CheckOff wording/editorial judgment  -> OpenAI/ChatGPT exclusively
//     (agent-service/specialists/openAiAdapter.ts via checkoff_editor's
//     SPECIALIST_EXCLUSIVE_PROVIDER — see remoteAiExecutor.ts). Claude
//     Code must never author this.
//   - repo/code maintenance, this module itself                        -> Claude Code
//
// This module is what a future Winston-driven (not phone-ChatGPT-driven)
// Item Intake tool would call once venue resolution + research have
// already produced a candidate + a claimed specific fact — it validates
// that fact is genuinely specific (reusing the exact same discipline as
// EDITORIAL_GATE), builds the category/tag/SQL shape, and checks for
// duplicates. It never guesses a fact, a category, or a tag name.

import { classifyCategory, type CanonicalCategory } from './categoryNormalization'
import { CANONICAL_TO_DB_CATEGORY, type RealDbCategory, normalizeMapsQuery } from './metroCatalog'

// ---------------------------------------------------------------------------
// 1. Specificity qualification — "does this candidate even deserve an item?"
// ---------------------------------------------------------------------------

export interface QualificationInput {
  venueName: string
  /** The single specific fact/hook a research pass found — e.g. "signature dish is the cacio e pepe doughnuts." NOT a full CheckOff sentence — this module never authors wording. */
  claimedHook: string | null
}

export interface QualificationResult {
  qualifies: boolean
  reason: string
}

/**
 * The hard intake acceptance rule (San Diego CheckOffization quality bar,
 * carried forward from the metro-launch pipeline's EDITORIAL_GATE):
 * a venue existing, being popular, or being submitted is never sufficient.
 * There must be a claimed hook, and that hook must name something concrete
 * — not just confirm the venue is good. Reuses the identical generic-
 * language detection as metroCatalog.ts's EDITORIAL_GATE so a venue can
 * never sneak through Item Intake with weaker scrutiny than a full metro
 * launch gets.
 */
const GENERIC_HOOK_WORDS = new Set([
  'good', 'great', 'popular', 'nice', 'delicious', 'tasty', 'authentic', 'amazing', 'best', 'top',
  'famous', 'well-known', 'well', 'known', 'quality', 'fresh', 'local', 'favorite', 'cozy', 'unique',
  'serves', 'has', 'offers', 'with',
])
/**
 * Bare category nouns — "serves tacos" or "tasty burgers" must NOT
 * qualify just because they contain a food/venue-type word. A real hook
 * names a SPECIFIC dish/feature ("the barbacoa de borrego," "the cacio e
 * pepe doughnuts"), not just the category of thing a place generically
 * serves. This is the exact "generic tacos" regression the hard
 * rejection rule exists to prevent.
 */
const GENERIC_CATEGORY_NOUNS = new Set([
  'tacos', 'taco', 'burgers', 'burger', 'pizza', 'food', 'drinks', 'drink', 'cocktails', 'cocktail',
  'coffee', 'museum', 'store', 'shop', 'nightlife', 'exhibits', 'exhibit', 'restaurant', 'bar', 'menu',
  'dishes', 'dish', 'meals', 'meal', 'seafood', 'sushi', 'ramen', 'pasta', 'breakfast', 'brunch', 'dinner',
])

export function qualifyCandidate(input: QualificationInput): QualificationResult {
  const hook = (input.claimedHook ?? '').trim()
  if (!hook) {
    return { qualifies: false, reason: 'No specific hook was found for this venue — existing, being popular, or being submitted is never enough on its own.' }
  }
  const hasProperNounOrNumber = /\d/.test(hook) || /(?<!^)\b[A-Z][a-zà-öø-ÿ]/.test(hook)
  const words = hook
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  const distinguishingWords = words.filter((w) => w.length > 2 && !GENERIC_HOOK_WORDS.has(w) && !GENERIC_CATEGORY_NOUNS.has(w))
  const hasConcreteDetail = hasProperNounOrNumber || distinguishingWords.length >= 2
  if (!hasConcreteDetail) {
    return { qualifies: false, reason: `The claimed hook ("${hook}") is too generic — it names only a category of thing (a food type, "good," "popular") rather than one specific dish/feature/activity/fact.` }
  }
  return { qualifies: true, reason: 'Hook names a concrete, specific detail.' }
}

// ---------------------------------------------------------------------------
// 2. Category determination — deterministic, reuses the same canonical
//    taxonomy and real-DB mapping as the metro-launch catalog pipeline.
//    Never guesses a category with no real-DB equivalent.
// ---------------------------------------------------------------------------

export interface CategoryResult {
  dbCategory: RealDbCategory | null
  failed: boolean
  reason: string | null
}

export function determineCategory(rawCategoryHint: string | null): CategoryResult {
  const classification = classifyCategory(rawCategoryHint)
  if (!classification.canonical) {
    return { dbCategory: null, failed: true, reason: `"${rawCategoryHint ?? '(none given)'}" did not match any canonical category — needs a human decision, not a guess.` }
  }
  const dbCategory = CANONICAL_TO_DB_CATEGORY[classification.canonical as CanonicalCategory]
  if (!dbCategory) {
    return { dbCategory: null, failed: true, reason: `Canonical category "${classification.canonical}" has no confirmed real production category.` }
  }
  return { dbCategory, failed: false, reason: null }
}

// ---------------------------------------------------------------------------
// 3. Tag selection — validated against a REAL, caller-supplied tag name
//    list (e.g. read live from `public.tags`, or a cached export of it).
//    This module never invents a tag name, and never proceeds with fewer
//    than 8 confirmed-real names.
// ---------------------------------------------------------------------------

export interface TagSelectionInput {
  /** Exactly the tag names a human/research pass proposed — 5 "tier 1" (core, confidence 1.0) + 3 "tier 2" (secondary, confidence 0.9), matching the real production convention (denver_coffee_bakery_12_insert.sql). */
  tier1: string[]
  tier2: string[]
  /** The real, current tag vocabulary this proposal must be validated against — this module has no DB access itself, so the caller supplies it (a live `SELECT name FROM tags` result, or as much of it as was checked). */
  knownRealTagNames: ReadonlySet<string>
}

export interface TagSelectionResult {
  valid: boolean
  tier1: string[]
  tier2: string[]
  /** Any proposed name not found in knownRealTagNames — a hard failure, never silently dropped or substituted. */
  unknownNames: string[]
}

export function validateTagSelection(input: TagSelectionInput): TagSelectionResult {
  const all = [...input.tier1, ...input.tier2]
  const unknownNames = all.filter((name) => !input.knownRealTagNames.has(name))
  const rightCount = input.tier1.length === 5 && input.tier2.length === 3
  return {
    valid: unknownNames.length === 0 && rightCount,
    tier1: input.tier1,
    tier2: input.tier2,
    unknownNames,
  }
}

// ---------------------------------------------------------------------------
// 4. Duplicate detection — same-venue-is-not-automatically-duplicate
//    discipline as candidateMerge.ts/metroCatalog.ts. Exact normalized
//    maps_query match against production = true duplicate. A same-venue
//    match with different claimed hook text is flagged for human
//    judgment, never auto-rejected or auto-accepted.
// ---------------------------------------------------------------------------

export interface DuplicateCheckInput {
  candidateMapsQuery: string
  candidateHook: string
  /** Existing production rows at/near this venue — from a real query against `items` (agent_service has SELECT on `items`), never fabricated. */
  existingItemsAtVenue: ReadonlyArray<{ mapsQuery: string; body: string }>
}

export type DuplicateVerdict = 'NO_MATCH' | 'EXACT_DUPLICATE' | 'SAME_VENUE_NEEDS_REVIEW'

export interface DuplicateCheckResult {
  verdict: DuplicateVerdict
  reason: string
}

export function checkForDuplicate(input: DuplicateCheckInput): DuplicateCheckResult {
  const candidateKey = normalizeMapsQuery(input.candidateMapsQuery)
  const exactVenueMatches = input.existingItemsAtVenue.filter((e) => normalizeMapsQuery(e.mapsQuery) === candidateKey)
  if (exactVenueMatches.length === 0) {
    return { verdict: 'NO_MATCH', reason: 'No existing item at this exact venue/address.' }
  }
  const hookLower = input.candidateHook.toLowerCase()
  const identicalHook = exactVenueMatches.some((e) => e.body.toLowerCase().includes(hookLower) || hookLower.includes(e.body.toLowerCase()))
  if (identicalHook) {
    return { verdict: 'EXACT_DUPLICATE', reason: 'An existing item at this venue already covers the same specific hook.' }
  }
  return {
    verdict: 'SAME_VENUE_NEEDS_REVIEW',
    reason: `${exactVenueMatches.length} existing item(s) at this venue, but with a different hook — may be a legitimately distinct experience (e.g. a dish + a hidden bar). Needs a human/editorial judgment call, not an automatic accept or reject.`,
  }
}

// ---------------------------------------------------------------------------
// 5. SQL generation — the small, clean, single-item template (never the
//    300-line defensive-migration style of a full metro batch). Every ID
//    is resolved by name via subquery, matching the proven production
//    pattern (denver_coffee_bakery_12_insert.sql) — never a hardcoded/
//    invented UUID.
// ---------------------------------------------------------------------------

export interface ItemIntakeProposal {
  venueName: string
  checkoffizedItem: string
  categoryName: RealDbCategory
  neighborhoodName: string
  checkinType: 'tap' | 'gps' | 'photo'
  mapsQuery: string
  hasAlcohol: boolean
  isRecurring: boolean
  tier1Tags: string[]
  tier2Tags: string[]
}

function sqlDollarQuote(text: string, tag: string): string {
  let t = tag
  while (text.includes(`$${t}$`)) t += 'x'
  return `$${t}$${text}$${t}$`
}

/** Builds the exact small SQL block for the Item Intake response template (docs/checkoff-item-intake-chatgpt-instructions.md's §12). Pure string generation — never executed by this module or by Winston; always handed to a human to run. */
export function buildItemIntakeSql(proposal: ItemIntakeProposal): string {
  const lines: string[] = []
  lines.push('BEGIN;')
  lines.push('')
  lines.push('DO $$')
  lines.push('DECLARE')
  lines.push('  v_category_id uuid;')
  lines.push('  v_neighborhood_id uuid;')
  lines.push('  v_item_id uuid;')
  lines.push('BEGIN')
  lines.push(`  SELECT id INTO v_category_id FROM public.categories WHERE name = ${sqlDollarQuote(proposal.categoryName, 'cat')};`)
  lines.push(`  IF v_category_id IS NULL THEN RAISE EXCEPTION 'Category not found: %', ${sqlDollarQuote(proposal.categoryName, 'cate')}; END IF;`)
  lines.push('')
  lines.push(`  SELECT id INTO v_neighborhood_id FROM public.neighborhoods WHERE name = ${sqlDollarQuote(proposal.neighborhoodName, 'nb')} AND is_active = true;`)
  lines.push(`  IF v_neighborhood_id IS NULL THEN RAISE EXCEPTION 'Neighborhood not found: %', ${sqlDollarQuote(proposal.neighborhoodName, 'nbe')}; END IF;`)
  lines.push('')
  lines.push('  INSERT INTO public.items (')
  lines.push('    body, category_id, neighborhood_id, checkin_type, maps_query,')
  lines.push('    is_universal, is_active, is_approved, is_recurring, difficulty,')
  lines.push('    photo_required, has_alcohol')
  lines.push('  ) VALUES (')
  lines.push(`    ${sqlDollarQuote(proposal.checkoffizedItem, 'body')},`)
  lines.push(`    v_category_id, v_neighborhood_id, ${sqlDollarQuote(proposal.checkinType, 'ct')}, ${sqlDollarQuote(proposal.mapsQuery, 'mq')},`)
  lines.push(`    false, true, true, ${proposal.isRecurring}, 1,`)
  lines.push(`    false, ${proposal.hasAlcohol}`)
  lines.push('  )')
  lines.push('  RETURNING id INTO v_item_id;')
  lines.push('')
  lines.push('  INSERT INTO public.item_tags (item_id, tag_id, source, confidence)')
  lines.push('  SELECT v_item_id, t.id, \'auto\', 1.0')
  lines.push('  FROM public.tags t')
  lines.push(`  WHERE t.name IN (${proposal.tier1Tags.map((t) => sqlDollarQuote(t, 't1')).join(', ')});`)
  lines.push('')
  lines.push('  INSERT INTO public.item_tags (item_id, tag_id, source, confidence)')
  lines.push('  SELECT v_item_id, t.id, \'auto\', 0.9')
  lines.push('  FROM public.tags t')
  lines.push(`  WHERE t.name IN (${proposal.tier2Tags.map((t) => sqlDollarQuote(t, 't2')).join(', ')});`)
  lines.push('')
  lines.push('  IF (SELECT count(*) FROM public.item_tags WHERE item_id = v_item_id) <> 8 THEN')
  lines.push(`    RAISE EXCEPTION 'Expected 8 tags for %, found %. One or more tag names do not exist in production.', ${sqlDollarQuote(proposal.venueName, 'venue')}, (SELECT count(*) FROM public.item_tags WHERE item_id = v_item_id);`)
  lines.push('  END IF;')
  lines.push('END $$;')
  lines.push('')
  lines.push('COMMIT;')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// 6. The consolidated validation pipeline — everything above, run in
//    order, stopping at the first failure. This is what a future
//    Winston-programmatic Item Intake tool (not the phone/ChatGPT path)
//    would call once it has a candidate + hook + tag proposal in hand.
// ---------------------------------------------------------------------------

export interface ItemIntakeValidationInput {
  venueName: string
  claimedHook: string | null
  rawCategoryHint: string | null
  tagProposal: TagSelectionInput
  duplicateCheck: DuplicateCheckInput
}

export interface ItemIntakeValidationResult {
  accepted: boolean
  qualification: QualificationResult
  category: CategoryResult
  tags: TagSelectionResult
  duplicate: DuplicateCheckResult
  /** Human-readable summary of exactly why this was accepted/rejected — never silent. */
  summary: string
}

export function validateItemIntakeCandidate(input: ItemIntakeValidationInput): ItemIntakeValidationResult {
  const qualification = qualifyCandidate({ venueName: input.venueName, claimedHook: input.claimedHook })
  const category = determineCategory(input.rawCategoryHint)
  const tags = validateTagSelection(input.tagProposal)
  const duplicate = checkForDuplicate(input.duplicateCheck)

  const accepted = qualification.qualifies && !category.failed && tags.valid && duplicate.verdict !== 'EXACT_DUPLICATE'

  const reasons: string[] = []
  if (!qualification.qualifies) reasons.push(`qualification: ${qualification.reason}`)
  if (category.failed) reasons.push(`category: ${category.reason}`)
  if (!tags.valid) reasons.push(`tags: ${tags.unknownNames.length > 0 ? `unknown tag name(s): ${tags.unknownNames.join(', ')}` : 'wrong tier counts (need 5 + 3)'}`)
  if (duplicate.verdict === 'EXACT_DUPLICATE') reasons.push(`duplicate: ${duplicate.reason}`)

  return {
    accepted,
    qualification,
    category,
    tags,
    duplicate,
    summary: accepted ? 'Candidate accepted.' : `Candidate rejected — ${reasons.join('; ')}`,
  }
}
