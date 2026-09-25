// Which JS bundle is this device actually running? Pure (takes the
// expo-updates module as an argument) so it is testable without native code.
// Used by the tester debug panel and stamped on geofence_registration_log rows
// (client_build) so an OTA's arrival can be verified from the database.
export function describeClientBundle(Updates) {
  const updateId = Updates?.updateId ?? null
  const embedded = updateId == null || Updates?.isEmbeddedLaunch === true
  const runtime = Updates?.runtimeVersion ?? 'unknown-runtime'
  const channel = Updates?.channel ?? 'unknown-channel'
  const idPart = updateId ?? 'embedded'
  return {
    updateId,
    embedded,
    runtime,
    channel,
    shortId: updateId ? updateId.slice(0, 8) : 'embedded',
    logString: `${idPart}|${runtime}|${channel}`,
  }
}
