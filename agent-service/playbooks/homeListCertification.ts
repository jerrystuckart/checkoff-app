// agent-service/playbooks/homeListCertification.ts
//
// Chief Phase 2U — permanent Home-visible list certification, converted
// from the biggest San Diego architecture discovery: Winston did not
// originally understand the complete app list architecture. Rows in
// `curated_lists` / `curated_list_items` / `curated_list_metros` are NOT
// sufficient for a Home-visible official/themed list — the actual
// runtime read path (confirmed live, `screens/HomeScreen.jsx`) is:
//
//   public.lists WHERE is_official = true AND is_public = true AND metro_id = <metro>
//   membership from public.list_items
//
// San Diego's curated lists existed and were active but never appeared
// in the app until corresponding official `public.lists` rows were
// created and their memberships mirrored into `public.list_items`. This
// module makes that the permanent, testable certification methodology —
// "rows exist" is never conflated with "the actual runtime query would
// return it."
//
// This module has NO DB access of its own (same discipline as every
// other playbook module in this repo) — every certification function
// takes already-queried row shapes as input. The caller is responsible
// for actually running the real query described in each function's own
// doc against the live `public` schema before certifying — this module
// only encodes WHAT that query result must show, never fabricates it.

import type { StagingGateResult } from './metroCatalog'

// ---------------------------------------------------------------------------
// public.lists — the actual Home-visibility-governing table.
// ---------------------------------------------------------------------------

export interface HomeListRow {
  /** A caller-chosen label for reporting only (e.g. "FALL 2026 — San Diego Metro") — never used for matching logic. */
  label: string
  exists: boolean
  isOfficial: boolean
  isPublic: boolean
  metroId: string | null
  /** The metro_id this list is EXPECTED to belong to — supplied by the caller so a metro-id mismatch is caught, not just "some metro_id is set." */
  expectedMetroId: string
  startsAt: string | null
  endsAt: string | null
  goesPublicAt: string | null
  /** True only when this list is meant to be the primary featured/seasonal list — themed lists are correctly is_featured_eligible=false per San Diego's own precedent (Fall Nights & Hidden San Diego, etc.), so this field is checked against `expectedFeaturedEligible`, never assumed true. */
  isFeaturedEligible: boolean
  expectedFeaturedEligible: boolean
  /** The real `public.list_items` row count for this list. */
  listItemsCount: number
  /** The count of items this list was BUILT with (the intended membership size) — compared against listItemsCount to catch a partial/incomplete mirror. */
  expectedItemCount: number
  /** Every list_items row's item_id resolves to a real, current items.id — false if the mirror references a stale/deleted/renamed item. */
  everyMembershipResolves: boolean
  /** Whether this list requires a hero/card image per product convention, and whether one is actually populated. */
  requiresImage: boolean
  hasImage: boolean
  /** Whether a live simulation of the actual HomeScreen.jsx query (is_official=true AND is_public=true AND metro_id=<metro>) actually returns this row — the final, decisive check; everything else above is diagnostic detail for WHY it would or wouldn't. */
  returnedByRuntimeQuery: boolean
}

export interface HomeListCertificationFinding {
  label: string
  issues: string[]
}

export interface HomeListCertificationResult {
  gate: StagingGateResult
  findings: HomeListCertificationFinding[]
}

/**
 * Certifies one Home-visible list row against every requirement Part 1
 * and Part 4/5 of docs/metro-launch-playbook.md establish, not merely
 * "the row exists." A list that exists with is_official=false, or the
 * wrong metro_id, or zero list_items, or a membership referencing a
 * deleted item, or a required-but-missing hero image, is NOT Home-ready
 * even though a naive "does the row exist" check would say it is.
 */
