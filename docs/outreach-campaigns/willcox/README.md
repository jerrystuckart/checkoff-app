# Willcox launch outreach (2026-10-16)

Two campaigns on the existing Winston engine, sender jerry@getcheckoff.com. Templates are the wording Jerry supplied on 2026-10-16.

| Campaign | Definition | Contract | Sent |
|---|---|---|---|
| `willcox-launch-featured-v1` | `campaign.featured.json` | `experience-v2` (exact experience, public item link, private confirmation token, download + kit links) | 14 businesses / 16 experiences |
| `willcox-launch-invitation-v1` | `campaign.invitation.json` | `invitation-v1` (no experience, token or item link) | 10 businesses |

## Engine additions (this branch)
- `firstTouchContract: 'invitation-v1'`: invitation to participate. `item_id` is optional and refused on a row; the templates may not use any experience/token/item field or a `/confirm` or `/item` link. Approval mints no tokens.
- `kitUrl`: points `{{kit_url}}` at a Destination Hub kit page (`https://getcheckoff.com/willcox/kit`) instead of the universal Featured Kit.
- `destinationCampaign`: Destination Hub items carry no metro, so the metro-match check becomes "the item must have no metro".
- `FOLLOW_UPS_HELD_CAMPAIGNS` (`bizDevCampaign.ts`): follow-up and close steps never become due for the held campaigns. Both Willcox campaigns are held, with the 30-business-day cadence left in place (first would otherwise be ~2026-11-27). Replies, bounces and opt-outs are unaffected.

## Releasing the follow-ups
Follow-up wording in both definitions is NOT approved for sending. Once Jerry approves the wording, remove the campaign key from `FOLLOW_UPS_HELD_CAMPAIGNS`, restart the monitor (`launchctl kickstart -k gui/$(id -u)/com.checkoff.chief-monitor`). Changing wording needs a new campaign key (template hash).

## Not in git
Recipient CSVs and the confirmation-token SQL are kept out of the repository (they hold contact addresses and private tokens).
