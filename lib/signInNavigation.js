// A successful sign-in leaves the SignIn screen's tab. SignIn is registered in several tab stacks and is pushed on top
// of whichever stack the guest was in (Profile, Lists, Home). React Navigation 7 never pops back on `navigate`, so
// navigating away (to HomeTab, the item or the invite) leaves the SignIn route retained underneath: reopening that tab
// later shows the stale form, and from Home it also stacks a duplicate screen. Remove exactly the SignIn route first.
export function dismissSignInRoute(navigation) {
  const state = navigation?.getState?.()
  if (state && state.index > 0 && typeof navigation.pop === 'function') navigation.pop()
}
