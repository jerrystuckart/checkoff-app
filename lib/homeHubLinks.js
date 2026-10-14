// Home "Explore <hub>" link beside the Near You heading. Pure rules + the single read, so the product behaviour is
// testable without a device.
//
// Eligibility is decided by the DATABASE (rpc get_metro_discovery_hubs): a hub is returned only when it is explicitly
// connected to the SELECTED metro (table metro_hub_connections, managed in the admin tool under Destinations > "Show in
// metros") AND destinations.is_active AND destinations.discovery_enabled ("Show on Home"). The phone's location plays no
// part: a Phoenix browser sees Phoenix's hubs from anywhere. destination_zones.is_active (the arrival banner) is a
// separate control and is deliberately not consulted.

export const HUB_LINK_KIND = { NONE: 'none', SINGLE: 'single', MULTI: 'multi' }

/** Keeps only well formed rows, drops duplicates, sorts by name so the label and chooser order are stable. */
export function normalizeHubs(rows) {
  const seen = new Set()
  const out = []
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !r.id || !r.name || seen.has(r.id)) continue
    seen.add(r.id)
    out.push({ id: r.id, name: String(r.name).trim(), slug: r.slug ?? null, hero_image_url: r.hero_image_url ?? null })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * `parts` lets the pill truncate a long hub NAME while the "Explore" lead and the arrow always stay visible.
 * @returns {{kind: string, label: string|null, parts: {lead: string, name: string|null, tail: string}|null, hubs: Array}}
 */
export function deriveHubLink(rows) {
  const hubs = normalizeHubs(rows)
  if (hubs.length === 0) return { kind: HUB_LINK_KIND.NONE, label: null, parts: null, hubs }
  if (hubs.length === 1) {
    return { kind: HUB_LINK_KIND.SINGLE, label: `Explore ${hubs[0].name} →`, parts: { lead: 'Explore', name: hubs[0].name, tail: '→' }, hubs }
  }
  return { kind: HUB_LINK_KIND.MULTI, label: 'Explore destinations →', parts: { lead: 'Explore destinations →', name: null, tail: '' }, hubs }
}

/** One read. A failure (offline, RPC missing on an old database) is "no hubs": the link simply does not appear. */
export async function fetchDiscoveryHubs(supabase, metroId) {
  if (!metroId) return []
  try {
    const { data, error } = await supabase.rpc('get_metro_discovery_hubs', { p_metro_id: metroId })
    if (error) return []
    return normalizeHubs(data)
  } catch {
    return []
  }
}
