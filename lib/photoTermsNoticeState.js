// State rules for the Home photo terms notice. Pure so it is testable; the component (components/home/PhotoTermsNotice.jsx) only renders.
//  * The card is dismissed PER ACCOUNT on THIS DEVICE (AsyncStorage key per user id). Switching accounts never leaks one account's dismissal to another.
//  * Reading the details never dismisses the card, and neither action records anything on the server or counts as acceptance.
import { shouldShowPhotoTermsNotice } from './photoConsentVersion.js'

export const noticeKey = (userId) => `photoTermsNoticeClosed_v1:${userId}`

export async function loadNoticeClosed(storage, userId) {
  if (!userId) return false
  try { return (await storage.getItem(noticeKey(userId))) === '1' } catch { return false }
}

export async function saveNoticeClosed(storage, userId) {
  if (!userId) return
  try { await storage.setItem(noticeKey(userId), '1') } catch { /* device local convenience only */ }
}

export const initialNoticeState = Object.freeze({ userId: null, loaded: false, closed: false, detailsOpen: false })

/** Events: user_changed, loaded, open_details, close_details, dismiss. Any user change resets everything (a stale flag from the previous account must never apply). */
export function noticeReducer(state, event) {
  switch (event.type) {
    case 'user_changed': return event.userId === state.userId ? state : { ...initialNoticeState, userId: event.userId ?? null }
    case 'loaded': return event.userId === state.userId ? { ...state, loaded: true, closed: !!event.closed } : state
    case 'open_details': return state.loaded && !state.closed ? { ...state, detailsOpen: true } : state
    case 'close_details': return { ...state, detailsOpen: false }
    case 'dismiss': return { ...state, closed: true, detailsOpen: false }
    default: return state
  }
}

export function shouldRenderNotice(state, user) {
  return !!user?.id && state.userId === user.id && state.loaded
    && shouldShowPhotoTermsNotice({ accountCreatedAt: user.created_at, dismissed: state.closed })
}
