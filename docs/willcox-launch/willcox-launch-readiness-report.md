# Willcox launch readiness report

Written overnight 2026-10-05 (read-only audit; nothing in production was changed). Festival: Sat Oct 17 and Sun Oct 18, 2026.

## 1. What is live

| Piece | State |
|---|---|
| `/willcox` visitor page | Live. Open-in-app handoff, store buttons, UTM capture to `landing_events`. 3 test views so far. |
| `/willcox/partners` | Live. Search, verify, change request, promo link, upgrade link. Secret items show the hidden-experience state. |
| `/willcox/champion` | Live and locked: 401 without a valid Supabase session and a `destination_champions` row. `noindex`. |
| `/willcox/willcox-pitch.html` | Live, unchanged. |
| Destination "Willcox" | Active. Hero image set. |
| Hub list "Willcox Wine Trail · Anytime 2026" | Linked and active. 25 items (23 active). |
| Spotlight "Fall Festival" | Active, event dates Oct 17 to 18. No image, links to a Facebook post. |
| Tables `destination_item_submissions`, `destination_champions`, `destination_item_decisions` | Applied, RLS on, no policies. Anon cannot read or write them. All three are empty. |
| Featured-kit assets (6 files), hero image, AASA file | All return 200. |
| `/featured`, `/partner-welcome` | Unchanged (`/featured` still redirects to `/partner-welcome`). |

## 2. What is inactive

- **Destination zone `32c6a3e4…`: `is_active = false`.** See section 5.
- Two inactive items: Wings Over Willcox (winter) and Cochise Lake cranes (winter).
- No Champions added yet, so nobody but a CheckOff admin can use `/willcox/champion`.
- No Champion decisions recorded.

## 3. What is incomplete

- **Inventory.** Production holds 26 pilot items (24 active). The Chamber workbook has 66 candidates. 15 match, 3 are ambiguous, 48 need to be added. See `willcox-reconciliation.md`.
- **No verified location data for the 48 new items** (no coordinates, address, Google Place ID or visit profile).
- 27 workbook rows are still Chamber "Discuss".
- Three active pilot items lack geo, place ID or a visit profile: the coffee and Bloody Mary road-trip prompts and the coati/wildlife item.
- Hub list title says "Wine Trail" but holds non-wine items, and its cover emoji is the keycap "10", which renders as the number on some platforms.
- Zone banner text says "25 experiences waiting" (static).
- Willcox items are also on unrelated lists (Tucson Travels, Boys Summer List 2026, Phoenix Summer 2026, Full Vienna List, jenna and luca, Rediscover Downtown Peoria). Not changed.
- Spotlight has no image and a generic "Fall Festival" title.
- No `robots.txt` or sitemap on getcheckoff.com.

## 4. Launch blockers (needs action before Oct 16)

1. **Supabase Auth redirect allow-list is missing `https://getcheckoff.com/willcox/champion`.** Current allow-list: `checkoff://auth/callback`, two `exp://` dev URLs, `/reset-password`, `/partner-portal/dashboard`. Without the entry, a Champion's magic link lands on the home page, not the Champion page. This is a security setting I did not change. Fix: Supabase dashboard, Authentication, URL Configuration, Redirect URLs, add `https://getcheckoff.com/willcox/champion`. Reversible.
2. **Champion emails for Desiree and Lisa.** Not known to the project. Add/remove SQL is in `docs/willcox-partners.md`.
3. **Champion sign-in as built requires an existing CheckOff account** (`shouldCreateUser: false`). A gated fix is built and tested on branch `feat/champion-login-gated` (not deployed). See the login recommendation below.
4. **iOS reach.** The public App Store build is **1.1.9** (released Sep 29). The Hub "You're at / Closest to you" section, the reactive Home arrival card and the `checkoff://destination/<id>` deep link are in **1.1.10**, which is TestFlight only (5 users on it) and not submitted. On 1.1.9 the landing page's "Open Willcox in CheckOff" button opens the app at Home, not the Hub. Decide whether to submit 1.1.10 for App Review in time (suggest submitting by about Oct 12) or to accept the degraded path and rely on the zone arrival card plus Home. Android status was not verified.
5. **The 48 new items cannot go live without geocoding and verification.** Nothing here is applied. Chamber decisions on the 27 Discuss rows are also open.
6. **Zone decision** (below). While inactive, no public user sees a Willcox arrival card or the Closest section.

## 5. Destination zone

| Field | Value |
|---|---|
| id | `32c6a3e4-64d8-4d45-b84d-fa8a9e19814c` |
| is_active | **false** |
| center | 32.2526, -109.8326 (downtown Willcox) |
| radius | 40.2335 km (about 25 miles) |
| linked list | `bbd16ea1…` "Willcox Wine Trail · Anytime 2026"; `curated_list_id` is null |
| banner | "You're in Willcox! 🍷" / "25 experiences waiting — wine, history, and hidden gems." |

**Expected arrival behavior when active:** inside the radius, Home shows an arrival card that opens the Hub (builds with the 12aedec fix follow the live location; older builds only evaluate at cold start, so those users need a fresh app launch while in range). On 1.1.10 the Hub also shows the "You're at / Closest to you" section, which hides entirely while the zone is inactive. Anonymous users can only read active zones (RLS); only Jerry's account can see the inactive row.

