# Experience-v2 dry run (NO sends, NO database writes; tokens are DRYRUN placeholders)

Singular wording is used automatically for one experience and plural wording for several.

## A. Final first touch, ONE experience (singular, unchanged from the approved text)

**To:** recipient-1@example.invalid   **Subject:** We selected 920 Sauna Co for CheckOff

```
Hi 920 Sauna Co team,

We're launching CheckOff in Green Bay Metro. It's a free app that helps people discover and check off great local experiences, and we selected 920 Sauna Co as one of the places worth discovering.

CheckOff features specific local experiences rather than creating a conventional business listing. The CheckOff experience we selected for 920 Sauna Co is:

• Settle into a private or community wood-fired sauna session with '920 Sauna Co'.
  See it in CheckOff (public page): https://getcheckoff.com/item/b320c748-9eb2-450a-a91a-59f4fd762629
  Confirm or update it (your private link): https://getcheckoff.com/confirm/DRYRUN_TOKEN_AAAA

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

## B. First touch, TWO experiences (plural wording, each with its own links)

**To:** recipient-2@example.invalid   **Subject:** We selected Vintage Cantina for CheckOff

```
Hi Vintage Cantina team,

We're launching CheckOff in Green Bay Metro. It's a free app that helps people discover and check off great local experiences, and we selected Vintage Cantina as one of the places worth discovering.

CheckOff features specific local experiences rather than creating a conventional business listing. The CheckOff experiences we selected are:

• Create your own custom taco creations or head upstairs for tiki-inspired cocktails at 'Vintage Cantina'.
  See it in CheckOff (public page): https://getcheckoff.com/item/9c98a22a-2f49-4a36-b6d6-34813d27a88e
  Confirm or update it (your private link): https://getcheckoff.com/confirm/DRYRUN_TOKEN_BBBB

• Go off-script with one of the inventive tacos at 'Vintage Cantina'.
  See it in CheckOff (public page): https://getcheckoff.com/item/5e48418b-3b7d-4e6d-98af-db42c103926a
  Confirm or update it (your private link): https://getcheckoff.com/confirm/DRYRUN_TOKEN_CCCC

To find them in the app, download CheckOff free at https://getcheckoff.com/download, open it, and choose Green Bay Metro: your experiences appear there. The public pages above also open them directly on your phone, no sign-in needed.

There is no fee to be included and nothing to sign up for. We feature exceptional businesses for free because a great CheckOff app needs great places.

Two quick things would help:
- Use your private links above to confirm the experiences are still accurate, or tell us what to change.
- If you have a photo you'd prefer us to use, add it there or just reply and attach it.

We also made a free set of print, social, Story, and in-business graphics you can use: https://getcheckoff.com/downloads/featured-kit

You can reply to this email any time.

Thanks for being part of it!

Jerry Stuckart
Founder, CheckOff
getcheckoff.com
```

## C. Follow-Up 1, one experience

**To:** recipient-1@example.invalid   **Subject:** Re: We selected 920 Sauna Co for CheckOff

```
Hi 920 Sauna Co team,

Just following up on the CheckOff experience we sent over for 920 Sauna Co.

We're helping people discover great local places around Green Bay, and we'd love to make sure we've represented your business accurately.

You can review your CheckOff experience here:

• Settle into a private or community wood-fired sauna session with '920 Sauna Co'.
  Confirm or update it here: https://getcheckoff.com/confirm/DRYRUN_TOKEN_AAAA

If everything looks good, a quick confirmation is all we need. If something needs changing, just reply and let me know.

Thanks!

Jerry
Founder, CheckOff
jerry@getcheckoff.com
```

## C2. Follow-Up 1, two experiences

**To:** recipient-2@example.invalid   **Subject:** Re: We selected Vintage Cantina for CheckOff

```
Hi Vintage Cantina team,

Just following up on the CheckOff experiences we sent over for Vintage Cantina.

We're helping people discover great local places around Green Bay, and we'd love to make sure we've represented your business accurately.

You can review your CheckOff experiences here:

• Create your own custom taco creations or head upstairs for tiki-inspired cocktails at 'Vintage Cantina'.
  Confirm or update it here: https://getcheckoff.com/confirm/DRYRUN_TOKEN_BBBB

• Go off-script with one of the inventive tacos at 'Vintage Cantina'.
  Confirm or update it here: https://getcheckoff.com/confirm/DRYRUN_TOKEN_CCCC

If everything looks good, a quick confirmation is all we need. If something needs changing, just reply and let me know.

Thanks!

Jerry
Founder, CheckOff
jerry@getcheckoff.com
```

## D. Follow-Up 2, one experience

**To:** recipient-1@example.invalid   **Subject:** Re: We selected 920 Sauna Co for CheckOff

```
Hi 920 Sauna Co team,

One last note about 920 Sauna Co on CheckOff.

We're building a local discovery app that encourages people to get out and experience places worth visiting around Green Bay.

We'd still love your input on the CheckOff experience:

https://getcheckoff.com/confirm/DRYRUN_TOKEN_AAAA

There's no cost to confirm your information, and you're welcome to reply with corrections.

I'll leave it here after this message. Thanks for everything you do for the Green Bay community!

Jerry
Founder, CheckOff
jerry@getcheckoff.com
```

## D2. Follow-Up 2, two experiences (links EVERY experience)

**To:** recipient-2@example.invalid   **Subject:** Re: We selected Vintage Cantina for CheckOff

```
Hi Vintage Cantina team,

One last note about Vintage Cantina on CheckOff.

We're building a local discovery app that encourages people to get out and experience places worth visiting around Green Bay.

We'd still love your input on the CheckOff experiences:

https://getcheckoff.com/confirm/DRYRUN_TOKEN_BBBB
https://getcheckoff.com/confirm/DRYRUN_TOKEN_CCCC

There's no cost to confirm your information, and you're welcome to reply with corrections.

I'll leave it here after this message. Thanks for everything you do for the Green Bay community!

Jerry
Founder, CheckOff
jerry@getcheckoff.com
```

## E. Recipient-specific link proof (3 simulated recipients, automated assertions)

| Recipient | Message | Own links | Cross-recipient leakage |
|---|---|---|---|
| 920 Sauna Co (1 experience, singular wording) | first touch | every item's own confirm link + own public item link: yes | any other recipient's token or item: none |
| 920 Sauna Co (1 experience, singular wording) | follow-up 1 | every item's own confirm link: yes | any other recipient's token or item: none |
| 920 Sauna Co (1 experience, singular wording) | follow-up 2 | every item's own confirm link: yes | any other recipient's token or item: none |
| Vintage Cantina (2 experiences, plural wording) | first touch | every item's own confirm link + own public item link: yes | any other recipient's token or item: none |
| Vintage Cantina (2 experiences, plural wording) | follow-up 1 | every item's own confirm link: yes | any other recipient's token or item: none |
| Vintage Cantina (2 experiences, plural wording) | follow-up 2 | every item's own confirm link: yes | any other recipient's token or item: none |
| Plae Bistro (1 experience, singular wording) | first touch | every item's own confirm link + own public item link: yes | any other recipient's token or item: none |
| Plae Bistro (1 experience, singular wording) | follow-up 1 | every item's own confirm link: yes | any other recipient's token or item: none |
| Plae Bistro (1 experience, singular wording) | follow-up 2 | every item's own confirm link: yes | any other recipient's token or item: none |

All assertions passed.
