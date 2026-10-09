// Upload consent copy for photos. Two separate consents, shown in different flows:
//   * CHECKIN: a photo attached to a check off. Stored with the check in, kept in the public check in photo storage location
//     (anyone holding the exact address can open it; the app shows it to its owner only). NOT offered as a catalog cover.
//   * COVER: a photo offered for an experience cover. Stored privately, reviewed first, shown to others only if approved.
// Wording must match docs/release/PHOTO_TERMS_PROPOSAL.md and the website Terms section 3. Public copy avoids hyphens and dashes.
// The license/retention facts below describe verified behavior (account deletion keeps submitted photos without attribution
// and with unchanged visibility and review status); they do not promise removal or any outcome.

export const TERMS_URL = 'https://getcheckoff.com/terms#content'

export const PHOTO_CONSENT = Object.freeze({
  checkin: Object.freeze({
    text: 'Your photo stays yours. By adding it you give CheckOff a license to store it and use it to run and promote CheckOff. The license continues if you delete your account. We keep the photo without your name. Only add photos you have the right to share.',
    linkLabel: 'Read the Terms',
  }),
  cover: Object.freeze({
    title: 'Great shot. Offer it as a cover photo?',
    subtitle: 'Help other locals see what the thing looks like.',
    text: 'This is separate from the photo on your check in. You keep ownership. By sharing, you give CheckOff a license to store this photo and, if we approve it, show it as a cover for this experience. It stays private and is reviewed first. If you delete your account, we keep the photo without your name, with the same review status, and the license continues. Only share photos you have the right to share.',
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
