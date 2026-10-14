// Release hygiene: process-notification-queue must stay exactly the deployed behavior plus the caller guard.
// If you add a push type here on purpose, update ALLOWED_TYPES and docs/release/PENDING_candidate_visit_push_handler.md.
const src = await Deno.readTextFile(new URL('../process-notification-queue/index.ts', import.meta.url));
const ALLOWED_TYPES = ['check_in', 'leaderboard_nudge', 'dare', 'list_invite'];

Deno.test('queue processor handles exactly the deployed push types', () => {
  const found = [...src.matchAll(/row\.type === '([a-z_]+)'/g)].map((m) => m[1]).sort();
  if (JSON.stringify(found) !== JSON.stringify([...ALLOWED_TYPES].sort())) throw new Error(`push types changed: ${found.join(', ')}`);
});

Deno.test('queue processor does not contain the candidate visit or badge push handlers', () => {
  for (const banned of ['candidate_visit_high_confidence', "'badge'", 'Did you CheckOff the Thing']) {
    if (src.includes(banned)) throw new Error(`unexpected push content: ${banned}`);
  }
});

Deno.test('queue processor rejects non server callers before reading the queue', () => {
  const guard = src.indexOf('guardServerCaller(req)');
  const firstRead = src.indexOf("from('notification_queue')");
  if (guard < 0 || firstRead < 0 || guard > firstRead) throw new Error('guard missing or after the first queue read');
});

Deno.test('send-notifications (has a badge handler, no caller) stays guarded', async () => {
  const sn = await Deno.readTextFile(new URL('../send-notifications/index.ts', import.meta.url));
  if (!sn.includes('guardServerCaller(req)')) throw new Error('send-notifications lost its caller guard');
});
