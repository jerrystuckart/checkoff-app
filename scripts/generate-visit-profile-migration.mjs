// Generates supabase/migrations/20260928b_visit_profile_rule_v1.sql from a JSON
// export of active, geocoded, non-universal items (rows: id, body, cat, prof,
// metro, is_secret). Usage: node scripts/generate-visit-profile-migration.mjs items.json
import fs from 'node:fs'
import { classifyVisitProfile } from '../lib/visitDetection/profileClassifier.js'

const raw = fs.readFileSync(process.argv[2], 'utf8')
const rows = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)).rows
const by = {}
let n = 0
for (const r of rows) {
  if (r.prof || !r.metro || r.is_secret) continue
  const c = classifyVisitProfile({ body: r.body, category: r.cat })
  if (c.profile) { (by[c.profile] ??= []).push(r.id); n++ }
}
let sql = `-- Visit profile coverage, rule set v1 (2026-09-28). See lib/visitDetection/profileClassifier.js:
-- conservative category-level rules validated against the human-assigned labels already in
-- production (93% agreement; only 3 of 259 predictions shorter-dwell than the label; ambiguous
-- categories such as Adventure/Social/Misc are left unassigned). Inert until visit recovery is
-- switched on: nothing monitors a place for a user who has not opted in.
-- Reversible: UPDATE items SET visit_profile_key = NULL, visit_profile_source = NULL WHERE visit_profile_source = 'rule_v1';
BEGIN;

ALTER TABLE items ADD COLUMN IF NOT EXISTS visit_profile_source text;
COMMENT ON COLUMN items.visit_profile_source IS 'NULL = curated by a person before 2026-09-28; rule_v1 = assigned by lib/visitDetection/profileClassifier.js (reversible).';

`
for (const [k, ids] of Object.entries(by)) {
  sql += `UPDATE items SET visit_profile_key = '${k}', visit_profile_source = 'rule_v1'\nWHERE visit_profile_key IS NULL AND NOT is_universal AND is_active AND id IN (\n  ${ids.map((i) => `'${i}'`).join(',\n  ')}\n);\n\n`
}
sql += `DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM items WHERE visit_profile_source = 'rule_v1';
  IF n <> ${n} THEN RAISE EXCEPTION 'expected ${n} rule_v1 assignments, found %', n; END IF;
END $$;

COMMIT;
`
fs.writeFileSync(new URL('../docs/visit-recovery/visit_profile_rule_v1_NOT_APPLIED.sql', import.meta.url), sql)
console.log('assignments:', n, Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.length])))
