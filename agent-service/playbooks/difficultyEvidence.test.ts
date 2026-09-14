import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateDifficultyEvidence, noFrictionDifficultyEvidence, type DifficultyEvidence } from './difficultyEvidence'

const present = (detail: string) => ({ present: true, detail })
const absent = () => ({ present: false, detail: '' })

test('difficultyEvidence: Dallmayr — no factors at all evaluates to 1, deterministic', () => {
  const result = evaluateDifficultyEvidence(noFrictionDifficultyEvidence('calibration-analysis/14, Dallmayr worked example'))
  assert.equal(result.proposedDifficulty, 1)
  assert.equal(result.confidence, 'DETERMINISTIC')
})

test('difficultyEvidence: Steinheil 16 (famously oversized schnitzel, walk-in) evaluates to 1', () => {
  const evidence = noFrictionDifficultyEvidence('14-difficulty-and-secret-remediation-plan.md, Steinheil 16')
  const result = evaluateDifficultyEvidence(evidence)
  assert.equal(result.proposedDifficulty, 1)
})

test('difficultyEvidence: Barroom (smallest bar, walk-in) evaluates to 1', () => {
  const evidence = noFrictionDifficultyEvidence('14-difficulty-and-secret-remediation-plan.md, Barroom')
  assert.equal(evaluateDifficultyEvidence(evidence).proposedDifficulty, 1)
})

test('difficultyEvidence: Café Frischhut — a single narrow timing window ("at dawn") alone escalates to 5', () => {
  const evidence: DifficultyEvidence = {
    ...noFrictionDifficultyEvidence('14-difficulty-and-secret-remediation-plan.md, Café Frischhut'),
    timingRestriction: present('Auszogne only hits the fryer at dawn — a genuine narrow window, not any normal operating hours.'),
  }
  const result = evaluateDifficultyEvidence(evidence)
  assert.equal(result.proposedDifficulty, 5)
  assert.equal(result.confidence, 'DETERMINISTIC')
})

test('difficultyEvidence: Juristische Bibliothek — advance booking alone (no travel) escalates to 5, not 10', () => {
  const evidence: DifficultyEvidence = {
    ...noFrictionDifficultyEvidence('14-difficulty-and-secret-remediation-plan.md, Juristische Bibliothek'),
    advanceBooking: present('Must book the official guided visit in advance; central Munich, no travel factor.'),
  }
  assert.equal(evaluateDifficultyEvidence(evidence).proposedDifficulty, 5)
})

test('difficultyEvidence: Andechs Bräustüberl — surrounding-municipality travel alone (no cost/booking/physical) is 10, deterministic', () => {
  const evidence: DifficultyEvidence = {
    ...noFrictionDifficultyEvidence('14-difficulty-and-secret-remediation-plan.md, Andechs Bräustüberl'),
    travel: { level: 'SURROUNDING_MUNICIPALITY', detail: 'Andechs, ~35km SW — no admission cost, no booking required to bring your own Brotzeit.' },
  }
  const result = evaluateDifficultyEvidence(evidence)
  assert.equal(result.proposedDifficulty, 10)
  assert.equal(result.confidence, 'DETERMINISTIC')
})

test('difficultyEvidence: Therme Erding — meaningful admission + surrounding-municipality travel is 10, NOT 25 (no physical/skill factor)', () => {
  const evidence: DifficultyEvidence = {
    ...noFrictionDifficultyEvidence('14-difficulty-and-secret-remediation-plan.md, Therme Erding'),
    cost: present('Meaningful paid admission to the glass-domed thermal pools, beyond an ordinary purchase price.'),
    travel: { level: 'SURROUNDING_MUNICIPALITY', detail: 'Erding, ~35km NE.' },
  }
  const result = evaluateDifficultyEvidence(evidence)
  assert.equal(result.proposedDifficulty, 10, 'cost+travel alone must not reach 25 — only travel+physical-effort does')
})

test('difficultyEvidence: Weihenstephan — advance-booked guided tasting + surrounding-municipality travel is 10', () => {
  const evidence: DifficultyEvidence = {
    ...noFrictionDifficultyEvidence('14-difficulty-and-secret-remediation-plan.md, Weihenstephan'),
    advanceBooking: present('Guided brewhouse tour and tasting.'),
    travel: { level: 'SURROUNDING_MUNICIPALITY', detail: 'Freising, ~35km N.' },
  }
  assert.equal(evaluateDifficultyEvidence(evidence).proposedDifficulty, 10)
})

test('difficultyEvidence: KartPalast Funpark — paid timed session + surrounding-municipality travel is 10', () => {
  const evidence: DifficultyEvidence = {
    ...noFrictionDifficultyEvidence('14-difficulty-and-secret-remediation-plan.md, KartPalast Funpark'),
    cost: present('Paid, timed electric-karting session.'),
    travel: { level: 'SURROUNDING_MUNICIPALITY', detail: 'Bergkirchen, ~25km W.' },
  }
  assert.equal(evaluateDifficultyEvidence(evidence).proposedDifficulty, 10)
})

