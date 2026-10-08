// Signed photo URLs expire (1 hour). The old locked screen fetched once at
// mount, so a screen left open — or an image whose URL had lapsed — turned
// into a broken/blank hero. This hook owns the "fetch, keep fresh, retry
// once on a load error, then give up cleanly" loop for any signed-URL
// fetcher:
//   - re-fetch shortly before expiry while mounted,
//   - re-fetch when the app returns to the foreground if the value is old,
//   - on an image load error, re-fetch ONCE (expired signature); a second
//     failure marks it failed and `value` becomes null so the caller shows
//     its branded fallback instead of a broken image.
import { useState, useEffect, useRef, useCallback } from 'react'
import { AppState } from 'react-native'

const REFRESH_MS = 50 * 60 * 1000

/**
 * @param {() => Promise<any>} fetcher  returns the value (null = nothing)
 * @param {{ enabled?: boolean, resetKey?: any }} opts
 * @returns {{ value: any, reportError: () => void }}
 */
export function useRefreshingPhoto(fetcher, { enabled = true, resetKey = null } = {}) {
  const [value, setValue] = useState(null)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const loadedAt = useRef(0)
  const retried = useRef(false)
  const failed = useRef(false)
  const alive = useRef(true)

  const load = useCallback(async () => {
    try {
      const next = await fetcherRef.current()
      if (!alive.current) return
      loadedAt.current = Date.now()
      setValue(next ?? null)
    } catch {
      if (alive.current) setValue(null)
    }
  }, [])

  useEffect(() => {
    alive.current = true
    retried.current = false
    failed.current = false
    setValue(null)
    if (!enabled) return () => { alive.current = false }
    load()
    const timer = setInterval(() => { if (!failed.current) load() }, REFRESH_MS)
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && !failed.current && Date.now() - loadedAt.current > REFRESH_MS * 0.8) load()
    })
    return () => {
      alive.current = false
      clearInterval(timer)
      sub?.remove?.()
    }
  }, [enabled, resetKey, load])

  const reportError = useCallback(() => {
    if (!retried.current) {
      retried.current = true
      load()
    } else {
      failed.current = true
      setValue(null)
    }
  }, [load])

  return { value, reportError }
}
