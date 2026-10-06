# Willcox Wine Festival launch checklist

Festival: **Sat Oct 17 and Sun Oct 18, 2026.** Owner in brackets: J = Jerry, C = Chamber, B = business. Rough order of risk first.

## Before Oct 16

**Gating items (do first)**
- [ ] Signed agreement (J, C)
- [ ] Invoice sent and payment status known (J)
- [ ] Decide iOS: submit 1.1.10 for App Review by about Oct 12, or accept that 1.1.9 users land on Home instead of the Hub (J). Check Android too.
- [ ] Add `https://getcheckoff.com/willcox/champion` to the Supabase Auth redirect URLs (J)
- [ ] Get Desiree's and Lisa's emails, add them to `destination_champions` (SQL in `docs/willcox-partners.md`), then merge branch `feat/champion-login-gated`, and have each sign in once (J)

**Content**
- [ ] Chamber answers the 27 "Discuss" rows in the review workbook (C)
- [ ] Content approved: final wording for Include rows (C, J)
- [ ] Production inventory loaded: review `docs/willcox-launch/willcox-launch-inventory-DRAFT.sql`, geocode new items, set visit profiles, then insert and activate (J). Needs your approval first.
- [ ] Hub lists live: Hub list renamed if wanted, emoji checked, curated additions added, retire the generic coffee, Bloody Mary and downtown-meal prompts if approved (J)
- [ ] Spotlight ready: add an image, a clear title ("Willcox Wine Festival"), confirm link and Oct 17 to 18 dates (J)
- [ ] Zone decision: widen radius?, set the real item count in the banner, test with GPX files, then activate on **Thu Oct 15 evening** (J)

**Distribution**
- [ ] QR codes tested on iPhone and Android: consumer `/willcox?utm_source=...`, business-owner `/willcox/partners?utm_source=business_owner_handout&utm_medium=qr&utm_campaign=willcox_launch_2026` (J)
- [ ] Business materials ready: handouts, clings, table tents, promo kit link (J)
- [ ] Chamber email and social sent with the `/willcox` link (C)
- [ ] Participating businesses activated: each has been contacted, found `/willcox/partners`, and verified or requested a change (J, C). Use analytics query B4 for the unverified list.
- [ ] Merge `chore/willcox-seo-metadata` (J)
- [ ] Run the analytics queries once to confirm they return rows (J)

## Friday Oct 16
- [ ] Business visits: wineries and downtown first (J)
- [ ] Hand out clings and table tents; point owners to `getcheckoff.com/willcox/partners`
- [ ] Item verification: check the review queue on `/willcox/champion` (J)
- [ ] Photography and content corrections: fix wording or details owners flag (J)
- [ ] Spot-check `/willcox`, `/willcox/partners` on a phone; confirm the Hub opens in the app

## Saturday Oct 17
- [ ] Festival signage up (J, C)
- [ ] CheckOff table staffed, QR visible (J)
- [ ] Roaming winery and vendor outreach, capture any missing places in a note (J)
- [ ] Live analytics checks at noon and evening: T1 and T2 for traffic, E4 for checkoffs, B1 for business activity (J)
- [ ] Watch for app problems and note anything reported at the table

## Sunday Oct 18
- [ ] Second-day activation: repeat signage and outreach (J)
- [ ] Follow up with businesses that visited the page but did not verify (J)
- [ ] Capture missing places and corrections from the weekend (J)
- [ ] Evening analytics snapshot (T1, E1, E4)

## Oct 19 to 25
- [ ] Post-launch analytics: run the full `docs/willcox-launch-analytics.sql` (E5 compares festival to the following 7 days)
- [ ] Chamber recap: run `docs/willcox-chamber-launch-report.sql` and build the "Willcox Destination Hub Launch Results" summary (J)
- [ ] Business follow-up: thank verified businesses, resolve change requests, update item text (J)
- [ ] Corrections: apply approved change requests, mark them applied in the Champion page (J)
- [ ] Case-study notes: what worked, quotes, photos, what to change for the next Hub (J)
