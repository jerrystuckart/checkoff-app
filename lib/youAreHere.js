// "You Are Here" on an exact item. Location ENHANCES the item page; it never decides whether the item can be opened
// or found. The label appears only when the user is at the item (lib/whatsGoodAtPlace.js isAtPlace: min(geo_radius_m, 150m)).
import { isAtPlace } from './whatsGoodAtPlace.js'

export function youAreHereLabel(item, userLocation) {
  if (!item || !userLocation) return null
  return isAtPlace(item, userLocation) ? 'You Are Here' : null
}
