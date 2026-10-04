export const stats = { permissionCalls: 0 }
export const Accuracy = { Balanced: 3 }
export async function requestForegroundPermissionsAsync() { stats.permissionCalls++; return { status: 'denied' } }
export async function getCurrentPositionAsync() { throw new Error('denied') }
export async function getLastKnownPositionAsync() { return null }
export async function watchPositionAsync() { return { remove() {} } }
