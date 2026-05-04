/**
 * checkInResult.js
 *
 * Tiny module-level store for passing a completed check-in result
 * from PhotoCheckInScreen back to ListScreen without navigation params.
 *
 * PhotoCheckInScreen writes to this before calling navigation.goBack().
 * ListScreen reads and clears it in useFocusEffect.
 */

let _pending = null

export function setPendingCheckIn(listItemId, difficulty) {
  _pending = { listItemId, difficulty }
}

export function consumePendingCheckIn() {
  const result = _pending
  _pending = null
  return result
}
