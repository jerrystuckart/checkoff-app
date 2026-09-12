import type { PlaybookRunStore } from './playbookRun'
import { playbookRunId, recordJerryDecision, getOrCreateRun } from './playbookRun'
import type { MetroM0Decisions } from './metroLaunchDriver'

/**
 * `--m0`'s handling of an EXISTING run (2026-09-11 Munich re-entry bug).
 * Previously the CLI called recordJerryDecision() unconditionally for ANY
 * NEEDS_JERRY run, regardless of what stage it was actually parked at —
 * recordJerryDecision() flips status back to RUNNING and clears
 * jerryReason/decisionPacket unconditionally, so a NEEDS_JERRY run parked
 * at LAUNCH_READINESS_BOUNDARY (Munich, post-Finisher) was resumed out of
 * NEEDS_JERRY by the mere presence of `--m0` on the command line — BEFORE
 * driveMetroLaunch's own re-entry guards (including
 * `--reopen-from-launch-boundary`, see metroLaunchDriver.ts's
 * driveMetroLaunch doc) ever got a chance to see the run. driveMetroLaunch
 * would then immediately re-escalate it right back to NEEDS_JERRY/
 * LAUNCH_READINESS_BOUNDARY, making the retry silently no-op.
 *
 * `--m0` is only ever meaningful for the M0_METRO_DEFINITION stage (it
 * seeds/records the M0 decisions), so recordJerryDecision() now fires only
 * when the run is NEEDS_JERRY AND parked exactly at M0_METRO_DEFINITION —
 * mirroring driveMetroLaunch's own M0 re-entry condition
 * (`run.currentStage !== 'M0_METRO_DEFINITION'` guard) exactly. A
 * NEEDS_JERRY run parked at any other stage is left untouched: `--m0` is a
 * deliberate no-op for the resume-triggering purpose, logged rather than
 * silently swallowed.
 */
export async function applyM0Flag(runStore: PlaybookRunStore, playbookKey: string, projectId: string, m0: MetroM0Decisions): Promise<void> {
  const runId = playbookRunId(playbookKey, projectId)
  const existing = await runStore.get(runId)
  if (existing && existing.status === 'NEEDS_JERRY' && existing.currentStage === 'M0_METRO_DEFINITION') {
    await recordJerryDecision(runStore, runId, { m0Decisions: m0 })
  } else if (existing && existing.status === 'NEEDS_JERRY') {
    console.error(`--m0 is a no-op: run ${runId} is NEEDS_JERRY but parked at ${existing.currentStage}, not M0_METRO_DEFINITION.`)
  } else if (!existing) {
    // Seed the M0 decisions before the run's very first step —
    // getOrCreateRun (also called inside driveMetroLaunch) is idempotent.
    const seeded = await getOrCreateRun(runStore, playbookKey, projectId, 'M0_METRO_DEFINITION')
    seeded.state = { ...seeded.state, m0Decisions: m0 }
    // DbPlaybookRunStore's recordPlaybookStage is idempotency-keyed on
    // (status, currentStage, loopIteration, totalRetries, updatedAt) —
    // getOrCreateRun's own put() and this one would otherwise share
    // the exact same updatedAt (and thus idempotency key), so this
    // second put (the one actually carrying m0Decisions) would be
    // silently deduped as a no-op replay of the first, empty-state
    // snapshot. Bumping updatedAt makes it a distinct snapshot.
    seeded.updatedAt = new Date().toISOString()
    await runStore.put(seeded)
  }
}
