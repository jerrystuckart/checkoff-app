// Conservative, rule-based visit-profile suggestion for catalog items that have
// none. visit_profile_key decides two things: whether an item is monitored at
// all (no profile = ordinary at-place check-off only) and how long a stay must
// be before it becomes a suggestion (visit_detection_profiles dwell minutes).
//
// Design rules:
//  * Category-level rules only where the human-assigned labels already in
//    production agree ~100% (Bar & drinks -> bar, Arts & Culture ->
//    attraction, Shopping -> retail; see the accuracy test).
//  * When uncertain between two profiles, pick the LONGER-dwell one so a
//    mistake costs a missed short stop, never a false suggestion.
//  * Anything without a confident rule returns null and stays unassigned:
//    never a generic default.
//  * Nothing here auto-checks-off; a profile only makes a place eligible to
//    produce a private, user-confirmed suggestion.

const QUICK_STOP = /\b(gelato|gelateria|ice[- ]cream|soft[- ]serve|cafe|café|caffè|coffee|espresso|latte|cappuccino|roaster(?:s|y)?|donut|doughnut|bakery|pastry|pastries|croissant|bagel|boba|smoothie|juice bar|cookie|scoop)\b/i
const OUTDOOR = /\b(park|trail|hike|hiking|beach|garden|gardens|lake|river|creek|pier|canyon|summit|overlook|viewpoint|lookout|tide pools?|kayak|paddle|nature reserve|botanical|dunes?|waterfall|boardwalk)\b/i
const ATTRACTION = /\b(museum|zoo|aquarium|gallery|exhibit|observatory|planetarium|escape room|arcade|climbing|bouldering|theme park|cruise|tour|castle|palace|cathedral|basilica|church)\b/i
// A stop measured in seconds, not minutes (wine window, walk-up/take-away window): a dwell profile would only ever misfire.
const BRIEF_STOP = /\b(wine window|buchetta|walk-?up window|take-?away window|drive[- ]?thru|drive[- ]?through|through the [\w' -]{0,40}window)\b/i
const EVENT = /\b(festival|tournament|marathon|parade|fireworks|concert|game|match|derby|race|regatta|rodeo)\b/i

export function classifyVisitProfile({ body = '', category = '', isSecret = false, isUniversal = false } = {}) {
  if (isSecret || isUniversal) return { profile: null, reason: 'excluded_secret_or_universal' }
  const text = String(body)
  if (BRIEF_STOP.test(text)) return { profile: null, reason: 'brief_stop_cue' }
  switch (category) {
    case 'Bar & drinks': return { profile: 'bar', reason: 'category_bar' }
    case 'Nightlife':
      return ATTRACTION.test(text) ? { profile: 'attraction', reason: 'nightlife_attraction_cue' } : { profile: 'bar', reason: 'category_nightlife' }
    case 'Arts & Culture': return { profile: 'attraction', reason: 'category_arts' }
    case 'Shopping': return { profile: 'retail', reason: 'category_shopping' }
    case 'Food & drink':
      return QUICK_STOP.test(text) ? { profile: 'quick_stop', reason: 'food_quick_cue' } : { profile: 'restaurant', reason: 'food_default_longer_dwell' }
    case 'Spa & self-care':
    case 'Play':
      return { profile: 'attraction', reason: 'category_indoor_activity' }
    case 'Travel':
      return OUTDOOR.test(text) ? { profile: 'outdoor', reason: 'travel_outdoor_cue' } : { profile: 'attraction', reason: 'category_travel' }
    case 'Sports':
      return EVENT.test(text) && /\b(watch|attend|catch|join|cheer)\b/i.test(text)
        ? { profile: 'event', reason: 'sports_event_cue' }
        : { profile: null, reason: 'no_confident_rule' }
    // Adventure / Social / Misc: existing human labels split across outdoor,
    // attraction and event (only 60% agreement with any text rule), so these
    // stay unassigned rather than guessed — ordinary at-place check-off only.
    default:
      return { profile: null, reason: 'no_confident_rule' }
  }
}
