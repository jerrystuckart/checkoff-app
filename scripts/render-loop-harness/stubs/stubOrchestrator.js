export const stats = { calls: 0 }
export async function getWhatsGoodSelection() { stats.calls++; return { itemIds: [], fromCache: true, debug: {}, backupItemIds: [], coverageMode: 'supported_sufficient' } }
