// Chief Phase 3B — canonical venue clustering (Vienna post-mortem, item
// 3). Vienna's final cleanup found 28 real venue clusters and removed
// 38 duplicate same-experience items, almost all confirmable by a
// single strong signal: Google Place ID equality (Wiener Staatsoper /
// Vienna State Opera, Musikverein variants, Prater / Riesenrad
// variants, etc.).
//
// DELIBERATE DESIGN: this module CLUSTERS and REPORTS. It never
// silently drops an item. Per the explicit instruction ("same venue is
// not automatically a duplicate... Winston may keep multiple candidates
// at one venue only when they represent materially different CheckOff
// experiences... do not merge solely on name similarity"), an automatic
// same-experience judgment is not something Place ID equality alone can
// safely make — that requires reading and comparing the actual
// checkoffizedItem bodies, which is an editorial judgment. What THIS
// module gives Winston is the thing Vienna was missing: an early,
// cheap, structured list of "these N candidates resolve to the same
// real-world venue" so a human (or a future bounded editorial pass) can
// make the keep/drop call BEFORE it reaches production packaging,
// rather than discovering it during a manual final audit.
//
// KNOWN ARCHITECTURAL LIMITATION (see stepM8BatchCertification): Place
// ID is only resolved during M8 geo enrichment, which runs AFTER
// editorial writing (M6.5) and tag assignment (M7.5) — so this
// clustering pass, wired at M8/M8.5, still happens after those calls
// are spent, not before them as item 3's "before expensive editorial
// work" framing ideally wants. Moving Places resolution earlier in the
// pipeline is a real future improvement, not something this module can
// fix on its own — flagged explicitly in the final report rather than
// silently claimed as solved.

export interface VenueClusterMember {
  candidateName: string
  placeId: string | null
  finalBody: string | null
}

export interface VenueCluster {
  placeId: string
  members: readonly VenueClusterMember[]
}

/**
 * Groups certified items that resolved to the exact same Google Place
 * ID. A cluster of size 1 is not reported (nothing to review). Purely
 * structural — carries no keep/drop recommendation.
 */
export function clusterByPlaceId(members: readonly VenueClusterMember[]): VenueCluster[] {
  const byPlaceId = new Map<string, VenueClusterMember[]>()
  for (const m of members) {
    if (!m.placeId) continue
    const group = byPlaceId.get(m.placeId) ?? []
    group.push(m)
    byPlaceId.set(m.placeId, group)
  }
  return [...byPlaceId.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([placeId, group]) => ({ placeId, members: group }))
    .sort((a, b) => a.placeId.localeCompare(b.placeId))
}

export interface VenueClusterReviewNote {
  placeId: string
  candidateNames: string[]
  /** Never a decision — a prompt for the human/editorial reviewer: are these the same experience, or genuinely distinct ones? */
  reviewPrompt: string
}

/**
 * Formats clusters as reviewable notes — this is the artifact Winston
 * surfaces in the final report/pre-apply audit (never an automatic
 * drop). "Report how many editorial calls this saves" (item 3's own
 * ask): counting clusters found HERE (before production packaging)
 * lets a future run compare against how many clusters a full manual
 * audit would otherwise have to find from scratch.
 */
export function buildVenueClusterReviewNotes(clusters: readonly VenueCluster[]): VenueClusterReviewNote[] {
  return clusters.map((c) => ({
    placeId: c.placeId,
    candidateNames: c.members.map((m) => m.candidateName),
    reviewPrompt: `${c.members.length} certified candidates resolved to the same Google Place ID (${c.placeId}). Compare their CheckOff bodies: if they describe the same experience, keep the stronger one and drop the rest; if each describes a genuinely distinct, worthwhile experience at this venue, keep them all.`,
  }))
}

// ---------------------------------------------------------------------------
// Chief Phase 2AK (2026-09-10, methodology hardening postmortem) — makes
// same-Place-ID cluster review a REQUIRED, always-present certification
// gate (wired into REQUIRED_GATE_CATEGORIES in metroLaunchCertification.ts)
// rather than something that only surfaced in the final LAUNCH_READINESS_BOUNDARY
// report text. Computed at M8 (the same place clusterByPlaceId already
// runs), i.e. genuinely BEFORE M9 generates the production SQL — not just
// before the human reads the final report. This gate never hard-blocks on
// its own (same-venue is legitimate; see this module's own doc) — its job
// is to make cluster review structurally impossible to skip or silently
// omit, never to auto-resolve keep/drop itself.
// ---------------------------------------------------------------------------

export interface SameVenueClusterReviewResult {
  key: 'SAME_VENUE_CLUSTER_REVIEW_GATE'
  verdict: 'PASS'
  reason: string
  clusterCount: number
}

export function evaluateSameVenueClusterReviewGate(clusters: readonly VenueCluster[]): SameVenueClusterReviewResult {
  return {
    key: 'SAME_VENUE_CLUSTER_REVIEW_GATE',
    verdict: 'PASS',
    clusterCount: clusters.length,
    reason:
      clusters.length === 0
        ? 'No certified candidates share a Google Place ID — nothing to review.'
        : `${clusters.length} same-Google-Place-ID cluster(s) surfaced for explicit review before production SQL: ${clusters.map((c) => `${c.placeId} (${c.members.map((m) => m.candidateName).join(', ')})`).join(' | ')}. Never auto-resolved — see buildVenueClusterReviewNotes for the human-facing prompt.`,
  }
}