**Conflict with the new landing page:** none. The landing page deep-links straight to the Hub and does not depend on the zone. They are complementary: the zone catches visitors who arrive without scanning a QR.

**Radius note:** 25 miles from downtown covers Willcox, Cochise Stronghold and the Playa. Fort Bowie and Chiricahua National Monument are roughly 30 to 40 miles out and likely fall outside. Widening to about 40 miles (64 km) is a business decision.

**Recommendation:** do not activate tonight. Activate on **Thu Oct 15 evening**, after (1) the inventory is loaded and verified, (2) `banner_subtitle` shows the real count and the emoji is checked, (3) Jerry has tested with the GPX files in `docs/hub-location`, and (4) the 1.1.10 decision is made. It is a one-row, instantly reversible change (`update destination_zones set is_active = true where id = '32c6a3e4-64d8-4d45-b84d-fa8a9e19814c'`). Activating before Wine Festival weekend is appropriate; activating the day of leaves no room to catch problems.

## 6. Business-owner workflow test (live data)

| Case | Result |
|---|---|
| Normal business (Big Tex BBQ) | Shows exact text, address, no website. OK. |
| Secret business (Strive Vineyards) | Hidden-experience message, only name searchable, no body/address/website. OK. |
| Winery (Aridus, Bodega Pierce, Flying Leap) | OK. |
| Restaurant (Rix's Tavern) | OK. |
| Museum (Rex Allen, Chiricahua Regional Museum) | OK. |
| Public attraction / park (Chiricahua NM, Fort Bowie, Cochise Stronghold, Massai Point, Willcox Playa) | Currently listed. A park service or the BLM is not who the page is for. |
| Street (Railroad Avenue) | Currently listed as a "business". |

**Recommended filter:** hide places by `items.visit_profile_key`. Hide `landmark`, `manual_only` and `outdoor`; show everything else, and always show secret items. On today's data that lists 11 of the 19 named places correctly, and hides all public parks and trails, but it also wrongly hides **Apple Annies Orchard** (profile `outdoor`, a business) and would show new items that have no profile yet. So pair it with an explicit override: add a nullable `owner_lookup boolean` column to `destination_item_decisions` (Champion/admin can set it per item) where `true` forces listing and `false` forces hiding. Not built tonight; a small post-festival change. Until then the business "not found" message already points owners to hello@getcheckoff.com.

## 7. Champion login recommendation

Keep `shouldCreateUser: false` **only if** you personally onboard Des and Lisa with explicit steps. Otherwise take the gated option, which is built and tested locally on branch `feat/champion-login-gated` (commit `e246010`, not deployed).

Do **not** simply flip the page to `shouldCreateUser: true`: Supabase sign-ups are open and every new auth user creates a `public.users` row, so anyone could create CheckOff accounts and trigger emails to arbitrary addresses from that page, and fake registrations would pollute the launch metrics.

The gated version posts the email to `/api/destination-champion-login`. The server checks `destination_champions` first; only a listed, active email gets a link, and account creation is allowed only for that email. The response is identical either way (no enumeration). It grants nothing by itself: `/api/destination-champion` still requires a `destination_champions` row on every request (tested: a signed-in, unlisted account gets 401). Not tested against live GoTrue because that needs a real inbox. To test: add yourself as a Champion, sign in from `/willcox/champion`, and confirm the redirect allow-list fix above first.

Side effect: Champions get a normal CheckOff account (and show up in "new users"). Exclude them from reports if needed.

## 8. SEO / indexing

| Page | Today | Recommendation |
|---|---|---|
| `/willcox` | No robots tag (indexable), no canonical | Indexable, add canonical. |
| `/willcox/partners` | No robots tag, no canonical | Neutral/indexable is fine, add canonical. |
| `/willcox/champion` | `noindex, nofollow` | Keep. |
| `/willcox/willcox-pitch.html` | No robots tag | `noindex, follow`. Stays fully accessible. |

Safe metadata is committed on branch `chore/willcox-seo-metadata` (commit `6330828`, not deployed). `/robots.txt` and `/sitemap.xml` return 404; neither is needed for launch.

## 9. Other risks

- **Test email:** my smoke test sent one change-request notification to `FORWARD_TO_EMAIL`. If it never arrived, check the Resend config (not verified).
- **Analytics gaps:** no visitor id (unique visitors not measurable), and no link between a landing visit and an app user (installs cannot be attributed). Documented in the analytics file.
- **Existing test data:** Willcox check-ins in production total 5, all from Jerry's admin account.
- **Public app listing is "CheckOff - Do More"** on iOS; Google Play version was not checked.

## 10. Priority view

**Before Oct 16:** items 1 to 6 in section 4.

**Nice to have before the festival:** Spotlight image and title, Hub list rename and emoji, review of the unrelated lists holding Willcox items, merging the SEO branch, merging the gated-login branch.

**Safe to wait until after Oct 18:** the `owner_lookup` override, an anonymous visitor id for unique-visitor counts, an admin-tool review panel for the submissions queue, per-business QR codes, Champion outreach-status tracking, `robots.txt`/sitemap, widening the zone radius, seasonal list for Wings Over Willcox and the cranes.
