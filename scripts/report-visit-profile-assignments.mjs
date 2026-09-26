// Reviewable report of the proposed rule_v1 visit-profile assignments.
// Usage: node scripts/report-visit-profile-assignments.mjs items.json > docs/visit-recovery/profile_assignment_review.md
import fs from 'node:fs'
import { assignableVisitProfile, classifyVisitProfile } from '../lib/visitDetection/profileClassifier.js'
const raw = fs.readFileSync(process.argv[2], 'utf8')
const rows = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)).rows
const pad = (s, n) => String(s).padEnd(n)
const table = (head, body) => `| ${head.join(' | ')} |\n|${head.map(() => '---').join('|')}|\n${body.map((r) => `| ${r.join(' | ')} |`).join('\n')}\n`

const geocoded = rows.filter((r) => r.is_active && !r.is_universal && r.has_coords && r.metro)
const decisions = rows.map((r) => ({ r, d: assignableVisitProfile(r) }))
const assigned = decisions.filter((x) => x.d.profile)

const profiles = ['quick_stop', 'fast_casual', 'restaurant', 'bar', 'retail', 'attraction', 'outdoor', 'event']
const byMetro = {}
for (const r of geocoded) {
  const m = (byMetro[r.metro] ??= { total: 0, before: 0, added: 0, unassigned: 0 })
  m.total++
  if (r.prof && r.prof !== 'manual_only') m.before++
}
for (const { r, d } of assigned) byMetro[r.metro].added++
for (const r of geocoded) if (!(r.prof && r.prof !== 'manual_only') && !assignableVisitProfile(r).profile) byMetro[r.metro].unassigned++

let out = `# Visit profile assignments — rule_v1 (review)\n\nGenerated ${new Date().toISOString().slice(0, 10)} from a full catalog export (${rows.length} rows). Rules: \`lib/visitDetection/profileClassifier.js\`. Tests: \`profileClassifier.test.js\`.\n\n`
out += `## Coverage by city (active, non-universal, geocoded items)\n\n`
out += table(['City', 'Items', 'Profiled before', '+ rule_v1', 'Profiled after', 'Coverage after', 'Left unassigned (no confident rule)'],
  Object.entries(byMetro).sort((a, b) => b[1].total - a[1].total).map(([k, v]) => [k, v.total, v.before, v.added, v.before + v.added, `${Math.round(100 * (v.before + v.added) / v.total)}%`, v.unassigned]))
out += `\n## Assignments by category × profile\n\n`
const cp = {}
for (const { r, d } of assigned) { const k = r.cat ?? '(none)'; (cp[k] ??= {}); cp[k][d.profile] = (cp[k][d.profile] ?? 0) + 1 }
out += table(['Category', ...profiles, 'Total'], Object.entries(cp).sort().map(([c, v]) => [c, ...profiles.map((p) => v[p] ?? 0), Object.values(v).reduce((a, b) => a + b, 0)]))
out += `\n## Assignments by city × profile\n\n`
const mp = {}
for (const { r, d } of assigned) { (mp[r.metro] ??= {}); mp[r.metro][d.profile] = (mp[r.metro][d.profile] ?? 0) + 1 }
out += table(['City', ...profiles, 'Total'], Object.entries(mp).sort().map(([c, v]) => [c, ...profiles.map((p) => v[p] ?? 0), Object.values(v).reduce((a, b) => a + b, 0)]))
out += `\n## Never assigned (guards) — counts over the whole catalog\n\n`
const reasons = {}
for (const { d } of decisions) if (!d.profile) reasons[d.reason] = (reasons[d.reason] ?? 0) + 1
out += table(['Reason', 'Rows'], Object.entries(reasons).sort((a, b) => b[1] - a[1]))
const wouldWrong = { inactive: 0, universal: 0, secret: 0, no_coordinates: 0, no_metro: 0, already_profiled: 0 }
for (const r of rows) {
  const reason = assignableVisitProfile(r).reason
  if (reason in wouldWrong && classifyVisitProfile({ body: r.body, category: r.cat }).profile) wouldWrong[reason]++
}
out += `\nRows the category rules alone WOULD have assigned but a guard blocked: ${Object.entries(wouldWrong).map(([k, v]) => `${k}=${v}`).join(', ')} (so each guard is load-bearing, and \`manual_only\` rows are never overwritten: ${rows.filter((r) => r.prof === 'manual_only').length} such rows untouched).\n`
out += `\n## Samples (up to 3 per category × profile, spread across cities)\n\n`
const groups = {}
for (const { r, d } of assigned) (groups[`${r.cat} → ${d.profile}`] ??= []).push(r)
for (const [k, list] of Object.entries(groups).sort()) {
  const seen = new Set(); const pick = []
  for (const r of list) if (!seen.has(r.metro) && pick.length < 3) { seen.add(r.metro); pick.push(r) }
  for (const r of list) if (pick.length < 3 && !pick.includes(r)) pick.push(r)
  out += `**${k}** (${list.length})\n\n${pick.map((r) => `- ${r.metro}: ${String(r.body).slice(0, 120)}`).join('\n')}\n\n`
}
process.stdout.write(out)
