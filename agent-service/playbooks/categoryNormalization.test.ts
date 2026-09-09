import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyCategory, classifyCategoryWithFallback, countByCanonicalCategory, CANONICAL_CHECKOFF_CATEGORIES } from './categoryNormalization'

test('classifyCategory: an exact canonical label always matches itself', () => {
  for (const c of CANONICAL_CHECKOFF_CATEGORIES) {
    assert.equal(classifyCategory(c).canonical, c)
  }
})

test('classifyCategory: obvious free-text variants map to the correct canonical bucket', () => {
  const cases: Array<[string, string]> = [
    ['Restaurant (Japanese/izakaya)', 'Food & drink'],
    ['Food Hall', 'Food & drink'],
    ['Food hall', 'Food & drink'],
    ['Café / coffee shop', 'Food & drink'],
    ['Taco shop', 'Food & drink'],
    ['Nightclub/multi-room', 'Nightlife'],
    ['Dance/nightclub', 'Nightlife'],
    ['Rooftop Bar', 'Bar & drinks'],
    ['Cocktail Lounge', 'Bar & drinks'],
    ['Brewery / restaurant', 'Bar & drinks'], // priority-ordered: a brewery is primarily a drinking establishment
    ['Adventure (zip‑line)', 'Adventure'],
    ['Museum / Historic Ship', 'Arts & Culture'],
    ['Museums & Galleries', 'Arts & Culture'],
    ['Shopping Mall', 'Shopping'],
    ['Mall / Luxury Shopping Center', 'Shopping'],
    ['Antique District', 'Shopping'],
    ['Youth/Club Sports Organization', 'Sports'],
    ["National Women's Soccer League (NWSL) team", 'Sports'],
    ['Event / Sports', 'Sports'],
    ['Women’s Social Community', 'Social'],
    ['Community Centers', 'Social'],
    ['Travel Agency / Passport & Visa Services', 'Travel'],
    ['Spa & self-care', 'Spa & self-care'],
  ]
  for (const [raw, expected] of cases) {
    assert.equal(classifyCategory(raw).canonical, expected, `expected "${raw}" -> ${expected}`)
  }
})

test('classifyCategory: San Diego attrition audit recovery — real category labels that previously fell through unclassified (2026-09)', () => {
  const cases: Array<[string, string]> = [
    ['Wildlife/Educational', 'Adventure'], // The Living Coast Discovery Center
    ['Cultural/Downtown', 'Arts & Culture'], // Historic Third Avenue
    ['Outdoor / Attraction', 'Adventure'], // Coronado Central Beach
    ['Outdoor / Recreation', 'Adventure'], // Bike rental & riding
    ['Park / Outdoor', 'Adventure'], // Coronado Tidelands Park
    ['bookstore', 'Shopping'], // Libélula Books & Co.
    ['fashion / boutique', 'Shopping'], // Sew Loka
    ['music / performance venue', 'Arts & Culture'], // Listening Rooms
    ['Boutique / local artist collective', 'Shopping'], // Pangaea Outpost
    ['Dessert (frozen yogurt)', 'Food & drink'], // Yogurt On The Rocks
    ['Scenic park / viewpoint', 'Adventure'], // Kate Sessions Park
    ['Artisan doughnut shop', 'Food & drink'], // The Goods
    ['Hands‑on glassblowing workshop', 'Arts & Culture'], // Barrio Glassworks
    ['Free‑roam VR escape rooms & arcade', 'Adventure'], // Escape To VR
    ['Historic ranch & guided tours', 'Travel'], // Leo Carrillo Ranch Historic Park (plural "tours" bug fix)
  ]
  for (const [raw, expected] of cases) {
    assert.equal(classifyCategory(raw).canonical, expected, `expected "${raw}" -> ${expected}`)
  }
})

test('classifyCategory: "Upscale Contemporary" (Herb & Wood\'s real research category) is still correctly unclassified — no keyword in the text itself identifies it as food, so it must not be guessed', () => {
  assert.equal(classifyCategory('Upscale Contemporary').canonical, null)
})

test('classifyCategory: a genuinely unrecognizable label is flagged unclassified, never forced into a bucket', () => {
  const result = classifyCategory('Upscale Contemporary')
  assert.equal(result.canonical, null)
  assert.equal(result.raw, 'Upscale Contemporary')
})

test('classifyCategory: null/empty/whitespace category is unclassified, not an error', () => {
  assert.equal(classifyCategory(null).canonical, null)
  assert.equal(classifyCategory(undefined).canonical, null)
  assert.equal(classifyCategory('   ').canonical, null)
})

// ---------------------------------------------------------------------------
// Regression: the real San Diego metro_launch run (2026-09-05, project
// "san-diego") reported 9 of 11 categories as "0/minimum" via
// auditCoverage()'s old exact-string match, despite 207 real candidates
// already gathered — because research_verifier's live output used
// descriptive labels like these, never the bare canonical strings.
// countByCanonicalCategory must show real, non-zero counts for every
// category that actually has coverage in this exact raw data.
// ---------------------------------------------------------------------------

