# Green Bay canary: 2 recipients, addresses Jerry owns

Purpose: prove the real path end to end (approve → database writes → token SQL → Gmail send from `jerry@getcheckoff.com` →
real receipt → confirm link → reply detection → follow-up cancellation → reporting → pause/resume → failure handling) at
the smallest possible blast radius, before the real Green Bay list.

**Prerequisite:** the integration merge and monitor restart in [DEPLOY.md](DEPLOY.md) are done. Nothing below has been run.

## The canary

| | Canary A | Canary B |
|---|---|---|
| Address | `jerrystuckart@hotmail.com` (a different mailbox: real external receipt, and replies travel the real Resend-inbound → forwarder path) | `jerrystuckart+canaryb@gmail.com` (lands in the inbox Winston watches) |
| Item (real Green Bay, no token, no cover photo) | Titletown Brewing Co (`44addd27-…`) | Wonderland Vintage Market (`eeff9a2f-…`) |
| Role | **replies** → proves reply detection, confirmation, follow-up cancellation | **never replies** → proves follow-ups, pause/resume, close |

Files: `canary/green-bay-canary.csv`, `canary/canary.campaign.json`. Cadence is compressed to **1 / 1 / 1 business days** so the whole
sequence is observable in about four weekdays; production cadence is 5 / 7 / 7. Start on a **Monday or Tuesday**.
Subjects start with `[CANARY TEST]` and the first line of each email says it is a test.

Preview (read-only, already validated): `Recipients 2 · errors 0 · warnings 0 · hash 444ad24c37ed60ea`.

## Rules that keep Green Bay listings untouched

- Winston never edits `items`. The canary adds only: 2 `business_outreach_tokens` rows, Winston's own `agent.*` rows, and (if you submit the form) a `business_confirmation_submissions` row per token.
- **Do** open the confirm links. Opening sets `opened_at` on the canary token only.
- **Do not** upload a photo or propose a correction on the confirm page (a photo creates a cover-candidate row that is not removed by the cleanup). Submitting "confirmed as-is" is optional.
- After the canary, remove the canary tokens (cleanup SQL below) so the real campaign mints fresh tokens for those two items.

## Run sheet

**Day 0 (Mon/Tue)**

1. Read `canary/canary.campaign.json`, then set both `approvals` flags to `true` in a *copy* of it. **[APPROVAL: campaign approval and production writes]**
2. `preview` (read-only) and check the hash is `444ad24c37ed60ea`:
   `npx tsx agent-service/outreachCampaignCli.ts preview --csv docs/outreach-campaigns/canary/green-bay-canary.csv --campaign <your copy>`
3. **[APPROVAL]** `approve ... --confirm-recipients 2 --preview-hash 444ad24c37ed60ea --templates-approved --token-sql-out canary_tokens.sql`
   Expect: 2 recipient tasks `READY`, campaign task `READY`, `canary_tokens.sql` with 2 inserts, **nothing sent**.
4. Review and apply `canary_tokens.sql` **[APPROVAL]** (`supabase db query -f canary_tokens.sql --linked`).
5. `activate green-bay-canary` **[APPROVAL]**. Expect it to check tokens, send-as, kit URL, then print ACTIVE.
6. Within ~15 minutes the monitor sends the two first touches. Watch `monitor.log` for `campaign:green-bay-canary: sent 2 first touch(es)`.

**Verify (Day 0)**

| Check | Expected |
|---|---|
| Real receipt | both emails arrive (hotmail inbox/junk; Gmail inbox), From `jerry@getcheckoff.com`, subject `[CANARY TEST] We selected Canary A for CheckOff` |
| Gmail provider acceptance ≠ delivery | no `Delivery Status Notification` appears for either (Winston also watches for it) |
| Confirm links | the link opens the confirm page for the right item; the token's `status` becomes `opened` |
| Records | `report green-bay-canary`: 2 first touches; tasks `WAITING`; next check = Day 1; one OUTBOUND interaction each |
| Blair | unchanged (snapshot below) |

7. **Canary A:** reply from hotmail with `Yes, that is accurate!` Within one poll (≤15 min): A's task → `DONE`, sequence `CONFIRMED`,
   INBOUND interaction with reply class `listing_confirmed`, **no `NEEDS_JERRY`**, and no follow-up ever goes to A.
8. **Canary B, pause test:** run `pause green-bay-canary` the same evening. Campaign task → `BLOCKED`.

**Day 1 (next business day, after the follow-up falls due)**

9. While paused: **no** follow-up goes to B (confirm in Sent). `resume green-bay-canary` **[APPROVAL]**: within ~15 minutes B receives Follow-Up 1 *in the same thread* (`Re: [CANARY TEST] ...`); A receives nothing.

**Day 2 / Day 3**

10. B receives Follow-Up 2 on the next business day; the business day after that B's task closes (`CANCELED`, "No response after the approved 3-email sequence") with **no fourth email**. The campaign task moves to `DONE`.

**Optional add-on: failure handling (a third address).** Add a row for a mailbox that does not exist (e.g. `canary-bounce-7f3a@hotmail.com`, item = a third unused Green Bay item). Expect a delivery-failure notice, that recipient closed as `BOUNCED`, the campaign still `ACTIVE`, and the bounce counted in `report`. (One bounce cannot trip the auto-pause, which needs ≥3 and ≥10%.)

## Pass criteria

All of: both emails received from `jerry@getcheckoff.com`; links open the correct items; A's reply recognized and closed with no escalation and no follow-up; B's pause held; B got exactly 3 emails then closed; zero `NEEDS_JERRY` tasks created by the canary; `report` numbers match what happened; Blair's task identical to the snapshot; no Green Bay `items` row changed.

## Blair snapshot (read-only; run before Day 0 and after Day 3, then compare)

```bash
supabase db query --linked "select status, next_check_at, metadata->'bizdev'->>'sequenceStatus' seq, metadata->'bizdev'->>'threadId' thread, jsonb_array_length(metadata->'bizdev'->'stepsSent') steps from agent.tasks where source_ref='living-north-phoenix:blair-ballin'"
# expected until Blair replies or Oct 16: WAITING | 2026-10-16 19:16:16.752+00 | ACTIVE | 1a12c64f60a34d3d | 1
```

## Abort at any point

`pause green-bay-canary` stops all sends immediately (replies still processed). To end it, let it complete or `pause` and leave it.

## Cleanup **[APPROVAL: deletes the canary's own rows]**

```sql
BEGIN;
DELETE FROM business_outreach_tokens WHERE campaign = 'bizdev_green-bay-canary';  -- cascades the canary's submissions
COMMIT;
```

Winston's own canary records (`agent.*`) stay as history; they do not affect the real campaign. Then verify no Green Bay item was changed:
`select count(*) from business_outreach_tokens where campaign like 'bizdev_%'` → 0.
