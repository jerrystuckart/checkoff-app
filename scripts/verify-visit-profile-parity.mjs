// Compares the reference JS rule (lib/visitDetection/profileClassifier.js classifyVisitProfile) with the database
// function public.classify_visit_profile (used by the items intake trigger) over every live item body plus edge
// cases. Requires the Supabase CLI linked to the project. Usage: node scripts/verify-visit-profile-parity.mjs
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { classifyVisitProfile } from '../lib/visitDetection/profileClassifier.js'

function q(sql) {
  const f = path.join(os.tmpdir(), `profile-parity-${process.pid}.sql`)
  fs.writeFileSync(f, sql)
  const out = execFileSync('supabase', ['db', 'query', '-f', f, '--linked'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28 })
  return JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)).rows
}

const live = q(`SELECT i.body, c.name AS cat FROM items i LEFT JOIN categories c ON c.id = i.category_id`)
const cats = ['Bar & drinks', 'Nightlife', 'Arts & Culture', 'Shopping', 'Food & drink', 'Spa & self-care', 'Play', 'Travel', 'Sports', 'Adventure', 'Social', 'Misc']
const edge = [
  "Sip an espresso at 'Café Central'", "Order at the 'Wine Window' on the corner", "Order through the 'Buchetta' window",
  "Watch the game at 'Lambeau Field'", "Attend the 'Turkey Trot' race", "Cheer at 'Miller Park' for the match", "Walk 'Central Park' trails",
  "Try gelato at 'Gelateria Rossi' cafés", "Go shopping in Kenosha", "Visit the 'Museum of Art' cathedral tour", "Grab a cafe' au lait at 'Le Petit'", "Boat tour on the 'Lake' — a paddle",
]
const cases = [...live.map((r) => ({ body: r.body, cat: r.cat })), ...edge.flatMap((body) => cats.map((cat) => ({ body, cat })))]
const rows = q(`SELECT n, public.classify_visit_profile(body, cat) AS p FROM (VALUES ${cases.map((c, i) => `(${i}, $b$${c.body}$b$, ${c.cat ? `$c$${c.cat}$c$` : 'NULL'})`).join(',')}) v(n, body, cat) ORDER BY n`)

let bad = 0
for (const r of rows) {
  const c = cases[r.n]
  const js = classifyVisitProfile({ body: c.body, category: c.cat ?? '' }).profile
  if (js !== r.p) { bad++; if (bad <= 10) console.log('MISMATCH', JSON.stringify(c), 'js=', js, 'sql=', r.p) }
}
console.log(`cases=${cases.length} compared=${rows.length} mismatches=${bad}`)
process.exit(bad || rows.length !== cases.length ? 1 : 0)
