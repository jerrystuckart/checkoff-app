# Founding 500 retirement: external messaging audit (2026-10-14)

Read-only audit. Nothing outside the repos was changed. No email auth, sender or delivery settings were touched.

| Surface | Exact existing language | Founding/scarcity language? | Recommendation | Status |
|---|---|---|---|---|
| Supabase Confirm signup (subject / body) | Subject "Confirm Your Signup". Body: "Confirm your CheckOff signup / Follow this link to confirm: / Confirm your mail" | No | Optional polish: subject "Confirm your CheckOff account"; body "You're almost in. Confirm your email to start exploring." button "Confirm and start exploring". Keep `{{ .ConfirmationURL }}`. | Not needed; optional edit by you in Auth > Email Templates |
| Supabase Reset password | Subject "Reset Your Password". Body: "Reset Password / Follow this link to reset the password for your user: / Reset Password" | No | Optional: "Reset your CheckOff password" / "Follow this link to choose a new password." | Not needed |
| Supabase Magic link, invite, email-change, notifications | Defaults ("Magic Link", "You have been invited"...) | No | None | Not needed |
| Supabase SMTP / sender | sender checkoff@getcheckoff.com, name "CheckOff App" | n/a | Untouched | Untouched |
| Repo emails (never-checked-in, inactive, recap, partner emails) | Searched `supabase/functions`, email templates, `checkoff-resend-email-system` | None for consumers (partner renewal says "founding partner", separate program) | None | Verified in repo |
| Resend dashboard (welcome email, automations) | Could not read: no Resend credential available here | Unknown | **You check Resend for any welcome email/automation** and send me the text if one exists. | OPEN, needs you |
| Apple App Store description (public lookup, v1.1.10, "CheckOff - Do More") | Starts "CheckOff answers the question everyone hates asking: 'What do you want to do this weekend?' Discover hundreds of curated local experiences, hidden gems..." ends "Free to use." Features list incl. leaderboards, streaks, dares. | **No** | No change required. Optional first line: "Your city has more to discover. Hidden gems. Local favorites. Unexpected adventures." Check Promotional Text and What's New in App Store Connect (not publicly readable). | Description clean; promo text OPEN |
| Google Play short description (public) | "Discover specific local experiences worth checking off." | **No** | No change required. Optional: "Your city has more to discover. Find your next experience and CheckOff the good stuff." Full description and promo graphics need Play Console. | Short desc clean; full desc OPEN |
| Instagram bio (@checkoff.app) | Could not read (login wall). The only public text is a platform auto-label. | Unknown | Proposed bio: "Your city has more to discover. Hidden gems. Local favorites. Free on iOS and Android." Update the link-in-bio/launch-access wording if it says "Founding 500". | OPEN, needs you |
| Printed QR cards / collateral | Not audited | Unknown | Review any card saying Founding 500 | OPEN |
