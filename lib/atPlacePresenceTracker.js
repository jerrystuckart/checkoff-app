// Shared module-level signal: which item (if any) is currently shown as the
// "You're Here / What's the Thing?" at-place card. Exists so
// useNotifications.js's foreground notification handler — registered once
// via Notifications.setNotificationHandler, outside any component render —
// can check current at-place state without prop-drilling or React context.
// lib/useWhatsGood.js's atPlaceItem effect is the only writer.

let currentAtPlaceItemId = null

export function setCurrentAtPlaceItemId(itemId) {
  currentAtPlaceItemId = itemId ?? null
}

export function getCurrentAtPlaceItemId() {
  return currentAtPlaceItemId
}
