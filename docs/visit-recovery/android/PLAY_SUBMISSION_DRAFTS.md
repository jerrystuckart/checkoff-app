# Google Play and policy drafts for Android visit recovery (REVIEW READY, NOT SUBMITTED, NOT PUBLISHED)

Nothing here is submitted or published. Jerry approves each item first.

## A. Background Location Permissions Declaration (Play Console, App content)
**Feature:** Recover checkoffs you forgot (visit recovery).
**Why background location is core:** CheckOff is a checklist of local experiences. Users often forget to check something off after they leave a place.
Visit recovery recognizes, with Android geofencing, when the phone has spent enough time at a place in the CheckOff catalog, so the user can confirm a missed checkoff later.
It cannot work with foreground location only, because the moments that matter (arriving at and leaving a cafe or a viewpoint) happen while the app is closed and the phone is in a pocket.
**How it works:** up to 40 geofences around nearby catalog places are registered with Google Play services. The app is woken only on enter and exit. It does not track a route, run a foreground service or poll GPS continuously.
**User control:** off by default, opt in with a prominent disclosure, "Allow all the time" chosen by the user on the system page, can be turned off any time in Profile (this also deletes saved visits), or revoked in system Settings.
**Alternatives considered:** foreground only (misses the core case), manual entry (exists, is the thing being recovered), notifications on arrival (still need background detection).
**Core functionality statement:** the user-facing feature is the list of private suggestions in "Places you may have visited". The user confirms each one; nothing is checked off automatically.

## B. Prominent disclosure (shown on its own, before any permission request)
Title: Recover checkoffs you forgot
Body: CheckOff uses your location in the background to recognize when you spend enough time at places in our catalog, even when the app is closed. Your location creates private visit suggestions. Nothing is checked off until you confirm it. You can turn this off anytime and delete your saved visits.
Buttons: Not now | Continue
After Continue: foreground location request, then (Android 11 and newer) "On the next screen, choose Allow all the time for CheckOff." and the system Settings page.

## C. Data safety form (changes to propose)
| Item | Answer |
|---|---|
| Location > Precise location | Collected: Yes. Shared: No. Required: No (optional feature). Purpose: App functionality. Processed on our servers; encrypted in transit; users can request deletion (Turn off and delete visits, account deletion). |
| Location > Approximate location | Collected: Yes (as part of precise). Same answers. |
| Data used for tracking / advertising | No |
| Data sold or shared with third parties | No (service providers hosting the database only) |
| Deletion | In app: Profile > Turn off and delete visits; account deletion request |
| Data retention | Visit suggestions are removed after their 7 day window plus 1 day (confirmed ones keep only a link to the check-in for 30 days); diagnostics 14 days |

## D. Privacy Policy (proposed section to add at getcheckoff.com/privacy)
**Visit recovery (optional).** If you turn on "Recover checkoffs you forgot" and allow location "all the time", CheckOff uses your phone's location in the background to notice when you arrive at and leave places in our catalog and how long you stayed. We use this only to create private suggestions of places you may have visited, which you can confirm or dismiss. We do not check anything off without your confirmation, we do not record a route or continuous location history, and we do not use this location for advertising or sell or share it. When you arrive and leave, your phone sends the location reading and time for that place to our servers; saved visit suggestions are kept for 7 days (plus 1 day) and then deleted, and diagnostic records for 14 days. You can turn this off at any time in Profile; doing so stops monitoring and deletes your saved visits. You can also revoke location access in your phone's settings.

## E. Reviewer instructions (Play Console > App access / review notes)
1. Sign in with the supplied test account (visit recovery is enabled for it).
2. Open Profile. Tap "Recover checkoffs you forgot" > Turn on.
3. The prominent disclosure appears. Tap Continue. Allow precise location while using the app. On the system Settings page choose "Allow all the time". Return to CheckOff.
4. The card shows On. Profile > debug panel lists monitored places (tester account only).
5. A test suggestion is provided for this account: open Home > "Recover checkoffs you forgot" > "Places you may have visited". Nothing is checked off until you tap confirm.
6. Profile > Turn off and delete visits: monitoring stops and the suggestions are deleted.
(Reviewer account and a seeded suggestion must be prepared by Jerry before submission.)

## F. Store listing feature explanation (draft, add only after approval)
"Recover checkoffs you forgot (optional): CheckOff can notice when you spend time at a place on our lists, even when the app is closed, and suggest it to you privately so you can check it off later. You choose whether to turn it on, you confirm every suggestion, and you can turn it off and delete your saved visits any time."

## G. Review video script (about 60 seconds, screen recorded on a Pixel)
1. Open CheckOff (Home). 2. Profile > tap "Recover checkoffs you forgot". 3. Show the full screen disclosure; tap Continue.
4. Foreground location prompt: Precise, While using the app. 5. Explanation, then the system location page for CheckOff.
6. Select "Allow all the time". 7. Back to CheckOff (card refreshes). 8. Card shows "On — nothing to review right now".
9. Show the test suggestion in "Places you may have visited". 10. Show that nothing is checked off until Confirm is tapped (the item list is unchanged), then tap Confirm.
11. Profile > Turn off and delete visits. 12. Show the suggestions are gone and the card says off.
Voice over: "Background location lets CheckOff recognize a visit while the app is closed, so a forgotten checkoff can be recovered. It is optional, private, never automatic, and can be deleted any time."

## H. Items that need Jerry's approval before anything is submitted or published
Background Location declaration; Data safety answers; Privacy Policy text and publishing; store listing text; reviewer account and seeded suggestion; the rollout decision to set `android_visit_recovery` globally.