export function certifyHomeListRow(row: HomeListRow): HomeListCertificationFinding {
  const issues: string[] = []
  if (!row.exists) {
    issues.push('no row exists in public.lists at all — curated_lists/curated_list_items alone never satisfy Home visibility')
    return { label: row.label, issues }
  }
  if (!row.isOfficial) issues.push('is_official is not true')
  if (!row.isPublic) issues.push('is_public is not true')
  if (row.metroId !== row.expectedMetroId) issues.push(`metro_id (${row.metroId ?? 'NULL'}) does not match the expected metro (${row.expectedMetroId})`)
  if (row.isFeaturedEligible !== row.expectedFeaturedEligible) {
    issues.push(`is_featured_eligible is ${row.isFeaturedEligible}, expected ${row.expectedFeaturedEligible} (themed lists are correctly NOT featured-eligible; only the primary seasonal/flagship list should be)`)
  }
  if (row.listItemsCount !== row.expectedItemCount) {
    issues.push(`public.list_items count (${row.listItemsCount}) does not match the intended membership size (${row.expectedItemCount}) — the mirror from the catalog is incomplete or stale`)
  }
  if (!row.everyMembershipResolves) issues.push('at least one public.list_items row does not resolve to a real current item — a broken/stale membership')
  if (row.requiresImage && !row.hasImage) issues.push('required hero/card image is not populated — this is a presentation blocker, not something Jerry should discover after activation')
  if (!row.returnedByRuntimeQuery) {
    issues.push('the actual HomeScreen.jsx runtime query (is_official=true AND is_public=true AND metro_id=<metro>) does NOT return this row — this is the decisive, final check; every other field above is diagnostic only')
  }
  return { label: row.label, issues }
}

export function evaluateHomeListCertificationGate(rows: readonly HomeListRow[]): HomeListCertificationResult {
  if (rows.length === 0) {
    return { gate: { key: 'HOME_LIST_CERTIFICATION_GATE', verdict: 'FAIL', reason: 'No Home-visible lists were evaluated — a metro launch requires at least the primary seasonal/flagship list.' }, findings: [] }
  }
  const findings = rows.map(certifyHomeListRow)
  const failing = findings.filter((f) => f.issues.length > 0)
  if (failing.length > 0) {
    return {
      gate: {
        key: 'HOME_LIST_CERTIFICATION_GATE',
        verdict: 'FAIL',
        reason: `${failing.length}/${rows.length} intended Home-visible list(s) failed certification: ${failing.map((f) => `${f.label} [${f.issues.join('; ')}]`).join(' | ')}`,
      },
      findings,
    }
  }
  return {
    gate: { key: 'HOME_LIST_CERTIFICATION_GATE', verdict: 'PASS', reason: `All ${rows.length} intended Home-visible list(s) certified against the real public.lists/public.list_items runtime read path — every row is_official/is_public/metro_id/image/membership-correct, and the actual runtime query returns each one.` },
    findings,
  }
}

// ---------------------------------------------------------------------------
// PRE_APPLY package validation — Chief Phase 2AM (2026-09-11).
//
// evaluateHomeListCertificationGate() above is a POST_APPLY check: it
// requires `row.exists`/`returnedByRuntimeQuery`, which can only be true
// AFTER Jerry has actually run the generated SQL against production. Using
// it (or anything derived from it) to decide whether a package is "ready
// to apply" is a category error — it makes every brand-new metro's own
// not-yet-applied package permanently unable to reach readiness, since the
// rows it's ABOUT to create can never pre-exist.
//
// This is the PRE_APPLY counterpart: it validates the generated SQL/package
// itself — never a live DB read — proving the package WOULD create exactly
// the intended lists, with the right title/official/public/metro-ownership
// flags and the right item membership, before it's ever run. Absence of
// production rows is expected and never checked here.
// ---------------------------------------------------------------------------

export interface HomeListPackagePlanEntry {
  label: string
  title: string
  expectedMetroSlug: string
  expectedOfficial: boolean
  expectedPublic: boolean
  expectedFeaturedEligible: boolean
  /** The list's intended membership size, from the driver's own HomeListPlanEntry.itemCandidateNames — never re-derived here. */
  expectedItemCount: number
  /** Whether the generated SQL text actually contains a `public.lists` insert for this EXACT title with is_official=true/is_public=true and the expected metro ownership — computed by derivePackageValidationFromSql, never assumed true just because the plan says so. */
  sqlCreatesListCorrectly: boolean
  /** The count of `public.list_items` link statements the generated SQL text actually contains for this list's own section — compared against expectedItemCount. */
  sqlLinkedItemCount: number
}

