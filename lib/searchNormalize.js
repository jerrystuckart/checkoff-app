// Nearby Redesign (2026-09-19) — pure text-normalization helper for
// search-quality parity across German transliteration variants. Real
// production item bodies contain genuine German diacritics (e.g.
// "Hüftgold"), but users type all three common spellings interchangeably:
// the umlaut form ("Hüftgold"), the bare-Latin form with the umlaut simply
// dropped ("Huftgold"), and the ASCII transliteration form ("Hueftgold").
// All three must normalize to the identical string so a search-quality
// pass built on top of this helper (see runSearch in
// screens/DiscoverScreen.jsx) can treat them as equivalent.
//
// No RN/browser-only API is required beyond String.prototype.normalize,
// which Hermes has supported since RN 0.64 — but this is wrapped in a
// try/catch fallback (an explicit character-substitution map covering the
// common German + generic Latin diacritics) so a Hermes build that ever
// lacked/regressed `.normalize()` degrades gracefully instead of crashing
// search entirely.
//
// This is intentionally a BROAD, approximate normalization, not a
// linguistically perfect one — e.g. the blanket `ß -> ss` and `ss -> s`
// collapse means a small number of unrelated words that happen to contain
// a literal "ue"/"oe"/"ae"/"ss" substring could also collapse together
// (a documented, accepted limitation of this simple approach — see this
// module's docstring and the final implementation report for the exact
// scope of what this helper covers vs. does not).

const COMBINING_MARKS_RE = /[̀-ͯ]/g

// Explicit fallback map — only used if String.prototype.normalize throws
// or is unavailable. Deliberately narrow (German + the handful of other
// Latin accented letters already seen in real production data) rather
// than attempting to replicate full NFD coverage by hand.
const FALLBACK_DIACRITIC_MAP = {
  ä: 'a', à: 'a', â: 'a', á: 'a', ã: 'a',
  ö: 'o', ò: 'o', ô: 'o', ó: 'o', õ: 'o',
  ü: 'u', ù: 'u', û: 'u', ú: 'u',
  é: 'e', è: 'e', ê: 'e', ë: 'e',
  ï: 'i', î: 'i', í: 'i', ì: 'i',
  ç: 'c', ñ: 'n',
}

function stripDiacriticsFallback(str) {
  return str.replace(/[äàâáãöòôóõüùûúéèêëïîíìçñ]/g, ch => FALLBACK_DIACRITIC_MAP[ch] ?? ch)
}

/**
 * normalizeSearchText(str)
 *
 * Lowercases, applies German transliteration equivalence (ß->ss,
 * ue/oe/ae -> u/o/a) BEFORE generic diacritic stripping — order matters:
 * doing the multi-character substitutions first means "Hueftgold"'s
 * "ue" collapses to "u" the same way "Hüftgold"'s ü (which NFD-strips to
 * plain "u") does, landing both on the identical "huftgold".
 *
 * @param {string|null|undefined} str
 * @returns {string} normalized, lowercased, diacritic-free text ('' for
 *   non-string input)
 */
export function normalizeSearchText(str) {
  if (typeof str !== 'string') return ''
  let s = str.toLowerCase()

  s = s
    .replace(/ß/g, 'ss')
    .replace(/ue/g, 'u')
    .replace(/oe/g, 'o')
    .replace(/ae/g, 'a')

  try {
    s = s.normalize('NFD').replace(COMBINING_MARKS_RE, '')
  } catch {
    s = stripDiacriticsFallback(s)
  }

  return s
}

/**
 * textIncludesNormalized(haystack, normalizedNeedle)
 *
 * @param {string|null|undefined} haystack  raw (un-normalized) text
 * @param {string} normalizedNeedle  already-normalized search text (pass
 *   the output of normalizeSearchText, not raw user input, to avoid
 *   re-normalizing it on every call in a hot loop)
 * @returns {boolean}
 */
export function textIncludesNormalized(haystack, normalizedNeedle) {
  if (!normalizedNeedle) return false
  if (typeof haystack !== 'string' || !haystack) return false
  return normalizeSearchText(haystack).includes(normalizedNeedle)
}
