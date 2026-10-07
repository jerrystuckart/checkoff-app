// Tiny in-app signal: "an item's photos changed". Screens that fetch cover photos once on
// mount (ItemDetail) include the version in their effect deps so they refetch after a
// photo-admin publish. No network/CDN promise — it only makes the app re-read its own data.
import { useEffect, useState } from 'react'

let version = 0
const listeners = new Set()

export function bumpPhotoVersion() {
  version += 1
  listeners.forEach((l) => l(version))
}

export function usePhotoVersion() {
  const [v, setV] = useState(version)
  useEffect(() => {
    listeners.add(setV)
    setV(version)
    return () => { listeners.delete(setV) }
  }, [])
  return v
}
