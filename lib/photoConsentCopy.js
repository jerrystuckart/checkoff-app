// Upload consent copy for photos. Two separate consents, shown in different flows:
//   * CHECKIN: a photo attached to a check off. Stored with the check in, in the check in photo storage location (anyone holding the exact
//     address can open it; the app shows it to its owner only). NOT offered as a catalog cover.
//   * COVER: a photo offered for an experience cover. Stored where only our systems and photo administrators can open it, reviewed first,
//     shown to others only if approved and selected.
// Wording must match docs/release/PHOTO_TERMS_PROPOSAL.md and the website Terms section 3. Public copy has no hyphens or dashes.
// The retention facts describe verified behavior (account deletion keeps submitted photos without attribution; the photo keeps its storage and
// access status); they promise no removal and no continued display. The old promise stays: no use in advertising without separate permission.
// Never call these photos "private" or "confidential": check in photos are reachable by exact address and partners can see them while the check in exists.

export const TERMS_URL = 'https://getcheckoff.com/terms#content'
export const SUPPORT_EMAIL = 'support@getcheckoff.com'

export const PHOTO_CONSENT = Object.freeze({
  checkin: Object.freeze({
    text: 'Your photo stays yours. By adding it you give CheckOff a license to store it and use it to run CheckOff and promote its experiences in the app and on our own pages. We will not use it in advertising without your separate permission. If you delete your account, we keep the photo without your name and the license continues. Only add photos you have the right to share.',
    linkLabel: 'Read the Terms',
  }),
  cover: Object.freeze({
    title: 'Great shot. Offer it as a cover photo?',
    subtitle: 'Help other locals see what the thing looks like.',
    text: 'This is separate from the photo on your check in. You keep ownership. By sharing, you give CheckOff a license to store this photo and, if we approve it, show it as a cover for this experience. Photo administrators review it first, and it is not shown to other people unless we approve it. We will not use it in advertising without your separate permission. If you delete your account, we keep the photo without your name, it keeps its review status, and the license continues. Only share photos you have the right to share.',
    button: 'Share it with CheckOff',
    linkLabel: 'Read the Terms',
  }),
})

// Check in screen subtitles. The old text promised "your crew will see it" and a "crew's feed", which the app does not do
// (the app does not show a member another member's photo), so these only say what happens.
export const CHECKIN_PHOTO_SUBTITLES = Object.freeze({
  required: 'This item requires a photo to check off. Your photo is saved with your check in.',
  optional: 'Photos are optional. A photo is saved with your check in.',
})

// One time notice for accounts that existed before the new photo terms apply. Dismissing it records nothing on the server and is NOT acceptance:
// the new license applies only to photos submitted after the effective date with the updated consent screens.
export const PHOTO_TERMS_NOTICE = Object.freeze({
  title: 'Photo terms are being updated',
  body: 'From the date below, photos you submit with the updated consent screens are covered by updated Terms. You keep ownership and give CheckOff a license to store and use the photo to run CheckOff and promote its experiences in the app and on our own pages. We will not use a photo in advertising without your separate permission. If you delete your account we keep submitted photos without your name. Photos you submitted before the date stay under the Terms that applied when you submitted them. Closing this notice does not accept anything and does not change your rights.',
  removal: 'To ask us to remove a photo, email support@getcheckoff.com.',
  effectivePrefix: 'Effective',
  readTerms: 'Read the Terms',
  emailSupport: 'Email support',
  dismiss: 'Close',
})
