// agent-service/specialists/homeListReadPath.ts
//
// Chief Phase 2X — the real read path behind MetroDriverDeps.verifyHomeListRows.
// Queries the ACTUAL runtime structures the Home feed and curated-list
// layer read from (public.lists / public.list_items / public.curated_lists
// / public.curated_list_items — the exact architecture discovery from
// Phase 2U: is_official=true + is_public=true on public.lists, joined
// through public.list_items, is what actually governs Home visibility;
// curated_lists alone is NOT sufficient and is certified as a separate
// layer, never conflated with Home visibility).
//
// READ-ONLY. This module has no write path and never will — Chief's
// standing write boundary (one atomic, self-certifying SQL patch handed
// to Jerry, never expanded DB privileges) is unchanged. It only PROVES
// whether a hand-run patch actually took effect, so the certification
// gate is a real fact-check rather than a rubber stamp.
//
// As of 2026-09-07, `agent_service` has NO SELECT grant on public.lists
// or public.list_items (confirmed live: "permission denied for table
// lists"/"list_items", same gap as public.tags) — this module still
// implements the real query so it activates the moment that grant
// exists, and reports the exact, actionable reason when it doesn't,
// rather than silently returning an empty/fake-passing result.

import { query } from '../db'
import type { HomeListRow, CuratedListRow } from '../playbooks/homeListCertification'
import type { HomeListPlanEntry } from './metroLaunchDriver'

export interface HomeListReadPathFailure {
  failed: true
  reason: string
}

interface RealListRow {
  title: string
  is_official: boolean;
  is_public: boolean
  metro_id: string
  starts_at: string | null
  ends_at: string | null
  is_featured_eligible: boolean
  hero_image_url: string | null
  list_items_count: string // count(*) comes back as text from pg
  every_membership_resolves: boolean
}

/**
 * Reads the real public.lists/public.list_items state for every planned
 * list whose title matches one this metro build produced, scoped to the
 * given metro_id. Returns HomeListRow[] shaped exactly for
 * certifyHomeListRow()/evaluateHomeListCertificationGate() — this
 * function does no certification judgment itself, only fact-gathering.
 */
export async function readRealHomeListRows(metroSlug: string, plan: readonly HomeListPlanEntry[]): Promise<HomeListRow[] | HomeListReadPathFailure> {
  const planned = plan.filter((p) => p.kind !== 'CURATED_MIRROR')
  if (planned.length === 0) return []

  let rows: RealListRow[]
  try {
    rows = await query<RealListRow>(
      `
      SELECT l.title, l.is_official, l.is_public, l.metro_id::text AS metro_id, l.starts_at::text, l.ends_at::text,
             l.is_featured_eligible, l.hero_image_url,
             count(li.item_id) AS list_items_count,
             bool_and(i.id IS NOT NULL) AS every_membership_resolves
      FROM public.lists l
      JOIN public.metro_areas m ON m.id = l.metro_id
      LEFT JOIN public.list_items li ON li.list_id = l.id
      LEFT JOIN public.items i ON i.id = li.item_id
      WHERE m.slug = $1 AND l.title = ANY($2::text[])
      GROUP BY l.id, l.title, l.is_official, l.is_public, l.metro_id, l.starts_at, l.ends_at, l.is_featured_eligible, l.hero_image_url
      `,
      [metroSlug, planned.map((p) => p.title)]
    )
  } catch (err) {
    return { failed: true, reason: `Live read of public.lists/public.list_items failed (${err instanceof Error ? err.message : String(err)}) — grant SELECT on both tables to the agent_service role before HOME_LIST_CERTIFICATION_GATE can certify against real runtime state. The generated SQL patch may still be correct; this failure means it could not be VERIFIED, not that it is wrong.` }
  }

  const byTitle = new Map(rows.map((r) => [r.title, r]))
  return planned.map((entry) => {
    const real = byTitle.get(entry.title)
    return {
      label: entry.label,
      exists: !!real,
      isOfficial: real?.is_official ?? false,
      isPublic: real?.is_public ?? false,
      metroId: real?.metro_id ?? null,
      expectedMetroId: metroSlug,
      startsAt: real?.starts_at ?? null,
      endsAt: real?.ends_at ?? null,
      goesPublicAt: real?.starts_at ?? null,
      isFeaturedEligible: real?.is_featured_eligible ?? false,
      expectedFeaturedEligible: entry.kind === 'PRIMARY_SEASONAL',
      listItemsCount: real ? Number(real.list_items_count) : 0,
      expectedItemCount: entry.itemCandidateNames.length,
      everyMembershipResolves: real?.every_membership_resolves ?? false,
      requiresImage: entry.requiresImage,
      hasImage: !!real?.hero_image_url,
      returnedByRuntimeQuery: !!real,
    }
  })
}

interface RealCuratedListRow {
  title: string
  is_active: boolean
  city_slug: string | null
  items_count: string
}

/** Same real-vs-planned fact-gathering, for the separate curated_lists layer. */
export async function readRealCuratedListRows(metroSlug: string, plannedTitles: readonly string[]): Promise<CuratedListRow[] | HomeListReadPathFailure> {
  if (plannedTitles.length === 0) return []
  let rows: RealCuratedListRow[]
  try {
    rows = await query<RealCuratedListRow>(
      `
      SELECT cl.title, cl.is_active, cl.city_slug, count(cli.item_id) AS items_count
      FROM public.curated_lists cl
      LEFT JOIN public.curated_list_items cli ON cli.curated_list_id = cl.id
      WHERE cl.title = ANY($1::text[])
      GROUP BY cl.id, cl.title, cl.is_active, cl.city_slug
      `,
      [plannedTitles]
    )
  } catch (err) {
    return { failed: true, reason: `Live read of public.curated_lists failed (${err instanceof Error ? err.message : String(err)}).` }
  }
  const byTitle = new Map(rows.map((r) => [r.title, r]))
  return plannedTitles.map((title) => {
    const real = byTitle.get(title)
    return {
      label: title,
      exists: !!real,
      isActive: real?.is_active ?? false,
      metroScopeSlug: real?.city_slug ?? null,
      expectedMetroSlug: metroSlug,
      curatedListItemsCount: real ? Number(real.items_count) : 0,
      expectedItemCount: 0,
    }
  })
}
