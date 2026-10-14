// The ONE "turn on visit recovery" flow (explain, consent, then the permission request). Profile's section and the Home
// header icon both call it, so the wording, the consent write and the permission behaviour cannot drift apart.
import { Alert } from 'react-native'
import { enableVisitRecovery } from './recoverySettings'
import { RECOVERY_COPY } from './recoveryPolicy'

/**
 * @param {object} p
 * @param {string} p.userId
 * @param {() => void} p.openSettings   opens the iOS Settings page for the app
 * @param {() => void} [p.onDone]       always called once the flow has finished (re-read state)
 * @param {(busy: boolean) => void} [p.setBusy]
 */
export function runVisitRecoverySetup({ userId, openSettings, onDone, setBusy }) {
  Alert.alert(RECOVERY_COPY.title, `${RECOVERY_COPY.intro}\n\n${RECOVERY_COPY.how}\n\n${RECOVERY_COPY.privacy}`, [
    { text: 'Not now', style: 'cancel' },
    {
      text: 'Turn on',
      onPress: async () => {
        setBusy?.(true)
        try {
          const { permission } = await enableVisitRecovery(userId)
          if (permission !== 'granted') Alert.alert('One more step', RECOVERY_COPY.permissionDeniedHint, [
            { text: 'Later', style: 'cancel' },
            { text: 'Open Settings', onPress: openSettings },
          ])
        } catch (e) {
          Alert.alert('Could not turn on', e?.message ?? 'Please try again.')
        } finally {
          setBusy?.(false)
          onDone?.()
        }
      },
    },
  ])
}
