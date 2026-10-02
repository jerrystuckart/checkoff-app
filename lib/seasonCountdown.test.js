import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { seasonTimeLeftLabel, MAX_SEASON_COUNTDOWN_DAYS } from './seasonCountdown.js'

const NOW = new Date(2026, 9, 2, 12, 0, 0) // local noon, 2 Oct 2026

test('Positano placeholder end (2027-12-31, 455 days out) never produces a countdown', () => {
  assert.equal(seasonTimeLeftLabel('2027-12-31', NOW), null)
})

test('no end date (open ended list) shows nothing', () => {
  assert.equal(seasonTimeLeftLabel(null, NOW), null)
  assert.equal(seasonTimeLeftLabel(undefined, NOW), null)
})

test('a real season still counts down: Phoenix and Denver end 2026-11-30 (59 days)', () => {
  assert.equal(seasonTimeLeftLabel('2026-11-30', NOW), '59 days left')
  assert.equal(seasonTimeLeftLabel('2026-10-03', NOW), '1 day left')
})

test('ended seasons show nothing; the last day shows hours', () => {
  assert.equal(seasonTimeLeftLabel('2026-10-01', NOW), null)
  assert.match(seasonTimeLeftLabel('2026-10-02', NOW), /^\d+h \d+m left$/)
})

test('the cap is one year: exactly at the cap shows, one day past does not', () => {
  const at = new Date(NOW); at.setDate(at.getDate() + MAX_SEASON_COUNTDOWN_DAYS)
  const past = new Date(NOW); past.setDate(past.getDate() + MAX_SEASON_COUNTDOWN_DAYS + 1)
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  assert.equal(seasonTimeLeftLabel(iso(at), NOW), `${MAX_SEASON_COUNTDOWN_DAYS} days left`)
  assert.equal(seasonTimeLeftLabel(iso(past), NOW), null)
})

test('the data correction migration nulls both Positano lists and only those', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/20261002_amalfi_positano_lists_open_ended.sql', import.meta.url), 'utf8')
  assert.match(sql, /fb5ed539-39ad-43c9-aae6-f6597a5ee76e/)
  assert.match(sql, /5bb9bc06-6406-4c82-b5e7-f6d3d3129606/)
  assert.match(sql, /SET ends_at = NULL/)
  assert.match(sql, /ends_at = '2027-12-31'/)
})