test('difficultyEvidence: Maisinger Schlucht — surrounding-municipality travel COMBINED with real physical effort (a hike) is 25, the clearest 25 in the real catalog', () => {
  const evidence: DifficultyEvidence = {
    ...noFrictionDifficultyEvidence('14-difficulty-and-secret-remediation-plan.md, Maisinger Schlucht'),
    physicalEffort: present('A real hike along the shaded gorge path through Maisinger Bach.'),
    travel: { level: 'SURROUNDING_MUNICIPALITY', detail: 'Starnberg-area outer geography, ~25-35km.' },
  }
  const result = evaluateDifficultyEvidence(evidence)
  assert.equal(result.proposedDifficulty, 25)
  assert.equal(result.confidence, 'DETERMINISTIC')
})

test('difficultyEvidence: DAV Kletter- und Boulderzentrum — physical effort alone (ordinary day-pass cost not counted as "meaningful") is 5, not 10', () => {
  const evidence: DifficultyEvidence = {
    ...noFrictionDifficultyEvidence('14-difficulty-and-secret-remediation-plan.md, DAV Kletter- und Boulderzentrum Thalkirchen'),
    physicalEffort: present('Climb the tallest route you can finish — a real skill/physical-effort factor.'),
    // An ordinary day-pass, like an ordinary meal/drink price, is deliberately
    // NOT modeled as a "meaningful" cost factor here — matching the doc's own
    // "deterministic on the physical-effort factor" note for this item.
  }
  const result = evaluateDifficultyEvidence(evidence)
  assert.equal(result.proposedDifficulty, 5)
})

test('difficultyEvidence: SAP Garden — low-intensity physical activity is a genuine boundary case, must surface REQUIRES_REVIEW rather than assert confidently', () => {
  const evidence: DifficultyEvidence = {
    ...noFrictionDifficultyEvidence('14-difficulty-and-secret-remediation-plan.md, SAP Garden'),
    cost: present('Admission/rental cost for public skating.'),
    physicalEffort: present('Some physical activity (skating), but low-intensity and walk-in-friendly.'),
    boundaryCaseNote: 'Physical-effort weighting for a low-intensity, walk-in-friendly activity like public skating is a judgment call, not fully deterministic (per the source remediation plan).',
  }
  const result = evaluateDifficultyEvidence(evidence)
  assert.equal(result.confidence, 'REQUIRES_REVIEW')
  assert.ok(result.reasons.some((r) => r.includes('Flagged for human review')))
})

test('difficultyEvidence: Surftown MUC — booking + physical skill + surrounding-municipality travel is a genuine 10-vs-25 boundary case, must surface REQUIRES_REVIEW', () => {
  const evidence: DifficultyEvidence = {
    ...noFrictionDifficultyEvidence('14-difficulty-and-secret-remediation-plan.md, Surftown MUC'),
    advanceBooking: present('Must book a session on the artificial surf wave.'),
    physicalEffort: present('A real physical/skill requirement to surf the standing wave.'),
    travel: { level: 'SURROUNDING_MUNICIPALITY', detail: 'Hallbergmoos, near the airport — closer-in than Erding/Andechs, a genuine boundary case.' },
    boundaryCaseNote: 'Hallbergmoos is closer-in than Erding/Andechs, which argues for 10, but surf-specific booking + skill argues toward 25 — a genuine boundary case per the source remediation plan.',
  }
  const result = evaluateDifficultyEvidence(evidence)
  assert.equal(result.confidence, 'REQUIRES_REVIEW')
  // The deterministic math (travel + physical effort) still lands on 25 —
  // REQUIRES_REVIEW is what keeps this from being silently trusted as final.
  assert.equal(result.proposedDifficulty, 25)
})

test('difficultyEvidence: two independent central-Munich planning-step factors (no travel) together reach 10, not 25 — travel is required for 25', () => {
  const evidence: DifficultyEvidence = {
    ...noFrictionDifficultyEvidence('synthetic — two independent level-5 factors, no travel'),
    cost: present('A meaningful admission fee.'),
    advanceBooking: present('A short-notice reservation is required.'),
  }
  const result = evaluateDifficultyEvidence(evidence)
  assert.equal(result.proposedDifficulty, 10)
})

test('difficultyEvidence: travel to a close-in outer neighborhood (still inside the city) counts as exactly one planning-step factor', () => {
  const evidence: DifficultyEvidence = {
    ...noFrictionDifficultyEvidence('synthetic — close-in outer neighborhood, real Munich Stadtbezirk outside the original 10'),
    travel: { level: 'CLOSE_IN_OUTER_NEIGHBORHOOD', detail: 'Obergiesing-Fasangarten — a real Munich Stadtbezirk outside the original 10 central neighborhoods, still inside the city.' },
  }
  assert.equal(evaluateDifficultyEvidence(evidence).proposedDifficulty, 5)
})

test('difficultyEvidence: never escalates difficulty from venue fame alone — a famous landmark with zero evidenced factors stays 1', () => {
  const evidence = noFrictionDifficultyEvidence('guardrail check — a famous, free, walk-in landmark must not be scored harder for being famous')
  assert.equal(evaluateDifficultyEvidence(evidence).proposedDifficulty, 1)
})