const REAL_SAN_DIEGO_RUN_RAW_CATEGORIES = [
  'Attraction / Zoo',
  'Urban Park / Cultural Institutions',
  'Museum / Historic Ship',
  'Theme Park / Marine Attraction',
  'Amusement Park',
  'Historic District / Cultural Area',
  'Historic Site / National Monument',
  'Natural Reserve / Hiking',
  'Theme Park',
  'Wildlife Park / Safari',
  'Sports Venue',
  'Event / Sports',
  'Recurring Event / Market',
  'Annual Festival / Pride',
  'Annual Sports Event',
  'Restaurant (Japanese/izakaya)',
  'Restaurant (French/Côte d’Azur-inspired)',
  'Restaurant (French brasserie)',
  'Wine bar / Mediterranean small plates',
  'Restaurant (Mexican regional)',
  'Cocktail lounge',
  'Restaurant (coastal Italian)',
  'Restaurant (Eastern Mediterranean/Greek-inspired)',
  'Café / coffee shop',
  'Brewery / restaurant',
  'Restaurant (Spanish tapas)',
  'Restaurant (fast‑casual vegan)',
  'Gastropub',
  'Bar & drinks',
  'Adventure (zip‑line)',
  'Adventure (sea cave kayaking)',
  'Adventure (wildlife boat tour)',
  'Adventure (high‑speed boat ride)',
  'Adventure (speed boat tour)',
  'Adventure (aerial balloon)',
  'Adventure (aerial helicopter)',
  'Adventure (equestrian)',
  'Performing Arts Venue',
  'Museum',
  'Mingei International Museum'.split(' ').slice(-1)[0], // 'Museum' again, harmless duplicate for volume
  'Shopping Mall',
  'Shopping Outlet Center',
  'Shopping District',
  'Adult Sports Organization',
  'Youth/Club Sports Organization',
]

test('countByCanonicalCategory: regression — the real San Diego run data no longer produces false 0/minimum categories', () => {
  const { counts, unclassified } = countByCanonicalCategory(REAL_SAN_DIEGO_RUN_RAW_CATEGORIES)
  const byName = new Map(counts.map((c) => [c.categoryName, c.count]))

  // These are exactly the categories the OLD exact-match auditCoverage
  // falsely reported as 0/minimum despite real coverage in this data.
  assert.ok((byName.get('Food & drink') ?? 0) >= 8, 'Food & drink must reflect the many descriptive restaurant labels present')
  assert.ok((byName.get('Arts & Culture') ?? 0) >= 4)
  assert.ok((byName.get('Shopping') ?? 0) >= 3)
  assert.ok((byName.get('Sports') ?? 0) >= 4)
  assert.ok((byName.get('Adventure') ?? 0) >= 5)
  assert.ok((byName.get('Bar & drinks') ?? 0) >= 4)

  // Every raw label is either counted canonically or explicitly surfaced as unclassified — none silently dropped.
  const totalAccounted = counts.reduce((sum, c) => sum + c.count, 0) + unclassified.length
  assert.equal(totalAccounted, REAL_SAN_DIEGO_RUN_RAW_CATEGORIES.length)
})

// ---------------------------------------------------------------------------
// Regression: the real Vienna metro_launch repair run (2026-09-09) —
// 106/299 certified items reported "no classifiable category" against
// their REAL raw category labels. Two distinct defects, both fixed
// here, not just individually patched labels:
//   1. missing keywords (orchestra/concert/opera/church/palace/heritage/
//      architecture/garden/attraction/viewpoint/parkour/etc. were never
//      recognized at all) and missing pluralization (theat(er|re) didn't
//      match "Theaters", landmark didn't match "landmarks") — the same
//      class of gap the original San Diego fix addressed, just a
//      different, larger set of real labels.
//   2. a genuine Unicode bug: JS regex \b does not treat an accented
//      letter (é, ö, ...) as a word character, so "café" failed to
//      match caf[eé] the moment it was followed by anything but
//      whitespace/string-end (e.g. "café/community space") — this is
//      international-metro-specific and will recur for German/French/
//      Spanish-etc. labels in any future non-English-heavy metro unless
//      stripDiacritics keeps normalizing it away.
// ---------------------------------------------------------------------------

