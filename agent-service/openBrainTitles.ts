// Phase 0F — human-readable Open Brain titles. decision_key is a stable,
// internal, snake_case slug (e.g. widget_marketing_after_build) — fine as
// an identifier, wrong to expose verbatim as durable memory a human reads
// later. There is nowhere in agent.decisions today that holds an authored
// human title (metadata is {} for every current decision, and Phase 0F is
// explicitly not allowed to write to that row to add one), so this module
// is the deterministic, code-level, explicitly-maintained source of truth
// for one — the same "explicit, never inferred" posture already used for
// open_brain_eligible, just applied to titles instead.
//
// No LLM, no per-call inference: adding an entry here is a deliberate,
// reviewed, one-time editorial action (the same kind of action as marking
// a decision eligible), not something formatting does automatically.
// Every decision without an entry still gets a humanized version of its
// key — never the raw snake_case string — so this degrades safely rather
// than falling back to something Jerry's memory shouldn't expose.

const DECISION_TITLE_OVERRIDES: Readonly<Record<string, string>> = {
  widget_marketing_after_build: 'Market the widget only after it exists',
}

/**
 * snake_case -> Title Case, e.g. "widget_marketing_after_build" ->
 * "Widget Marketing After Build". Pure and total — every decision_key
 * produces some non-snake-case title, even with no override entry above.
 */
function humanizeDecisionKey(decisionKey: string): string {
  return decisionKey
    .split('_')
    .filter((word) => word.length > 0)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ')
}

/** The human-readable title for a given decision_key — an explicit override if one has been authored, otherwise a humanized fallback. Never the raw decision_key. */
export function humanReadableDecisionTitle(decisionKey: string): string {
  return DECISION_TITLE_OVERRIDES[decisionKey] ?? humanizeDecisionKey(decisionKey)
}
