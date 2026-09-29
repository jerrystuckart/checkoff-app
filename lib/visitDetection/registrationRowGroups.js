// Groups the rows of the current_monitored_geofences view for the tester debug panel so that an item that is
// nearby but was never configured ("no_visit_profile_assigned": incomplete catalog data) is not lost among items
// that are deliberately or structurally excluded. State strings come from the view: 'monitored' or 'excluded: <reason>'.

export const MISSING_CONFIG_REASON = 'no_visit_profile_assigned'

/**
 * @param {Array<{ item_id: string, item_name: string, distance_m: number, state: string }>} rows
 * @returns {{ monitored: any[], missingConfig: any[], intentional: any[], other: any[] }}
 */
export function groupRegistrationRows(rows) {
  const groups = { monitored: [], missingConfig: [], intentional: [], other: [] }
  for (const row of rows ?? []) {
    const reason = row.state?.startsWith('excluded: ') ? row.state.slice('excluded: '.length) : null
    if (row.state === 'monitored') groups.monitored.push(row)
    else if (reason === MISSING_CONFIG_REASON) groups.missingConfig.push(row)
    else if (reason === 'manual_only_profile') groups.intentional.push(row)
    else groups.other.push(row)
  }
  return groups
}

/** One-line headline for the "nearby items missing configuration" warning, or null when there is none. */
export function missingConfigHeadline(groups) {
  const n = groups.missingConfig.length
  if (n === 0) return null
  return `${n} nearby item${n === 1 ? ' has' : 's have'} no visit profile, so ${n === 1 ? 'it is' : 'they are'} never monitored. Incomplete catalog data: set a profile (or mark intentionally excluded) in admin.`
}
