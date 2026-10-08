# Badge celebration fix (2026-10-08)

## Root cause (three independent defects)
1. **Wrong owner.** The celebration was only ever driven by `ListScreen` (`pollForNewBadges` + a local `BadgeCelebrationModal`). Check-ins from Item Detail, Photo Check-in, Trip Mode and visit recovery never looked for badges.
2. **Client-awarded `points_*` badges could never celebrate.** `lib/points.js` inserted `user_badges` (allowed) and then a `notification_queue` row (INSERT is admin-only under RLS, silently rejected). Live data 2026-10-08: 17 of 18 `points_*` badges have no queue row; 95 of 95 trigger/function-awarded badges do.
3. **Mark-before-show, over a competing modal.** `pollForNewBadges` flipped `notification_queue.delivered = true` before anything was visible. Since the post check-off sheet (a native Modal, commit f4c7bc8, 2026-07-25) is already on screen when the poll resolves, iOS cannot present a second modal and the badge was lost permanently.

Awarding itself is healthy (trigger `check_ins_award_badges`, `update-streak`, client points). Presentation and event delivery were the broken parts.

## Design now
`lib/badgeCelebrations.js` (controller) + `lib/badgeCelebrationStore.js` (singleton, hook) + `components/BadgeCelebrationHost.jsx` (mounted once in `App.jsx`). `BadgeCelebrationModal` is unchanged visually; it gained `onBadgeShown` (fires from the native Modal `onShow`).

- Source of truth is `user_badges`. Unseen = earned in the last 7 days, not in this account's persisted seen set, and no delivered=true queue row.
- Safe point: nothing presents while any screen holds (`useBadgeCelebrationHold`: post check-off sheet, tier upgrade, memory prompt, Trip Mode sheet, update prompt, the recovery confirmation Alert), while the app is inactive, or in the 600 ms after the last hold is released.
- Seen is persisted (and the queue row mirrored delivered) only when the modal reports a badge on screen. "Skip all" acknowledges the batch that started; a batch that never became visible acknowledges nothing.
- Multiple awards: one dialog steps through all of them (1 of N). Awards arriving while it is up wait for the next batch; the presented array is never mutated.
- Duplicates: in-memory ids, persisted seen set (per account key), delivered queue rows, controller reset on account change (stale async results are discarded by epoch).
- Triggers: after each check-in surface, app foreground, sign-in, and screen changes (30 s throttle). `points_*` milestones are also (re)evaluated on every check so recovery/Trip Mode paths award them.
- Old awards: anything older than 7 days is neither shown nor modified (no history replay). Genuinely unseen recent awards celebrate once.
- The referral bonus (`handleFirstCheckinReferralBonus`) now runs from the host, so it works for every check-in surface (it is idempotent via `bonus_awarded_at`).

## Notifications (separate, unresolved)
Badge push has never worked in production: the deployed `send-notifications` is v27 (2026-05-03); the `badge` branch was added to the repo on 2026-05-04. Queue rows for badges end with `Unknown notification type: badge` (through 2026-09-29) or `No push tokens for user`. Not deployed in this change; deploying it would need a decision on preference gating (no badge preference column exists; `notif_check_ins/invites/nudges` are the only flags).

## Verification
`node --test lib/*.test.js lib/visitDetection/*.test.js` and `node scripts/render-badge-celebration/render.mjs` (react-test-renderer over the real host + modal, faked DB emulating the trigger and the RLS rejection).
