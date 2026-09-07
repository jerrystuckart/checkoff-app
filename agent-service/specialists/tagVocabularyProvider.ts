// agent-service/specialists/tagVocabularyProvider.ts
//
// Chief Phase 2W — the canonical tag vocabulary provider, so a metro
// build never BLOCKS on tag certification just because the
// `agent_service` Postgres role still lacks SELECT on `public.tags`
// (confirmed via a real "permission denied for table tags" error,
// 2026-09-07 — see metroTagCertification.ts). Real I/O lives here
// (unlike the pure agent-service/playbooks/*.ts modules) because this
// module's whole job is choosing between two real data sources.
//
// Preference order, matching Jerry's exact instruction:
//   1. Live exact DB verification, when the role is permitted to SELECT.
//   2. Otherwise, a versioned, explicitly justified VERIFIED PRODUCTION
//      SNAPSHOT — never a fabricated/guessed tag list.
//   3. Fail (closed) only when NEITHER is available — metroTagCertification.ts's
//      evaluateTagCertificationGate() then correctly reports every item's
//      tags as unverifiable rather than silently skipping the gate.
//
// Phase 2Y (2026-09-07): VerifiedTagSnapshot v1 now exists —
// loadGeneratedTagSnapshot() below reads it from
// agent-service/specialists/tagSnapshotData.generated.json, itself
// generated (never hand-typed) by scripts/generate-tag-snapshot.ts from
// Appendix A of docs/checkoff-item-intake-chatgpt-instructions-UPDATED-2026-09-06.md
// — Jerry's own real 2026-09-06 production export of public.tags.name.
// This is a NAME VOCABULARY snapshot only: every string preserved
// exactly (no normalizing/singularizing/pluralizing/aliasing/inventing),
// used only as a fallback when live public.tags SELECT is unavailable —
// live access, once granted, is always preferred (see resolveCanonicalTagVocabulary's
// own ordering below, unchanged).

export interface VerifiedTagSnapshot {
  /** Monotonically increasing — bump every time the snapshot is refreshed from a real source. */
  version: number
  /** ISO date the snapshot was captured. */
  capturedAt: string
  /** Why this snapshot is still trustworthy to compare new tag proposals against — required, per assertExplicitProductionStateSource's own discipline in metroLaunchCertification.ts (never compare against a frozen list without saying why it's still right). */
  justification: string
  tagNames: readonly string[]
}

export interface TagVocabularyResult {
  status: 'LIVE_DB' | 'VERIFIED_SNAPSHOT'
  tagNames: ReadonlySet<string>
  detail: string
}

export interface TagVocabularyFailure {
  status: 'FAILED'
  reason: string
}

/**
 * `queryLiveTags` is injected (never a hardcoded db import here) so this
 * function stays trivially testable and so the driver decides exactly
 * how/whether to attempt the live query. A query that throws (permission
 * denied, connection error, etc.) or resolves to an empty list is
 * treated identically — fall through to the snapshot — since an empty
 * `public.tags` table is exactly as unusable as no access to it at all.
 */
export async function resolveCanonicalTagVocabulary(queryLiveTags: () => Promise<string[]>, snapshot: VerifiedTagSnapshot | null): Promise<TagVocabularyResult | TagVocabularyFailure> {
  let liveError: string | null = null
  try {
    const live = await queryLiveTags()
    if (live.length > 0) {
      return { status: 'LIVE_DB', tagNames: new Set(live), detail: `Live SELECT against public.tags returned ${live.length} canonical tag name(s).` }
    }
    liveError = 'live query returned zero rows'
  } catch (err) {
    liveError = err instanceof Error ? err.message : String(err)
  }

  if (snapshot && snapshot.tagNames.length > 0) {
    return {
      status: 'VERIFIED_SNAPSHOT',
      tagNames: new Set(snapshot.tagNames),
      detail: `Live DB tag read unavailable (${liveError}) — used VERIFIED_SNAPSHOT v${snapshot.version} (captured ${snapshot.capturedAt}): ${snapshot.justification}`,
    }
  }

  return {
    status: 'FAILED',
    reason: `Neither a live public.tags SELECT (${liveError}) nor a configured VerifiedTagSnapshot is available — tag certification cannot run. Grant SELECT on public.tags to the agent_service role, or supply a current VerifiedTagSnapshot, before this metro's TAG_CERTIFICATION_GATE can be evaluated. Never invents a tag list to work around this.`,
  }
}

// ---------------------------------------------------------------------------
// VerifiedTagSnapshot v1 — loaded from the checked-in generated JSON
// file, itself produced only by scripts/generate-tag-snapshot.ts parsing
// Appendix A of the source markdown. Never hand-edit
// tagSnapshotData.generated.json directly — re-run the generator against
// an updated Appendix A instead, so there is exactly one place this
// vocabulary is ever transcribed from.
// ---------------------------------------------------------------------------

interface GeneratedTagSnapshotFile {
  version: number
  capturedAt: string
  source: string
  justification: string
  tagNames: string[]
}

let cachedSnapshot: VerifiedTagSnapshot | null = null

/**
 * Loads VerifiedTagSnapshot v1 from the generated JSON artifact. Cached
 * after the first successful load (the file is a static, checked-in
 * build artifact within one process lifetime — re-running the generator
 * script and restarting the process is how it's ever refreshed).
 * Returns null (never throws) if the generated file doesn't exist yet —
 * callers fall through to the FAILED/fail-closed path exactly as if no
 * snapshot were configured, per this module's own fail-closed discipline.
 */
export function loadGeneratedTagSnapshot(): VerifiedTagSnapshot | null {
  if (cachedSnapshot) return cachedSnapshot
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const data = require('./tagSnapshotData.generated.json') as GeneratedTagSnapshotFile
    cachedSnapshot = { version: data.version, capturedAt: data.capturedAt, justification: `${data.justification} (source: ${data.source})`, tagNames: data.tagNames }
    return cachedSnapshot
  } catch {
    return null
  }
}
