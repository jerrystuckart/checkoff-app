# Founding 500 retirement: audit and replacement plan

Status: AUDIT ONLY (2026-10-14). No copy, schema or deployment changes made. Awaiting review.

Repos searched: `checkoff` (app, Supabase functions, admin, docs), `getcheckoff-site` (website), `checkoff-resend-email-system`, `checkoff_admin.html`.
Terms: Founding 500, Founding Member/User, First 500, founder number, member number, early adopter, claim your, early access, scarcity language.

## A. Consumer-facing "Founding 500" / scarcity (CHANGE)

| # | File | Existing copy | Proposed | Action |
|---|------|---------------|----------|--------|
| A1 | getcheckoff-site `public/join/index.html:7` | `<title>CheckOff — Join the first 500</title>` | `CheckOff — Your city has more to discover` | Replace |
| A2 | same `:191` | eyebrow `Founding 500` | Remove the eyebrow. For list/destination invites use the list or destination name as context. | Remove |
| A3 | same `:203` | "Join the first 500 founding users before partner spots open." | "Free to join. More to experience." | Replace |
| A4 | same `:204-205` | Check off experiences, local spots... / Share lists with your crew and stop defaulting to "I don't know." | Keep the first. Reword the second: "Share lists with your crew and find your next thing to do together." | Light edit |
| A5 | same `:201` | subcopy "Get one fun thing to do, save ideas with friends, and start checking off more of your city." | "Hidden gems. Local favorites. Unexpected adventures. Find your next experience and CheckOff the good stuff." Keep list or destination context when an invite code exists. | Replace |
| A6 | same `:211-212` | CTAs "Join the TestFlight beta" and "Follow @checkoff.app for launch access"; helper text "App Store and TestFlight links can be added here..." | Beta and launch-access language is stale post-launch. Primary CTA becomes "Start Exploring" (App Store or Google Play). The helper text is a visible dev note. | Replace, review |
| A7 | `public/join/join-page.test.js` | Asserts existing copy | Update with the new copy | Update test |

## B. Pre-signup first impression (UPDATE POSITIONING)

| # | File | Existing | Proposed |
|---|------|----------|----------|
| B1 | site `public/index.html:6-7` (title, meta description) | "Your city. Your crew. Check it off." / "Stop saying 'I don't know, what do YOU want to do?'..." | Title: "CheckOff — Your city has more to discover". Description: "Hidden gems. Local favorites. Unexpected adventures. Find your next experience and CheckOff the good stuff." |
| B2 | same, tagline + buttons + feature pills | Crew/bucket-list framing; "Download on the App Store" | Headline "Your city has more to discover." Supporting copy as specified. Buttons: "Start Exploring" (store links kept). Pills: Curated local lists, Hidden gems, Check off what you've done, Explore with friends. |
| B3 | site `public/download/index.html` | "Discover the best local experiences — check them off, earn points, explore more." | Already close to the new voice. Align to the supporting copy. |
| B4 | site `public/android/index.html:7,10` | "CheckOff is live on Android. Build lists..., compete on a leaderboard" | Align meta and OG to the new voice. No founding copy in the repo (memory says it once said "Founding 500", so **verify the live page**). |
| B5 | site `public/list`, `/c`, `/item`, `/metro`, `/willcox` | No founding language. | Out of scope except to preserve the destination context (section G). |
| B6 | checkoff `supabase/functions/join-list/index.ts:~186-192` (server-rendered invite page) | "You're invited to join... Browse 500+ things to do nearby" | Not Founding language, but an unverified "500+" count. Recommend a neutral line: "Discover local spots and check off experiences together." |

## C. Signup and onboarding in the app (UPDATE)

