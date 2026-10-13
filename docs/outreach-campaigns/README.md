# Business outreach campaigns (Winston)

How to run a multi-business email campaign (Green Bay first) on Winston's existing infrastructure.
Nothing here sends mail until you approve a specific, previewed list and then activate it.

## What you supply

1. **A CSV** exported from the final spreadsheet (one row per business + CheckOff item).
2. **A campaign definition** (`campaign.json`) holding the approved templates and settings.

### CSV columns

| Column | Required | Notes |
|---|---|---|
| `business_name` | yes | |
| `contact_email` | yes | one address per row; contact-form-only businesses can't be emailed |
| `item_id` | yes | the live CheckOff item UUID; the item text always comes from the database |
| `contact_name` | no | only needed if a template uses `{{contact_name}}` |
| `metro` | no | warns if it differs from the campaign's metro |
| `website`, `source_url`, `confidence` | no | kept for your review |
| `excluded_reason` | no | any text here removes the row from the campaign |

The headers used in the earlier workbooks (`Business`, `Best Researched Email`, `Item ID`, …) are accepted as aliases.
A working example: [`sample/green_bay_sample.csv`](sample/green_bay_sample.csv).

### Merge fields

`{{business_name}}` `{{contact_name}}` `{{metro}}` `{{items_block}}` (every listing with its own confirm link)
`{{item_text}}` `{{item_count}}` `{{kit_url}}` (always the canonical Business Activation Kit) `{{confirm_url}}` (first listing) `{{sender_name}}`.
An unknown or empty field is an error, never a blank. The first-touch email must contain `{{items_block}}` so every business gets its existing `/confirm/<token>` link.

### Campaign definition

See [`sample/campaign.sample.json`](sample/campaign.sample.json). Key settings: `dailyCap` (default **80**), `cadence`
(default **5 → 7 → 7** business days), `faqEnabled` (default off), `allowPriorOutreach` (default off), optional `expiresAt` (hard stop; always use it for canaries), and `approvals`.
The two `approvals` flags must be `true` and the templates must contain no draft markers ("DRAFT, NOT APPROVED", "TODO", …) before `approve` will run.

## Launch steps

```bash
CLI="npx tsx agent-service/outreachCampaignCli.ts"

# 1. PREVIEW. Read-only. Writes files only; nothing goes to the database or Gmail.
$CLI preview --csv green_bay.csv --campaign campaign.json [--gmail-check]
#    -> agent-service/.outreach-preview/<key>/preview.md  (every message, every issue, the preview hash)
#    --gmail-check also searches Gmail Sent for prior emails to each address (read-only).

# 2. REVIEW preview.md. Fix every ERROR; read the warnings and the exclusions.

# 3. APPROVE (the only step that writes campaign records). Needs the exact count + hash from the preview.
$CLI approve --csv green_bay.csv --campaign campaign.json \
  --confirm-recipients <N> --preview-hash <hash> --templates-approved \
  --token-sql-out ./green_bay_tokens.sql
#    Queues one task per recipient. Mints confirmation tokens ONLY now and writes them to the SQL file. Sends nothing.

# 4. APPLY the token SQL (same way as the earlier token seeds):
supabase db query -f ./green_bay_tokens.sql --linked

# 5. ACTIVATE. Verifies tokens exist, jerry@getcheckoff.com is a verified send-as, and the kit URL is live.
$CLI activate <campaignKey>
#    From here the monitor sends up to 80/day (25 per 15-minute tick), then follows up on schedule.

# Any time
$CLI report <campaignKey>     # progress, replies by class, confirmations, bounces, pending follow-ups, NEEDS_JERRY
$CLI pause  <campaignKey>     # no first touches or follow-ups; replies are still processed
$CLI resume <campaignKey>
```

The monitor must be running the code that includes this feature (merge, then
`launchctl kickstart -k gui/$(id -u)/com.checkoff.chief-monitor`; launchd restarts it within 5 minutes).

### Recommended: run a canary first

The approve/activate database writes and the live sending path have been verified with fakes and with a read-only
preview against the real database, but they have not yet run for real. Before the real Green Bay list, run the same
steps for a **2-row canary campaign** (key `green-bay-canary`, two real Green Bay `item_id`s, addresses you control).
It exercises approve → token SQL → activate → first touch → reply → confirmation end to end at negligible risk.

## What happens after activation

