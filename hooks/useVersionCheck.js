import { useState, useEffect } from 'react'
import * as Application from 'expo-application'
import { supabase } from '../lib/supabase'

export function useVersionCheck(userId) {
  const [forceUpdate, setForceUpdate] = useState(false)
  const [softUpdate,  setSoftUpdate]  = useState(false)
  const [updateConfig, setUpdateConfig] = useState(null)

  useEffect(() => {
    if (!userId) return

    async function check() {
      try {
        const { data, error } = await supabase
          .from('app_version_config')
          .select('*')
          .eq('platform', 'ios')
          .single()

        if (error || !data) return

        const installedBuild = parseInt(Application.nativeBuildVersion ?? '0', 10)
        const minBuild       = parseInt(data.minimum_supported_build_number ?? '0', 10)
        const latestBuild    = parseInt(data.latest_build_number ?? '0', 10)

        if (installedBuild < minBuild) {
          setUpdateConfig(data)
          setForceUpdate(true)
          return
        }

        if (installedBuild < latestBuild) {
          // Check if user already dismissed this version
          const { data: dismissal } = await supabase
            .from('user_update_dismissals')
            .select('id')
            .eq('user_id', userId)
            .eq('platform', 'ios')
            .eq('dismissed_build_number', data.latest_build_number)
            .maybeSingle()

          if (!dismissal) {
            setUpdateConfig(data)
            setSoftUpdate(true)
          }
        }
      } catch (_) {}
    }

    check()
  }, [userId])

  async function dismissSoftUpdate() {
    setSoftUpdate(false)
    if (!userId || !updateConfig) return
    supabase
      .from('user_update_dismissals')
      .upsert({
        user_id: userId,
        platform: 'ios',
        dismissed_version: updateConfig.latest_version,
        dismissed_build_number: updateConfig.latest_build_number,
      })
      .then(() => {})
      .catch(() => {})
  }

  return { forceUpdate, softUpdate, updateConfig, dismissSoftUpdate }
}
