// Generates supabase/migrations/20260928b_visit_profile_rule_v1.sql from a JSON
// export of ALL catalog items (rows: id, body, cat, prof, metro, is_active,
// is_universal, is_secret, has_coords). Usage: node scripts/generate-visit-profile-migration.mjs items.json
import fs from 'node:fs'
import { assignableVisitProfile } from '../lib/visitDetection/profileClassifier.js'

const raw = fs.readFileSync(process.argv[2], 'utf8')
const rows = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)).rows
const by = {}
let n = 0
for (const r of rows) {
  const c = assignableVisitProfile(r)
  if (c.profile) { (by[c.profile] ??= []).push(r.id); n++ }
}
let sql = `-- Visit profile coverage, rule set v1 (2026-09-28). Rules: lib/visitDetection/profileClassifier.js.
-- Hard safety properties are enforced by lib/visitDetection/profileClassifier.test.js over the whole
-- catalog (never inactive, universal, secret, un-geocoded, metro-less, area-level, brief-stop, already-
-- profiled or manual_only rows; the UPDATEs below also only fill empty profiles). Review counts and
-- samples by city and category: docs/visit-recovery/profile_assignment_review.md.
-- Inert until visit recovery is switched on: nothing monitors a place for a user who has not opted in.
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
fs.writeFileSync(new URL('../supabase/migrations/20260928b_visit_profile_rule_v1.sql', import.meta.url), sql)
console.log('assignments:', n, Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.length])))
