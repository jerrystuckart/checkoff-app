/**
 * Shared end-of-import check for the CSV import scripts.
 *
 * An item is only monitored on a phone (visit recovery) when it has coordinates AND a visit profile. The database
 * assigns a profile on insert/update when the category rule is confident (trigger
 * trg_zz_items_default_visit_profile), but the CSV imports carry only a maps_query, so imported places have no
 * coordinates until they are geocoded. This prints, for the ids just imported, which are ready, which were
 * deliberately excluded, and which are INCOMPLETE (and what each is missing), so it is never a step to remember.
 *
 * Reads the item_visit_readiness view (supabase/migrations/20260929b_visit_profile_intake_guard.sql).
 */
async function reportVisitReadiness(supabase, ids) {
  if (!ids || !ids.length) return
  const rows = []
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase
      .from('item_visit_readiness')
      .select('item_id, body, readiness, missing, visit_profile_key')
      .in('item_id', ids.slice(i, i + 100))
    if (error) {
      console.log(`\n(visit-detection readiness could not be read: ${error.message})`)
      return
    }
    rows.push(...(data ?? []))
  }
  const by = (s) => rows.filter((r) => r.readiness === s)
  const incomplete = by('incomplete')
  console.log('\nVisit detection readiness of the imported items:')
  console.log(`  ready (monitored on phones): ${by('monitored_ready').length}`)
  console.log(`  intentionally excluded:      ${by('intentionally_excluded').length}`)
  console.log(`  not applicable / inactive:   ${by('not_applicable').length + by('inactive').length}`)
  console.log(`  INCOMPLETE:                  ${incomplete.length}`)
  if (incomplete.length) {
    const noCoords = incomplete.filter((r) => (r.missing ?? []).includes('coordinates')).length
    const noProfile = incomplete.filter((r) => (r.missing ?? []).includes('profile')).length
    console.log(`    ${noCoords} need coordinates (run the Places geocoder, then they are classified automatically)`)
    console.log(`    ${noProfile} need a visit profile decision (admin > Items > Visit detection, or mark intentionally excluded)`)
    incomplete.slice(0, 25).forEach((r) => console.log(`    - [${(r.missing ?? []).join('+')}] ${String(r.body).slice(0, 90)}`))
    if (incomplete.length > 25) console.log(`    ... and ${incomplete.length - 25} more (admin Items > Visit: Incomplete)`)
    console.log('  Incomplete places are never monitored, so visits to them will not be suggested.')
  }
}

module.exports = { reportVisitReadiness }
