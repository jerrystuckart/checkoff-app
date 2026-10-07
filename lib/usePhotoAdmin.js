import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { fetchIsPhotoAdmin } from './photoAdmin'

// UI hint only — the server enforces. Resolves the signed-in user, then asks is_photo_admin().
export function usePhotoAdmin(userIdFromCaller = null) {
  const [isPhotoAdmin, setIsPhotoAdmin] = useState(false)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        let uid = userIdFromCaller
        if (!uid) {
          const { data } = await supabase.auth.getUser()
          uid = data?.user?.id ?? null
        }
        const value = await fetchIsPhotoAdmin({ userId: uid })
        if (!cancelled) setIsPhotoAdmin(value)
      } catch {
        if (!cancelled) setIsPhotoAdmin(false)
      }
    })()
    return () => { cancelled = true }
  }, [userIdFromCaller])
  return isPhotoAdmin
}
