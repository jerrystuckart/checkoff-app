// Short upload consent line shown next to a photo about to be attached to a check in. Copy lives in lib/photoConsentCopy.js.
import React from 'react'
import { Text, Linking, StyleSheet } from 'react-native'
import { PHOTO_CONSENT, TERMS_URL } from '../lib/photoConsentCopy'

export default function PhotoLicenseNotice({ variant = 'checkin', color = 'rgba(255,255,255,0.55)', style }) {
  const copy = PHOTO_CONSENT[variant] ?? PHOTO_CONSENT.checkin
  return (
    <Text style={[styles.text, { color }, style]} accessibilityRole="text">
      {copy.text}{' '}
      <Text style={[styles.link, { color }]} onPress={() => Linking.openURL(TERMS_URL).catch(() => {})} accessibilityRole="link">
        {copy.linkLabel}
      </Text>
    </Text>
  )
}

const styles = StyleSheet.create({
  text: { fontSize: 12, lineHeight: 17, marginTop: 10, marginBottom: 4 },
  link: { textDecorationLine: 'underline' },
})
