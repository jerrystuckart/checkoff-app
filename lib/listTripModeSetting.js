// Per-list Trip Mode / Regular choice — shared copy and rules for the create
// screen (CreateListScreen) and the owner-only editor (ListTripModeSetting in
// ListScreen). Pure so it is testable under node.
export const TRIP_MODE_CHOICE_COPY = {
  regular: 'Regular: the normal rule applies — check off from the actual place.',
  trip: 'Trip Mode: participants can manually add experiences they did during the trip, even from somewhere else.',
}

export function tripModeChoiceCopy(enabled) {
  return enabled ? TRIP_MODE_CHOICE_COPY.trip : TRIP_MODE_CHOICE_COPY.regular
}

// Only the list's creator may change it (lists RLS: "creator update"), and
// never an official / destination-backed list.
export function canEditTripMode({ listMeta, userId }) {
  if (!listMeta || !userId) return false
  if (listMeta.creator_id !== userId) return false
  if (listMeta.is_official || listMeta.source_destination_list_id) return false
  return true
}

export function buildTripModeUpdate(enabled) {
  return { trip_mode_enabled: enabled === true }
}

// Turning Trip Mode off stops NEW manual entries; entries already made stay.
export function tripModeOffWarning() {
  return 'Turning off Trip Mode stops participants adding new experiences from elsewhere. Anything already added stays checked off.'
}
