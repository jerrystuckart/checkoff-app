// agent-service/playbooks/executionStateLanguage.ts
//
// Chief Phase 2AK (2026-09-10, methodology hardening postmortem) —
// Winston must always distinguish three distinct, real states for any
// metro/list/item:
//   GENERATED  — exists only in an unexecuted local SQL/package file.
//   APPLIED    — the SQL has actually been run against production (a real,
//                confirmed fact — never inferred from "I generated it").
//   VERIFIED   — a real, live read-path query confirmed the row/state
//                exists in production (the strongest claim).
// A metro build produces GENERATED artifacts by construction (the standing
// write-boundary: Winston never executes production SQL itself — see
// docs/metro-launch-playbook.md). Saying a list/item/metro "was created"
// when only GENERATED is true is a real, misleading claim this module
// exists to prevent — it reads like APPLIED to anyone skimming a report.

export type ExecutionState = 'GENERATED' | 'APPLIED' | 'VERIFIED'

/**
 * The single, canonical phrase for describing a production-affecting
 * artifact's real state — report-writing code (and Winston's own prose)
 * should build sentences around this rather than free-hand phrasing like
 * "was created"/"now exists" that collapses the GENERATED/APPLIED/VERIFIED
 * distinction.
 */
export function describeExecutionState(state: ExecutionState, subject: string): string {
  switch (state) {
    case 'GENERATED':
      return `${subject} — added to the generated package, NOT executed against production.`
    case 'APPLIED':
      return `${subject} — the generated SQL has been applied to production (execution confirmed), but not independently re-verified by a live read.`
    case 'VERIFIED':
      return `${subject} — confirmed live in production via a real read-path query.`
  }
}

/**
 * Phrases that falsely imply APPLIED/VERIFIED when only GENERATED is
 * actually true — a lightweight, deliberately narrow lint for report/
 * summary text Winston writes about its own metro-build output. Not a
 * substitute for actually tracking real execution state; a heuristic
 * safety net against the specific, real mistake this module exists to
 * prevent (e.g. "Created the Dive Bars list" when the INSERT is still
 * sitting, unexecuted, in a local .sql file).
 */
const FALSE_APPLIED_PATTERNS: RegExp[] = [/\bwas created\b/i, /\bhas been created\b/i, /\bnow exists? in production\b/i, /\bI created\b/i, /\bcreated the\b/i, /\badded (?:it|the \w+) to production\b/i]

export interface ExecutionLanguageCheckResult {
  verdict: 'PASS' | 'FAIL'
  violations: string[]
}

/**
 * Scans a piece of report/summary text for language that claims
 * APPLIED/VERIFIED-shaped facts while the actual state is GENERATED only.
 * Only meaningful when `actualState === 'GENERATED'` — APPLIED/VERIFIED
 * text is free to use stronger language, since it would be true.
 */
export function checkExecutionStateLanguage(text: string, actualState: ExecutionState): ExecutionLanguageCheckResult {
  if (actualState !== 'GENERATED') return { verdict: 'PASS', violations: [] }
  const violations = FALSE_APPLIED_PATTERNS.filter((p) => p.test(text)).map((p) => p.source)
  return { verdict: violations.length === 0 ? 'PASS' : 'FAIL', violations }
}