test('classifyCategory: real Vienna raw category labels that previously fell through unclassified (2026-09-09 repair run)', () => {
  const cases: Array<[string, string]> = [
    ['Nightlife - Club', 'Nightlife'],
    ['Nightlife - Club / Disco', 'Nightlife'],
    ['Disco', 'Nightlife'],
    ['LGBTQ+ Club', 'Nightlife'],
    ['traditional Viennese coffeehouse', 'Food & drink'],
    ['café/community space', 'Food & drink'], // the diacritics-boundary bug, specifically
    ['Food/Ice cream', 'Food & drink'],
    ['food/retail', 'Shopping'], // "retail" wins — Shopping is checked before Food & drink
    ['Music & classical performance', 'Arts & Culture'],
    ['Chamber ensemble', 'Arts & Culture'],
    ['Chamber orchestra (contemporary)', 'Arts & Culture'],
    ['Orchestra', 'Arts & Culture'],
    ['concert venue', 'Arts & Culture'],
    ['Theaters', 'Arts & Culture'], // plural — "theat(er|re)" alone didn't match
    ['Opera house', 'Arts & Culture'],
    ['Palace / Imperial Residence', 'Arts & Culture'],
    ['Church Venue', 'Arts & Culture'],
    ['Religious architecture', 'Arts & Culture'],
    ['Heritage/Religious', 'Arts & Culture'],
    ['Culture/Cinema', 'Arts & Culture'],
    ['Retail/Design', 'Shopping'],
    ['Attraction', 'Travel'],
    ['Tourist Attraction / Family', 'Travel'],
    ['Scenic Viewpoint / Lookout', 'Travel'],
    ['Travel & landmarks', 'Arts & Culture'], // "landmarks" plural — Arts & Culture's landmark rule wins (checked before Travel)
    ['Heritage / Walking tour', 'Arts & Culture'], // "Heritage" wins — Arts & Culture is checked before Travel
    ['Indoor parkour / trampolines', 'Adventure'],
    ['Green Spaces', 'Adventure'],
    ['Public parks / green spaces', 'Adventure'],
    ['Gardens/Parks', 'Adventure'],
    ['gardens/horticultural site', 'Adventure'],
    ['aquarium', 'Adventure'],
    ['public leisure / swimming facility', 'Adventure'],
    ['shopping_street', 'Shopping'], // underscore-as-boundary bug
    ['library', 'Arts & Culture'],
  ]
  for (const [raw, expected] of cases) {
    assert.equal(classifyCategory(raw).canonical, expected, `expected "${raw}" -> ${expected}, got ${JSON.stringify(classifyCategory(raw))}`)
  }
})

test('classifyCategory: an accented letter is treated as a real word character for boundary purposes — "café" matches even directly followed by punctuation, not just whitespace/string-end', () => {
  assert.equal(classifyCategory('café/community space').canonical, 'Food & drink')
  assert.equal(classifyCategory('café-community').canonical, 'Food & drink')
  assert.equal(classifyCategory('Schönbrunn Palace Concerts').canonical, 'Arts & Culture')
  // The ORIGINAL raw label (with diacritics intact) is still what's returned/preserved — normalization is match-only.
  assert.equal(classifyCategory('café/community space').raw, 'café/community space')
})

test('classifyCategory: genuinely vague/non-tourist labels (municipal or civic-initiative style, no venue-type keyword at all) stay unclassified — never force-guessed into a category', () => {
  const stillVague = ['District', 'modern facility', 'geographical feature', 'neighborhood/highlights', 'public district initiatives', 'Urban Development']
  for (const raw of stillVague) {
    assert.equal(classifyCategory(raw).canonical, null, `expected "${raw}" to stay unclassified (no reliable venue-type signal)`)
  }
})

test('countByCanonicalCategory: unclassified labels are reported, not counted toward any canonical category', () => {
  const { counts, unclassified } = countByCanonicalCategory(['Upscale Contemporary', 'Food Hall'])
  assert.equal(unclassified.length, 1)
  assert.equal(unclassified[0].raw, 'Upscale Contemporary')
  const foodCount = counts.find((c) => c.categoryName === 'Food & drink')?.count
  assert.equal(foodCount, 1)
})

// ---------------------------------------------------------------------------
// classifyCategoryWithFallback (Chief Phase 2AC) — a bounded fallback
// used ONLY by METADATA_COMPLETENESS_GATE: when the raw category label
// itself carries no venue-type signal, try the item's own certified
// body text via the EXACT SAME deterministic rules.
// ---------------------------------------------------------------------------

test('classifyCategoryWithFallback: uses the raw category when it already classifies — body is never even consulted', () => {
  const result = classifyCategoryWithFallback('Restaurant (Japanese/izakaya)', 'this text is irrelevant')
  assert.equal(result.canonical, 'Food & drink')
})

test('classifyCategoryWithFallback: falls back to the body when the raw category has no venue-type signal', () => {
  const result = classifyCategoryWithFallback('Innere Stadt, landscape', "Wander the formal garden paths at 'Burggarten'.")
  assert.equal(result.canonical, 'Adventure') // "garden" keyword in the body
})

test('classifyCategoryWithFallback: still returns null (never a guess) when NEITHER the category nor the body carries a recognizable signal', () => {
  const result = classifyCategoryWithFallback('district', 'Explore the area and see what is around.')
  assert.equal(result.canonical, null)
})

test('classifyCategoryWithFallback: preserves the ORIGINAL raw category text even when the fallback resolves it — never substitutes the body as the reported raw label', () => {
  const result = classifyCategoryWithFallback('Innere Stadt, landscape', "Wander the formal garden paths at 'Burggarten'.")
  assert.equal(result.raw, 'Innere Stadt, landscape')
})

test('classifyCategoryWithFallback: a real Vienna civic-initiative label with no venue-type signal anywhere stays unclassified — correctly signals "drop candidate", never forces a guess', () => {
  const result = classifyCategoryWithFallback('district', 'Leopoldstadt (2nd District) is a diverse district worth exploring.')
  assert.equal(result.canonical, null)
})
