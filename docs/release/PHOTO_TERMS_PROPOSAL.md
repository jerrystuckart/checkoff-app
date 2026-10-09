# Photo license, retention and upload consent: proposal (2026-10-08) — HELD for owner review

Status: app copy is committed on both release lines (JavaScript only, NOT published as an OTA). Website edits are committed on the site repo branch `docs/photo-terms-2026-10-08` (NOT pushed, NOT published; `main` is untouched).
Legal note: no lawyer has reviewed this wording. Items marked LEGAL are uncertainties to put to counsel. Public copy has no hyphens or dashes.

## 1. Verified facts the wording must match
- Account deletion keeps every submitted photo file (check in photos; cover and place submissions of any status), removes the account link and storage ownership, moves files to neutral paths, and leaves visibility and moderation status unchanged. Personal check in rows are deleted. Only anonymous monthly completion counts remain.
- Check in photo: stored in the `checkin-photos` bucket, which is PUBLIC (anyone holding the exact address can open it; addresses are not listed). The app shows a check in photo to its owner. Database permissions let members of the list read check in rows, including `photo_url` (the privacy policy already says so). Partners see recent check in photos on their own items without names (privacy section 5). After deletion the check in row is gone, so the app and partner portal no longer show it; the retained file stays at a neutral address in the same public bucket.
- Cover submission: stored in the PRIVATE `submission-photos` bucket; status starts `needs_review` (or `automated_rejected`); admins review; only a photo selected as an item's cover is readable by others (policy "anyone can view selected cover photos"). A check in photo is never offered as a cover automatically: the cover flow is a separate camera step with its own consent screen.
- Previously, the check in photo screen said "Your crew will see it" and "show up in your crew's feed". The app does not do that (no screen shows another member's photo). That copy was inaccurate and is replaced; no behavior changed.

## 2. Exact proposed Terms section 3 (replaces "3. Content You Post"; anchor `#content`)
CheckOff lets you post content, including photos you attach to a check in, photos you offer for a place, an experience or its cover, and messages such as dares. You keep ownership of what you post. CheckOff does not own the copyright in your photos.

Your license to us. When you submit a photo or other content, you give CheckOff a nonexclusive, royalty free license to store, reproduce, display and distribute it, including through the service providers that host and deliver it for us, to operate and promote CheckOff and the experiences in it. The license does not let us sell your photos or license them to unrelated third parties. We will not use your photos in paid advertising without your separate permission.

After you delete your account. This license continues after you delete your account for content you submitted, subject to applicable law. If you delete your account, we remove your name and account link from your submitted photos but keep the photos. A photo keeps the visibility and review status it had: a photo that was private, waiting for review or not accepted stays that way, and keeping a photo never makes it public. Photos can show people, places and other details, so removing your account link does not make a photo anonymous.

Check in photos and cover photos are separate choices. A check in photo is saved with your check in. A cover photo is offered only when you choose to share it, stays private and is reviewed first, and is shown to other people only if we approve it. Choosing one does not choose the other.

Your promises. You confirm that you own each photo you submit, or have the permission and rights needed to submit it and to give this license, including permission from people who appear in it. Do not submit content that breaks the law or someone else's rights.

Removal and rights requests. To ask us to remove a photo, or to raise a rights concern about one, email support@getcheckoff.com. Tell us which photo or place you mean and whether you submitted it, appear in it or hold rights in it. We may ask for details to confirm who you are. We will review each request, but we cannot promise to remove a photo in every case, and what we can do may depend on whether we can identify the photo and on applicable law.

Also changed in the Terms (same edit): section 10 gains "Photos you submitted are handled as described in Section 3." and section 5 (Location Services) is corrected because it said location "is not stored on our servers in precise form", which is untrue once visit recovery is on (the privacy policy is accurate). Section 5 is a separate decision from the photo wording; drop that hunk if you want only the photo changes. "Last updated" becomes October 8, 2026 (set the real publication date).
Decision for you: the old Terms promised "We will not use your photos for advertising without your explicit consent". The new text keeps that promise only for PAID advertising and allows promotion of CheckOff (for example showing an experience photo on our site or social pages). Say if you want the stricter old promise kept unchanged. No AI training statement is included; adding "we do not use photos to train AI" would be a new commitment.

## 3. Exact in app consent copy (`lib/photoConsentCopy.js`, tested)
Check in flows (photo check in screen, trip mode sheet, visit suggestion confirm with a photo; shown next to the photo before it is submitted, followed by a tappable "Read the Terms" link to https://getcheckoff.com/terms#content):
"Your photo stays yours. By adding it you give CheckOff a license to store it and use it to run and promote CheckOff. The license continues if you delete your account. We keep the photo without your name. Only add photos you have the right to share."
Cover flow (replaces the old fine print on the existing explicit consent screen; the button still must be tapped before anything uploads):
Title "Great shot. Offer it as a cover photo?", subtitle "Help other locals see what the thing looks like."
"This is separate from the photo on your check in. You keep ownership. By sharing, you give CheckOff a license to store this photo and, if we approve it, show it as a cover for this experience. It stays private and is reviewed first. If you delete your account, we keep the photo without your name, with the same review status, and the license continues. Only share photos you have the right to share." + "Read the Terms". Button: "Share it with CheckOff".
Check in photo screen subtitles (accuracy fix): required "This item requires a photo to check off. Your photo is saved with your check in." optional "Photos are optional. A photo is saved with your check in."
Not changed: deletion, retention, visibility, moderation, points, reporting.

## 4. Privacy and delete page changes (site branch)
- Privacy section 1 (Photos and notes): adds that submitted photos are covered by the Terms license and points to Section 7.
- Privacy section 4: new paragraph "Cover photos you offer" (private, reviewed by photo administrators, shown only if approved and selected; separate from check in photos).
- Privacy section 7 and delete page "Photos you submitted": the sentence "give CheckOff a license to store, display and distribute it within the Service" is replaced by the new license summary, that it continues after deletion subject to applicable law, that each photo keeps its visibility and review status and keeping never makes it public, that removing the account link does not make a photo anonymous, and the support route.
- Support page: new FAQ "How do I ask for a photo to be removed?".

## 5. Existing content gap (needs your decision) — LEGAL
- What existing uploaders agreed to (Terms of April 17, 2026): a license "to store, display, and distribute that content within the Service", no advertising use without explicit consent, and "we will delete your personal data within 30 days". Cover submissions: "permission to display this photo in the app if it's approved. It won't be public until then" (98 submissions, all with `consent_ack` true).
- Gaps against the approved behavior: (1) the old license is limited to "within the Service", no "reproduce", no promotion; (2) nothing says the license survives account deletion, and the 30 day deletion sentence can be read to include photos; (3) cover submitters were told the photo is for display in the app only.
- The new Terms and consent screens do not retroactively prove consent for photos uploaded before they apply. Whether keeping pre change photos after deletion is covered by the old license is LEGAL uncertainty. Retention is already live for all photos.
- Smallest practical remedies (pick one):
  A. Prospective only (recommended minimum): the new text and consent screens govern photos submitted after the effective date; for older photos, treat the old license as the only basis, and honor removal requests for them promptly (the support route exists). No schema, no claim of retroactive consent.
  B. A + notice: email or in app notice of the updated Terms (Terms section 11 already promises notice of material changes) with a clear removal route, and no claim that continued use is consent for older photos.
  C. Change behavior for photos uploaded before the effective date (delete them on account deletion instead of retaining). Needs a deletion pipeline change, which this task was told not to make; listed only for completeness.
- Do not mark existing users as having accepted new terms: nothing in this change records acceptance.

## 6. Recording consent (proposal only; no schema introduced)
Existing mechanisms: sign in screen says "By continuing you agree to the Terms" (no record); `item_cover_candidates.consent_ack` boolean with `submitted_at` (98 of 98 true); no terms version or acceptance column anywhere.
Proposal if you want evidence per photo: add `consent_version text` to `item_cover_candidates` (written by the client with the existing insert, RLS unchanged) and a nullable `photo_terms_version text` on `check_ins` for check in photos; both set to a constant such as `photo-terms-2026-10-08` by the app. No account wide acceptance flag and no backfill, so old rows stay NULL ("original terms"), which also marks which photos predate the new wording. Needs a migration approved by you and a client change; not done. Cheaper alternative: record nothing and rely on the effective date plus the app version that shipped the wording.

## 7. Release state
- App (JavaScript only; no native config or runtime change): committed to both canonical lines; NOT published as an OTA. Publishing needs your approval of the exact wording above.
- Website: committed on site branch `docs/photo-terms-2026-10-08`, NOT pushed, NOT published.
- Store forms: privacy and deletion answers in `STORE_RELEASE_1_1_10.md` already say submitted photos are retained anonymized; they do not depend on this wording.
