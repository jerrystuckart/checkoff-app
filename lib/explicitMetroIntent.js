// Explicit browsing-context intent set by a link (email, shared link) that names a metro, an item or a list.
//
// Precedence for "which metro is Home showing":
//   1. an explicit link intent (this module)            newest explicit action wins
//   2. a manual Switch City choice (HomeScreen.switchMetro clears this intent, so it wins if it is newer)
//   3. the persisted choice (AsyncStorage checkoff_selected_metro_slug)
//   4. current location / nearest metro
//   5. needs_selection (the city picker prompt)
// Current physical location never overrides an explicit link intent.
//
// The intent is IN MEMORY ONLY. It lasts for the app session. It is not written to AsyncStorage, so a link
// never redefines the persisted choice: the next cold start resolves exactly as it did before the link.
//
// Pure JS (no React Native), so it loads under plain `node --test`.

let current = null
const listeners = new Set()

function notify() {
  for (const fn of [...listeners]) {
    try { fn(current) } catch { /* a bad listener must not break navigation */ }
  }
}

export function setExplicitMetro(metro, source = 'link') {
  if (!metro || !(metro.id || metro.slug)) return null
  const next = { id: metro.id ?? null, slug: metro.slug ? String(metro.slug).toLowerCase() : null, name: metro.name ?? null, source, at: Date.now() }
  const same = current && current.id === next.id && current.slug === next.slug
  current = next
  if (!same) notify()
  else notify() // re-notify so a screen that mounted after the first set still applies it
  return current
}

export function getExplicitMetro() {
  return current
}

export function clearExplicitMetro(reason = 'manual') {
  if (!current) return
  current = null
  notify(reason)
}

export function subscribeExplicitMetro(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// Find the metro (from a list of active metros) an intent refers to.
export function metroForIntent(intent, metros) {
  if (!intent) return null
  const list = metros ?? []
  return list.find((m) => intent.id && m.id === intent.id)
    ?? list.find((m) => intent.slug && (m.slug ?? '').toLowerCase() === intent.slug)
    ?? null
}

// Test helper only.
export function __resetExplicitMetroForTests() {
  current = null
  listeners.clear()
}
