# Integrating the Green Bay outreach work into live Winston

Steps marked **[APPROVAL]** change the running system and need Jerry's explicit go-ahead. Everything else is read-only.

## Why this branch exists

`winston/green-bay-outreach` (487b65b) carries the Blair code as a *cherry-picked copy* (69951d0). The live checkout carries the
same Blair code as a3342bf. Merging the two **conflicts** (add/add in `bizDevOutreach.ts` and `monitorCli.ts`), in either order.

`winston/green-bay-integration` is the same work rebuilt directly **on top of the live commit a3342bf**, so it fast-forwards
with no conflict and shares history with the live branch (no later add/add when `feature/nearby-photo-categories` lands on `main`).
Its code is identical to the tested branch, plus three small fixes (a mislabelled task text after Follow-Up 1, a needless
health-row rewrite every poll, and the read-only verify command).

## Where the live monitor runs

`com.checkoff.chief-monitor` → `/Users/jerrystuckart/Downloads/checkoff` (the **shared** checkout, currently on
`feature/nearby-photo-categories`), via `node_modules/tsx ... agent-service/monitorCli.ts`, `KeepAlive` with a 300 s throttle.
Other sessions also work in that checkout, so do not switch branches there.

## Pre-flight (read-only, safe any time)

```bash
cd /Users/jerrystuckart/Downloads/checkoff
git branch --show-current                    # expect feature/nearby-photo-categories
git rev-parse --short HEAD                   # expect a3342bf (if not, re-check before merging)
git merge-base --is-ancestor HEAD winston/green-bay-integration && echo "fast-forward possible"
git status --short                           # nothing under agent-service/, docs/outreach-campaigns/, .gitignore
```

## 1. Merge **[APPROVAL]**

```bash
cd /Users/jerrystuckart/Downloads/checkoff
git merge --ff-only winston/green-bay-integration
```

`--ff-only` refuses if anything diverged. It changes only `agent-service/`, `docs/outreach-campaigns/` and `.gitignore`;
uncommitted files elsewhere (including other sessions' work) are not touched. The running monitor keeps its old code in memory until step 3.

## 2. Verify on the live files before restarting (read-only)

```bash
npx tsx agent-service/verifyBizDevReadOnly.ts                              # now: Blair untouched, no action
npx tsx agent-service/verifyBizDevReadOnly.ts --now 2026-10-16T19:30:00Z   # Blair's Follow-Up 1: same thread, same body hash 947af8c366
npm run agent:test                                                         # same 5 known failures only
```

## 3. Restart the monitor **[APPROVAL]**

```bash
launchctl kickstart -k gui/$(id -u)/com.checkoff.chief-monitor     # launchd respawns within ~5 minutes (ThrottleInterval 300)
tail -f ~/Library/Logs/ChiefMonitor/monitor.log                    # expect: starting..., token refreshed
tail ~/Library/Logs/ChiefMonitor/monitor.err.log                   # expect: no new lines
```

First tick side effects (the only production writes the restart causes): one `chief_health` counters row
(`agent.tasks`, project `chief-operations`). No campaign exists yet, so nothing else happens.

## Rollback

No schema was changed, so rollback is code-only and loses no data:

```bash
git revert --no-edit a3342bf..HEAD      # adds revert commits; no history rewrite; uncommitted files untouched
launchctl kickstart -k gui/$(id -u)/com.checkoff.chief-monitor
```

Blair's task state is unchanged by the new code and works with the old code (verified), so reverting is safe at any time.
A running campaign should be paused first: `npx tsx agent-service/outreachCampaignCli.ts pause <key>`.

## Optional hardening (separate decision) **[APPROVAL]**

The live service depends on whatever branch is checked out in a shared working directory. A dedicated checkout for Winston
(`git worktree add ~/winston-live <branch>`, symlink `.env`/`node_modules`, then repoint `WorkingDirectory` and the
`ProgramArguments` path in `~/Library/LaunchAgents/com.checkoff.chief-monitor.plist`) removes that coupling. Not required for the canary.
