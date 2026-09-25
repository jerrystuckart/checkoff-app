// Single source of truth for how anything opens the visit inbox. The route is
// registered in App.jsx's HomeStack (which also owns ItemDetail); callers must
// go through the root tab navigator, so both entry points (Profile button and
// the departure-push tap) share these exact arguments.
export const VISIT_INBOX_TAB = 'HomeTab'
export const VISIT_INBOX_SCREEN = 'VisitInbox'

export function buildVisitInboxNavigateArgs(candidateVisitId = null) {
  return [
    VISIT_INBOX_TAB,
    { screen: VISIT_INBOX_SCREEN, params: { candidateVisitId: candidateVisitId ?? null } },
  ]
}

// `rootNavigator` is any object with navigate(): the NavigationContainer ref
// (push tap) or a tab-level navigator from navigation.getParent() (Profile).
export function openVisitInbox(rootNavigator, candidateVisitId = null) {
  if (!rootNavigator?.navigate) return false
  rootNavigator.navigate(...buildVisitInboxNavigateArgs(candidateVisitId))
  return true
}