| # | File | Existing | Proposed |
|---|------|----------|----------|
| C1 | `screens/SignInScreen.jsx:~300-320` sub + bullets | "Stop saying 'I don't know what to do.' Challenge your crew." / "Browse 400+ things to do in your city" etc. | Sub: "Your city has more to discover." Bullets: Curated local lists and hidden gems / Find something new to do nearby / Save what catches your eye / Check off experiences worth remembering. Add "Free to join. More to experience." near the Create account button. (The "400+" count is a hard-coded claim, so drop it.) |
| C2 | `SignInScreen.jsx:144-146` signup alert | "Check your email. We sent a confirmation link to {email}. Tap it to activate your account, then sign in." | "Check your email. We sent a confirmation link to {email}. Confirm it, and you're ready to start exploring." Keep the flow and behavior unchanged. |
| C3 | `screens/OnboardingScreen.jsx:~52-58, 70-72, 92-95` | "Your city is waiting." / "Better with your crew." / "There's always more to find." CTAs: Get started / Next → / Start checking off | Page 1: "Your city has more to discover." body "Hidden gems. Local favorites. Unexpected adventures." CTA "Start Exploring". Pages 2-3 are already on voice; light edit only. Preview card data (Phoenix) shown to everyone. Consider destination-neutral samples. |
| C4 | `screens/SplashScreen.jsx:12-18` taglines | Includes "Hundreds of things to check off in Your City." (placeholder-style) | Replace with "Your city has more to discover." and "Discover places locals actually go." Drop the count. |
| C5 | App "You're in. Let's explore." success moment | None exists today: email-confirmed users go through the confirm page to sign-in. | Add copy to the confirm page (D1) and, if wanted, a one-time first-screen line after the first sign-in. Needs your decision (see Q3). |
| C6 | `screens/ConfirmEmailScreen.jsx` | Error strings only ("link has expired...") | No change. |

## D. Confirmation, email and auth

| # | File | Existing | Proposed |
|---|------|----------|----------|
| D1 | site `public/auth/confirm/index.html:49-50` | "Account confirmed / Open the CheckOff app to start exploring..." | "You're in. Let's explore." / "Your next great local experience is waiting. Discover something new, save what catches your eye and start checking things off." Button "Open CheckOff". Preserve token handling (copy-only change). |
| D2 | **External: Supabase Auth email templates** (Confirm signup, Reset password, Magic link) | Not in the repo. Cannot audit. | Manual: you check the dashboard (Auth → Email Templates) for founding or beta language. Proposed copy for Confirm signup supplied on request. |
| D3 | `supabase/functions/email-templates/never-checkedin-onboarding.html` plus `send-never-checkedin` | Searched for founding terms: none. | Review tone only. No change required. |
| D4 | Welcome email | **None found in the repo.** | Confirm whether a welcome email exists in Resend/Supabase or elsewhere (D2). If none, do not create one under this project unless you want it. |
| D5 | `checkoff-resend-email-system/` | No matches. | No change. |

## E. Profile and founding number (KEEP, with a copy tweak)

| # | File | Existing | Recommendation |
|---|------|----------|----------------|
| E1 | `screens/ProfileScreen.jsx:377-380`, styles `:775-776` | `profile?.founding_number != null` → amber pill "⭐ Founding Member #{n}" | Already the right behavior: only shown to qualifying accounts, read-only. Keep. Make it more discreet and add the line: "Founding Member #42" with "Here since the beginning." below (smaller, muted). Only one badge exists in the app, so no duplicates to remove. |
| E2 | `ProfileScreen.jsx:93` | selects `founding_number` | No change. |
| E3 | `ProfileScreen.jsx:733` | Insider tier: "Early access to Insider Drops and exclusive experiences." | This is a tier benefit, not a founding campaign. Leave it. Flag for your decision, since "early access" language is on your keyword list. |
| E4 | Numbering logic | `founding_number` is protected: column lockdown in `20261008a_lock_users_protected_columns.sql`, covered by `security_matrix_20261008.sql`. **The assignment logic (trigger or function) is NOT in the repo's migrations.** It lives in the live database. | Cannot be verified from files. I need a read-only DB check: max number, gaps, and the trigger definition. No schema change is planned. See Q1. |

## F. Founding Partner (business program) — recommend NO CHANGE

