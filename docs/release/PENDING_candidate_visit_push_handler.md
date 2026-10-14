# Pending (NOT deployed, NOT in the repository function): candidate visit push handler

Why this file exists: the repository copy of `process-notification-queue` used to contain a handler for queue type `candidate_visit_high_confidence`
("Did you CheckOff the Thing?" / "You were just at a CheckOff spot"), but production never had it. The database trigger `candidate_visits_notify_high_confidence`
already queues those rows (2 so far), and the live processor marks them "Unknown notification type" so NO push is sent. An ordinary deploy of the old repository
file would have started those pushes. The handler was therefore removed from the function file and parked here.

Enabling it is a product decision (it is a new, visible message to users). To enable: paste the block below into `process-notification-queue/index.ts` after the
`list_invite` branch, update `supabase/functions/_shared/queueProcessorGuard.test.ts` (the allowed type list), and deploy deliberately. Keep the feature flags
`realtime_nearby_checkoff_notifications` and `candidate_visit_silent_mode` in mind: the processor does not check them.

```ts
  // Visit Reminder V1 — queued by the candidate_visits AFTER INSERT trigger
  // (see supabase/migrations/20260902_visit_reminder_v1_notify_trigger.sql)
  // once a departure clears the existing notify-eligible confidence
  // threshold. Generic, non-creepy copy per product spec — no venue name,
  // no "we saw you at X".
  if (row.type === 'candidate_visit_high_confidence') {
    return {
      to:    token,
      title: 'Did you CheckOff the Thing?',
      body:  'You were just at a CheckOff spot 👀',
      sound: 'default',
      data:  {
        screen: 'Home',
        kind: 'candidate_visit_high_confidence',
        item_id: p.item_id ?? null,
        candidate_visit_id: p.candidate_visit_id ?? null,
      },
    }
  }
```

Historical badge pushes: the live processor has NO `badge` handler (109 queued badge rows are all marked errored, none delivered). `send-notifications` does have a badge
handler but nothing calls it (no cron, trigger or webhook); it now also requires the service key or campaign secret. Do not wire either up without a decision.