export function certifyHomeListPackageEntry(entry: HomeListPackagePlanEntry): HomeListCertificationFinding {
  const issues: string[] = []
  if (/^themed list:/i.test(entry.title)) issues.push('title still carries the internal-only "Themed list:" prefix — never allowed in public.lists.title')
  if (!entry.expectedOfficial || !entry.expectedPublic) issues.push('this list is not planned as is_official=true/is_public=true — every Home-visible list must be both')
  if (!entry.sqlCreatesListCorrectly) issues.push(`the generated SQL does not contain a correct public.lists insert for this exact title with is_official=true/is_public=true and metro "${entry.expectedMetroSlug}" ownership`)
  if (entry.sqlLinkedItemCount !== entry.expectedItemCount) {
    issues.push(`the generated SQL links ${entry.sqlLinkedItemCount} item(s) to this list, but the plan intends ${entry.expectedItemCount} — the package is incomplete or malformed`)
  }
  return { label: entry.label, issues }
}

export function evaluateHomeListPackageValidationGate(entries: readonly HomeListPackagePlanEntry[]): HomeListCertificationResult {
  if (entries.length === 0) {
    return { gate: { key: 'HOME_LIST_PACKAGE_VALIDATION_GATE', verdict: 'FAIL', reason: 'No Home-visible lists were planned — a metro launch requires at least the primary seasonal/flagship list.' }, findings: [] }
  }
  const findings = entries.map(certifyHomeListPackageEntry)
  const failing = findings.filter((f) => f.issues.length > 0)
  if (failing.length > 0) {
    return {
      gate: {
        key: 'HOME_LIST_PACKAGE_VALIDATION_GATE',
        verdict: 'FAIL',
        reason: `${failing.length}/${entries.length} planned Home-visible list(s) failed PRE_APPLY package validation: ${failing.map((f) => `${f.label} [${f.issues.join('; ')}]`).join(' | ')}`,
      },
      findings,
    }
  }
  return {
    gate: {
      key: 'HOME_LIST_PACKAGE_VALIDATION_GATE',
      verdict: 'PASS',
      reason: `All ${entries.length} planned Home-visible list(s) validated against the generated SQL package itself (titles, official/public flags, metro ownership, and item-link counts all correct) — no production read required or performed.`,
    },
    findings,
  }
}

/**
 * Parses the ACTUAL generated SQL text (never trusts the plan's own
 * bookkeeping in isolation) to build the HomeListPackagePlanEntry[] the
 * gate above certifies. Pure/no I/O, same discipline as every other
 * function in this module — the caller supplies the real generated SQL
 * string; this never fabricates or assumes it.
 *
 * Matches the exact shape metroLaunchDriver.ts's buildHomeListSqlPatch()
 * emits: for each list, a `SELECT id INTO v_list_id FROM public.lists
 * WHERE metro_id = v_metro_id AND title = '<title>' AND is_official =
 * true;` anchor line, an `INSERT INTO public.lists (...) VALUES
 * (v_metro_id, '<title>', true, true, ...)` creation block, and one
 * `INSERT INTO public.list_items (list_id, item_id)` per linked item
 * before the next list's anchor (or end of SQL).
 */