These are the *business partner* programme (`is_founding` on `partners`), a different thing from consumer Founding 500, and they relate to partner agreements and pricing, which you said not to touch: `send-partner-renewal`, `stripe-webhook`, `get-partner-data`, partner portal dashboard, admin partner drawer and badges, `fredericksburg` proposal, `partner-signup.html` ("Early access as CheckOff expands to new cities"), `creators` ("Phoenix Founding Creators"), `PartnerPreviewScreen.jsx`, `neighborhood`/`city-partnership` ("CheckOff founder" = Jerry). Related: `partners/preview` "Claim your spot" is the business listing claim flow. Leave as is. The `partner-signup` "Early access" line is the only item worth your decision.

## G. Destination Hub / QR entry
* `/join/{code}`, `/list`, `/c`, `/willcox` and `checkoff://join/{code}` flows must keep working. Copy-only changes, no routing or parameter changes.
* Plan: when an invite code or destination resolves, the headline and subcopy use the list or destination name ("Keep exploring Willcox"), not "your city". The generic text is a fallback only. Existing `join-page.test.js` and `list-page.test.js` get destination-aware cases.
* No change to Champion pricing, partner agreements or destination benefits.

## H. Not found / manual
* **App Store / Google Play listings**: not managed in the repo (`app.json` has only permission strings, none with founding language). You update these in App Store Connect and Play Console.
* **Instagram bio / link-in-bio** ("launch access"): manual.
* Printed collateral and QR cards: not audited.
* SEO/OG: only `/android` and `/download` have OG or meta text. Home and `/join` need the updates in A and B.

## Decisions needed from you
1. **Q1**: May I run a read-only query against the live DB (current max `founding_number`, gaps, assignment trigger source)? Needed before I can confirm sequential assignment is intact.
2. **Q2**: Past 500 — what should the new-user experience be once 500 are assigned (profile just shows nothing)? Default: nothing shown.
3. **Q3**: Add the "You're in. Let's explore." moment in the app after first sign-in, or only on the web confirm page?
4. **Q4**: OK to leave Insider "Early access" (E3) and partner "Early access" (F) unchanged?
5. **Q5**: Join page: should "Start Exploring" go to the App Store or Play Store by device, as today's buttons do?

## Proposed implementation scope (after approval)
Site: A1-A7, B1-B4, D1 (separate branch, tests, no deploy until you approve). App: C1-C4, E1 (OTA-eligible JS only, no native build). Tests: updated copy assertions plus a new test that asserts no public file contains "Founding 500" or "first 500". Zero schema, permission or auth changes.

## Implementation results (2026-10-14, local commits only, nothing pushed or deployed)

Decisions applied: Q1 DB check run read-only; Q2 UI shows founding status only for numbers 1-500; Q3 web confirmation page only; Q4 Insider/partner "early access" untouched; Q5 store buttons kept ("Start Exploring").

**Live DB (read-only):** 139 users, all with a unique `founding_number` (1 to 187). 48 unused numbers in that range are consumed sequence values; no accounts are soft-deleted. Trigger `users_founding_number` -> `assign_user_founding_number()` takes `nextval('founding_number_seq')`. **It has no 500 cap**, so account #501 onward would still get a number. Mitigation shipped in the UI only (`lib/foundingMember.js`). Optional later: cap in the DB function (schema change, not done, needs approval).

Branches:
* site `getcheckoff-site` `copy/retire-founding-500` @daf061d: join, home, download, android, auth/confirm pages + `public/founding-retirement.test.js`. Suite: 260/261 pass; the 1 failure is a pre-existing `vercel.json` redirects test, unrelated.
* app `checkoff` `copy/retire-founding-500`: SignInScreen, OnboardingScreen (page 1), SplashScreen, ProfileScreen badge + "Here since the beginning.", `join-list` edge function copy, `lib/foundingMember.{js,test.js}`. `lib` suite 1245/1245 pass.

Not run: real signup/verification end to end on a device, and Android/iOS visual pass of the app screens.
