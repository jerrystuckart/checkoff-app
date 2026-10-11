> Generated from the SAMPLE CSV and SAMPLE templates in this folder, using fake data. No database or Gmail was touched.

# Campaign preview: Green Bay business outreach (SAMPLE) (green-bay-2026-10)

Generated 2026-10-19T15:00:00.000Z. **Nothing has been sent and nothing has been written to the database.**

## Summary

- CSV rows read: 5
- **Recipients (after consolidation): 3**
- Listings across those recipients: 4
- Excluded rows/contacts: 1
- Errors: 2 · Warnings: 0
- Confirmation tokens: 0 existing reused, 4 new (minted only at approval; SQL is emitted for you to apply)
- Sender: jerry@getcheckoff.com · daily cap 80/day → about 1 sending day(s) for first touches
- Cadence per recipient (illustrative if the first email went out 2026-10-19): Follow-Up 1 ~2026-10-26 (5 business days), Follow-Up 2 ~2026-11-04 (+7), close ~2026-11-13 (+7). Max 3 emails per recipient. No follow-up goes to anyone who confirmed, declined, opted out, or replied.
- Templates approved by you: first touch **YES**, follow-ups **YES**
- **Preview hash (required by `approve`): `5f1d5ae6306497d9`** · template hash `33753d8dd9f8866b`

## Errors (must be fixed before approval)

- followUp1Body still contains a draft/placeholder marker; replace it with the approved text (flipping the approval flag alone cannot send placeholder copy)
- followUp2Body still contains a draft/placeholder marker; replace it with the approved text (flipping the approval flag alone cannot send placeholder copy)

## Excluded

- Sample Chain Store <corporate@chain.example.com> (row 6): Sheet marks this row excluded: Chain / not locally owned

## Follow-up templates (rendered for the first recipient)

### Follow-Up 1

```
DRAFT, NOT APPROVED. Replace before approval.

Hi Sample Brewing team,

Just following up on my note about your CheckOff feature:

• Ask the brewer about the seasonal pour at 'Sample Brewing'
  Confirm or update it here: https://getcheckoff.com/confirm/NEW_TOKEN_1

A quick confirmation (or a correction) is all we need.

Thanks,
Jerry Stuckart
Founder, CheckOff
```

### Follow-Up 2

```
DRAFT, NOT APPROVED. Replace before approval.

Hi Sample Brewing team,

One last note from me about your CheckOff feature. If it looks right, there is nothing more to do; if anything should change, this link takes a minute: https://getcheckoff.com/confirm/NEW_TOKEN_1

Thanks,
Jerry Stuckart
Founder, CheckOff
```

## Every first-touch message

### Sample Brewing <hello@sample-brewing.example.com>
Listings: 1 · source rows: 4

**Subject:** We selected Sample Brewing for CheckOff

```
Hi Sample Brewing team,

We're launching CheckOff across Green Bay Metro, and we selected Sample Brewing as one of the local places worth discovering.

Your business is already featured in the app:

• Ask the brewer about the seasonal pour at 'Sample Brewing'
  Confirm or update it here: https://getcheckoff.com/confirm/NEW_TOKEN_1

There is no fee to be included, and you don't need to sign up for anything. We feature exceptional businesses for free because a great CheckOff app needs great places.

We'd love your help with two quick things:
- Use the link above to confirm the experience is still accurate, or tell us what to change.
- If you have a photo you'd prefer us to use, you can add it there, or just reply to this email and attach it.

We also created a free set of print, social, Story, and in-business graphics you can use to help customers discover your CheckOff: https://getcheckoff.com/downloads/featured-kit

You can reply to this email any time.

Thanks for being part of it!

Jerry Stuckart
Founder, CheckOff
getcheckoff.com
```

### Sample Museum <info@sample-museum.example.com>
Listings: 1 · source rows: 5

**Subject:** We selected Sample Museum for CheckOff

```
Hi Sample Museum team,

We're launching CheckOff across Green Bay Metro, and we selected Sample Museum as one of the local places worth discovering.

Your business is already featured in the app:

• Find the oldest exhibit at 'Sample Museum'
  Confirm or update it here: https://getcheckoff.com/confirm/NEW_TOKEN_1

There is no fee to be included, and you don't need to sign up for anything. We feature exceptional businesses for free because a great CheckOff app needs great places.

We'd love your help with two quick things:
- Use the link above to confirm the experience is still accurate, or tell us what to change.
- If you have a photo you'd prefer us to use, you can add it there, or just reply to this email and attach it.

We also created a free set of print, social, Story, and in-business graphics you can use to help customers discover your CheckOff: https://getcheckoff.com/downloads/featured-kit

You can reply to this email any time.

Thanks for being part of it!

Jerry Stuckart
Founder, CheckOff
getcheckoff.com
```

### Sample Cafe <owner@sample-cafe.example.com>
Listings: 2 · source rows: 2, 3

**Subject:** We selected Sample Cafe for CheckOff

```
Hi Sample Cafe team,

We're launching CheckOff across Green Bay Metro, and we selected Sample Cafe as one of the local places worth discovering.

Your business is already featured in the app:

• Order the Packers-style burger at 'Sample Cafe'
  Confirm or update it here: https://getcheckoff.com/confirm/NEW_TOKEN_1

• Try the cheese curds at 'Sample Cafe'
  Confirm or update it here: https://getcheckoff.com/confirm/NEW_TOKEN_2

There is no fee to be included, and you don't need to sign up for anything. We feature exceptional businesses for free because a great CheckOff app needs great places.

We'd love your help with two quick things:
- Use the link above to confirm the experience is still accurate, or tell us what to change.
- If you have a photo you'd prefer us to use, you can add it there, or just reply to this email and attach it.

We also created a free set of print, social, Story, and in-business graphics you can use to help customers discover your CheckOff: https://getcheckoff.com/downloads/featured-kit

You can reply to this email any time.

Thanks for being part of it!

Jerry Stuckart
Founder, CheckOff
getcheckoff.com
```
