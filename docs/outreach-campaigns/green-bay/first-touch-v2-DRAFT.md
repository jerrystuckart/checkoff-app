# Revised first touch (DRAFT, NOT APPROVED, NOT DEPLOYED)

Problem (920 Sauna Co, 2026-10-14): the email said the business was "already featured in the app" but gave no way to find the experience.
Rules applied: say "CheckOff experience" (never "listing"); include the download link; say where it appears in the app; NO private confirmation token in a cold first touch.

**Subject:** We selected {{business_name}} for CheckOff

```
Hi {{business_name}} team,

We're launching CheckOff in {{metro}}. It's a free app that helps people discover and check off great local experiences, and we selected {{business_name}} as one of the places worth discovering.

CheckOff features specific local experiences rather than traditional business profiles. The CheckOff experience we selected for {{business_name}} is:

{{experiences_block}}

You can see it here (no sign-in or private link needed):
{{experience_link}}

To find it in the app, download CheckOff free at https://getcheckoff.com/download, then open it and browse {{metro}}. Your experience appears there, and the link above opens it directly on your phone.

There is no fee to be included and nothing to sign up for. We feature exceptional businesses for free because a great CheckOff app needs great places.

Two quick things would help:
- Reply and let us know if the experience is still accurate, or what you'd like changed.
- If you have a photo you'd prefer us to use, just reply and attach it.

We also made a free set of print, social, Story, and in-business graphics you can use: https://getcheckoff.com/downloads/featured-kit

You can reply to this email any time.

Thanks for being part of it!

Jerry Stuckart
Founder, CheckOff
getcheckoff.com
```

`{{experience_link}}` = `https://getcheckoff.com/item/<item_id>` (public; one line per experience when a business has several).

## Needed engine changes (not made)
- New merge fields `experiences_block` (item text only, no tokens), `experience_link` (public item URL), `download_url`.
- `firstTouchBody` validation: require `experiences_block` OR `items_block`; add a guard that a tokenless first touch contains no `/confirm/` URL.
- Follow-up templates: replace "listing" with "CheckOff experience" (follow-up 1 keeps its private confirm link by design).
