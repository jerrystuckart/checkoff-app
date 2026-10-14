// Shared Directions / Website behavior for an item — extracted verbatim from
// screens/ItemDetailScreen.jsx so the normal detail screen and the locked
// secret screen (SecretRevealScreen) open the exact same links from the
// exact same fields. Analytics (directions_click / url_click) stays at each
// call site.
import { Linking } from 'react-native'

// Support both snake_case (useNearby) and camelCase (useItems) field names.
export function itemCoords(item) {
  const lat = item?.maps_lat ?? item?.mapsLat ?? null
  const lng = item?.maps_lng ?? item?.mapsLng ?? null
  return { lat, lng }
}

export function itemHasLocation(item) {
  const { lat, lng } = itemCoords(item)
  return !!(item?.maps_query || (lat && lng))
}

export function itemHasWebsite(item) {
  return !!item?.website_url
}

export function openItemDirections(item) {
  if (!item) return
  const { lat, lng } = itemCoords(item)
  if (lat && lng) {
    const url = `maps://?daddr=${lat},${lng}&dirflg=d`
    Linking.canOpenURL(url).then(ok =>
      Linking.openURL(ok ? url : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`).catch(() => {})
    )
  } else if (item.maps_query) {
    const encoded = encodeURIComponent(item.maps_query)
    const url = `maps://?q=${encoded}`
    Linking.canOpenURL(url).then(ok =>
      Linking.openURL(ok ? url : `https://maps.google.com/?q=${encoded}`).catch(() => {})
    )
  }
}

export function openItemWebsite(item) {
  if (!item?.website_url) return
  Linking.openURL(item.website_url).catch(() => {})
}
