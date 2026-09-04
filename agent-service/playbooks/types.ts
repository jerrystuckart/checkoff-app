// Chief Phase 2A — the playbook model. Deliberately small: a playbook is
// data (name/purpose/entry conditions/ordered stages/evidence/escalation)
// plus a couple of pure functions a specific playbook module provides
// (classify evidence, derive next stage). There is no generic execution
// engine here, no DAG scheduler, no separate orchestration product — see
// businessPhotoOutreachEngine.ts for how a playbook actually runs: it
// reuses agent.tasks/task_events (state + audit trail) and the existing
// reconciliation machinery (WAITING -> resume) almost entirely as-is.
//
// The abstract flow every playbook should be describable in terms of:
//   goal -> plan -> execute step -> verify evidence -> advance -> wait
//        -> resume -> escalate -> complete
// is expressed here as: PlaybookStage (the "step"), evidence requirements
// (what "verify" checks), and next-stage rules (what "advance"/"wait"/
// "escalate"/"complete" mean for that stage) — not as literal code states
// of a generic engine.

export type AuthorityOperationKey = string

/** One stage in a playbook's ordered/dependency-based flow. */
export interface PlaybookStageDefinition<Stage extends string> {
  stage: Stage
  /** What this stage means, for humans reading a brief/audit trail. */
  purpose: string
  /** Structured evidence this stage needs before it can be considered satisfied — documentation, checked in code by the playbook's own evidence functions, not enforced generically here. */
  expectedEvidence: string[]
  /** When true, this stage is a terminal success state for the playbook instance. */
  isCompletion?: boolean
  /** When true, a task in this stage requires Jerry before it can advance (maps to TaskStatus NEEDS_JERRY). */
  requiresJerry?: boolean
  /** The standing-authority operation key(s) this stage's own advancement may perform. */
  authorityOperations: AuthorityOperationKey[]
}

export interface PlaybookDefinition<Stage extends string> {
  key: string
  name: string
  purpose: string
  /** Structured conditions that must hold before a task instance of this playbook may be created (checked by the seeding function, not by this type). */
  entryConditions: string[]
  stages: readonly PlaybookStageDefinition<Stage>[]
  /** Condition(s) under which the whole playbook instance is considered done — documentation; enforced by the playbook's own isComplete() function. */
  successCriteria: string[]
  /** Condition(s) under which a stage escalates to Jerry rather than advancing automatically. */
  escalationConditions: string[]
  defaultOwnerKey: string
}