export function derivePackageValidationFromSql(
  plan: readonly { label: string; title: string; kind: string; itemCandidateNames: readonly string[] }[],
  sql: string,
  expectedMetroSlug: string
): HomeListPackagePlanEntry[] {
  const escapeForSql = (s: string) => s.replace(/'/g, "''")
  const escapeForRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  // Anchor points, in the order they actually appear in the SQL — used to
  // slice out each list's own section so item-link counts are never
  // double-counted across lists or accidentally attributed to the wrong one.
  const anchorRegex = /SELECT id INTO v_list_id FROM public\.lists WHERE metro_id = v_metro_id AND title = '((?:[^']|'')*)' AND is_official = true;/g
  const anchors: { title: string; index: number }[] = []
  let m: RegExpExecArray | null
  while ((m = anchorRegex.exec(sql)) !== null) {
    anchors.push({ title: m[1].replace(/''/g, "'"), index: m.index })
  }

  return plan
    .filter((entry) => entry.kind !== 'CURATED_MIRROR') // the legacy curated_lists layer is a separate, non-Home-visible patch — not part of this package
    .map((entry) => {
      const quotedTitle = escapeForSql(entry.title)
      const createRegex = new RegExp(`INSERT INTO public\\.lists[^;]*VALUES \\(v_metro_id, '${escapeForRegex(quotedTitle)}', true, true`)
      const sqlCreatesListCorrectly = createRegex.test(sql)

      const anchorIdx = anchors.findIndex((a) => a.title === entry.title)
      let sqlLinkedItemCount = 0
      if (anchorIdx >= 0) {
        const sectionStart = anchors[anchorIdx].index
        const sectionEnd = anchorIdx + 1 < anchors.length ? anchors[anchorIdx + 1].index : sql.length
        const section = sql.slice(sectionStart, sectionEnd)
        sqlLinkedItemCount = (section.match(/INSERT INTO public\.list_items \(list_id, item_id\)/g) ?? []).length
      }

      return {
        label: entry.label,
        title: entry.title,
        expectedMetroSlug,
        expectedOfficial: true,
        expectedPublic: true,
        expectedFeaturedEligible: entry.kind === 'PRIMARY_SEASONAL',
        expectedItemCount: entry.itemCandidateNames.length,
        sqlCreatesListCorrectly,
        sqlLinkedItemCount,
      } satisfies HomeListPackagePlanEntry
    })
}

// ---------------------------------------------------------------------------
// curated_lists / curated_list_items / curated_list_metros — the
// separate legacy/curated-definition layer, when the current app
// architecture still requires it (see docs/metro-launch-playbook.md
// Part 1's own note: `curated_list_metros` governs visibility, not
// `curated_lists.city_slug`). Certified SEPARATELY from the Home-list
// gate above — Winston must never conflate "curated_lists rows exist"
// with "this is Home-visible."
// ---------------------------------------------------------------------------

export interface CuratedListRow {
  label: string
  exists: boolean
  isActive: boolean
  /** No rows in curated_list_metros = universal/visible everywhere; a row present must match the expected metro. Null = universal (valid), a set value must equal expectedMetroSlug. */
  metroScopeSlug: string | null
  expectedMetroSlug: string
  curatedListItemsCount: number
  expectedItemCount: number
}

export function certifyCuratedListRow(row: CuratedListRow): HomeListCertificationFinding {
  const issues: string[] = []
  if (!row.exists) {
    issues.push('no row exists in curated_lists')
    return { label: row.label, issues }
  }
  if (!row.isActive) issues.push('curated_lists.is_active is not true (this DOES actually gate public read — the RLS fix is live)')
  if (row.metroScopeSlug !== null && row.metroScopeSlug !== row.expectedMetroSlug) {
    issues.push(`curated_list_metros scopes this list to "${row.metroScopeSlug}", expected "${row.expectedMetroSlug}" (or universal/no rows)`)
  }
  if (row.curatedListItemsCount !== row.expectedItemCount) {
    issues.push(`curated_list_items count (${row.curatedListItemsCount}) does not match the intended membership size (${row.expectedItemCount})`)
  }
  return { label: row.label, issues }
}

export function evaluateCuratedListLayerGate(rows: readonly CuratedListRow[]): HomeListCertificationResult {
  if (rows.length === 0) {
    return { gate: { key: 'CURATED_LIST_LAYER_GATE', verdict: 'PASS', reason: 'No curated_lists layer rows were required for this launch (only applicable when the current app architecture still consumes this layer).' }, findings: [] }
  }
  const findings = rows.map(certifyCuratedListRow)
  const failing = findings.filter((f) => f.issues.length > 0)
  if (failing.length > 0) {
    return {
      gate: { key: 'CURATED_LIST_LAYER_GATE', verdict: 'FAIL', reason: `${failing.length}/${rows.length} curated_lists row(s) failed certification: ${failing.map((f) => `${f.label} [${f.issues.join('; ')}]`).join(' | ')}` },
      findings,
    }
  }
  return { gate: { key: 'CURATED_LIST_LAYER_GATE', verdict: 'PASS', reason: `All ${rows.length} curated_lists row(s) certified.` }, findings }
}
