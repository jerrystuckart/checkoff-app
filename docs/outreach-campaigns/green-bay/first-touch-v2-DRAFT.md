# Revised first touch: experience-v2 (SUPERSEDES the earlier draft; NOT APPROVED, NOT DEPLOYED)

Policy change (Jerry, 2026-10-14): every future first touch now carries BOTH the business's private confirmation link and the safe
public item link, plus the download and Featured Kit links, and talks about a *CheckOff experience*, not a "listing".

Definition: `docs/outreach-campaigns/green-bay/campaign.v2.json` (`firstTouchContract: "experience-v2"`, approvals flags false).
Contract enforced in code: required fields, wording, validation of the token AND the public item page before any first touch,
final link check at send time, download page live at activation. Existing campaigns (green-bay-p1) are untouched; nothing already sent changes.

## Rendered example (920 Sauna Co; the token is a placeholder)

```
Subject: We selected 920 Sauna Co for CheckOff

Hi 920 Sauna Co team,

We're launching CheckOff in Green Bay Metro. It's a free app that helps people discover and check off great local experiences, and we selected 920 Sauna Co as one of the places worth discovering.

CheckOff features specific local experiences rather than creating a conventional business listing. The CheckOff experience we selected for 920 Sauna Co is:

• Settle into a private or community wood-fired sauna session with '920 Sauna Co'.
  See it in CheckOff (public page): https://getcheckoff.com/item/b320c748-9eb2-450a-a91a-59f4fd762629
  Confirm or update it (your private link): https://getcheckoff.com/confirm/<PRIVATE_TOKEN>

To find it in the app, download CheckOff free at https://getcheckoff.com/download, open it, and choose Green Bay Metro: your experience appears there. The public page above also opens it directly on your phone, no sign-in needed.

There is no fee to be included and nothing to sign up for. We feature exceptional businesses for free because a great CheckOff app needs great places.

Two quick things would help:
- Use your private link above to confirm the experience is still accurate, or tell us what to change.
- If you have a photo you'd prefer us to use, add it there or just reply and attach it.

We also made a free set of print, social, Story, and in-business graphics you can use: https://getcheckoff.com/downloads/featured-kit

You can reply to this email any time.

Thanks for being part of it!

Jerry Stuckart
Founder, CheckOff
getcheckoff.com
```