| Event | Winston does |
|---|---|
| Daily capacity (80, minus anything else sent from `jerry@getcheckoff.com` in the last 24h, never above provider limit − reserve) | sends up to that many; **pauses rather than exceeds** |
| Send fails | outcome treated as **uncertain**: recorded, never retried; Winston checks Gmail Sent for it. Rate-limit/auth errors or 3 failures in a row pause the whole campaign |
| No reply after 5 business days | Follow-Up 1 (in the same thread, `Re:`) |
| Still nothing 7 business days later | Follow-Up 2, then close after 7 more. Max 3 emails. No email at close |
| Short, clear "yes, accurate" | recorded, task `DONE`. **Not** sent to Jerry |
| Correction requested | `NEEDS_JERRY` with the exact wording. Winston never edits or publishes a listing |
| Photo attached/offered | `NEEDS_JERRY` with instructions (existing cover-candidate moderation). Never published automatically |
| Partnership interest, pricing, meeting request, unclear | `NEEDS_JERRY` with a full handoff summary |
| "Contact me in 2 weeks" | follow-ups stop; handed to Jerry on that date (uses `followUpEngine.parseRequestedWait`) |
| Decline | task `CANCELED`, follow-ups stop |
| Opt-out | contact marked `DO_NOT_CONTACT`, follow-ups stop, never emailed again by any campaign |
| Out-of-office | ignored; the sequence continues |
| Address bounce | that recipient closed; ≥3 bounces **and** ≥10% of first touches pauses the campaign |
| Our own sender breaks (e.g. 535 send-as bounce) | campaign **paused**, campaign task `NEEDS_JERRY` |
| Any substantive reply | all pending follow-ups to that business are cancelled immediately |

Replies are found with **two Gmail list queries per tick for the whole campaign** (subject stem + bounces),
not one search per recipient; already-handled mail is never fetched again.

### Health alerts

Repeated monitor failures (3 consecutive 15-minute checks) open a `NEEDS_JERRY` task titled "Monitor health: …"
(Gmail authorization, Gmail poll, business-outreach tick, or sending), with the exact repair steps. It resolves itself on the first healthy check.
It appears in the Chief Brief like any other task.

## Reused versus new

| Reused unchanged | Extended | New |
|---|---|---|
| `RealGmailAdapter` (send, list, send-as check) | `googleAdapters.ts`: optional `searchMessageIds`, attachment metadata | `outreachTemplates.ts` (merge renderer) |
| `agent.contacts / tasks / interactions`, existing `TaskStatus` set | `bizDevOutreach.ts`: same engine, now also campaigns (Blair untouched) | `outreachCampaign.ts` (CSV, validation, consolidation, preview, approval, report) |
| `business_outreach_tokens` + `/confirm/<token>` site flow + cover-candidate moderation | `standingAuthority.ts`: `bizdev_campaign.*` operations | `outreachCampaignDb.ts` (DB lookups/writer) |
| `businessActivationKit.ts` (kit-reference validation + canonical URL) | `monitorCli.ts`: health tracking + the bizdev tick | `outreachCampaignCli.ts` |
| `followUpEngine.parseRequestedWait`, `classifyReply` | | `bizDevReplies.ts` (classifier moved out of `bizDevOutreach.ts`, re-exported) |
| launchd `com.checkoff.chief-monitor`, Chief Brief, `NEEDS_JERRY` | | `bizDevCampaign.ts` (cap math), `monitorHealth.ts` |

No new tables, no new task statuses, no second scheduler, no second Gmail adapter.

## Known limits

- Winston counts what it can see in **Gmail Sent**. Mail sent through the same Resend account by other systems (app notifications, the monthly recap) is invisible to it, so the default `reserve` of 10 leaves headroom under the 100/day account limit.
- An emailed "yes" is recorded on the task and interactions; it does **not** write `business_confirmation_submissions` (the site API remains the only writer, so confirmations aren't duplicated).
- Photos sent by email are not ingested automatically. They need your approval through the existing moderation path.
- Business days are Monday to Friday with no holiday calendar.
- Replies where the business changes the subject line are not auto-matched; they land in the monitor's existing "needs review" list.
- The health alert runs inside the monitor; if the monitor process itself is dead, launchd restarts it, but there is no external watchdog.

## Production operation (roster approval, daily queue, digest)

- **One approval per roster.** `preview` the whole verified roster, then `approve` once. If the campaign already exists, `approve` *appends*: it adds only the previewed recipients and leaves status, schedule, counters and history alone. It refuses a changed template, a completed/expired campaign, an item already assigned to someone else, and duplicate tokens. It is safe to re-run after a partial failure.
- **Tokens gate sending.** A queued recipient is held until every token exists in `business_outreach_tokens` and points at its approved item. Apply the token SQL; recipients that are ready are never blocked by ones that are not.
- **Daily queue.** The monitor sends at most `firstTouchDailyLimit` (default **50**) NEW first touches per rolling 24h, only after due follow-ups, never beyond the shared sender cap (80/day, provider limit 100 minus reserve), and holding back capacity for follow-ups due within 24h. All campaigns on one sender share one budget. Weekend sends are allowed.
- **Daily check-in.** `npx tsx agent-service/outreachCampaignCli.ts digest [campaignKey]` prints a five-line summary per campaign (read-only). Nothing needs approving day to day; `NEEDS YOU` in the digest is the only prompt.
- **Test/canary tokens.** Give every test or canary campaign a key ending in `-test` or `-canary`. Their token rows are never reused by a production plan (a real campaign mints fresh tokens for those items); the rows, history and emailed links are left untouched. There is no revoke state in `business_outreach_tokens`, and the supported way to retire a token is this planning rule, not deletion.
- **Contact evidence.** Before a roster is approved, each address must appear publicly on the business's own site or a page about the business; partner/chamber citations must be re-checked live (a 2026-10-12 check failed 2 of 3). Never guess or substitute addresses.
