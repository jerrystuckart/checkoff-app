/**
 * fetchAllRows() — pages through a Supabase/PostgREST query instead of
 * accepting its default (and easily-forgotten) 1000-row response cap.
 *
 * Root cause this fixes (Vienna MORGEN bug, 2026-09-13): both
 * lib/useNearby.js's "All" candidate fetch and HomeScreen.jsx's Near-You
 * rail fetch queried `items` with no `.range()`/`.limit()` and no
 * `.order()` — a single unbounded `.select()` that PostgREST silently caps
 * at 1000 rows by default. Once the global eligible-items count crossed
 * that cap (confirmed: 1458 rows for the Nearby filter, 1465 for Home's,
 * with the reported Vienna item sitting around row ~1400), any item past
 * row 1000 in whatever order Postgres happened to return was silently
 * absent from the candidate set BEFORE distance was ever computed — not a
 * ranking bug, an exclusion bug. Tag/text search never hit this because
 * those paths query by a bounded `.in(id, [...])` list, never a full-table
 * scan — which is exactly why filtering by "breakfast" made the item
 * reappear while unfiltered Nearby/Home never fetched it at all.
 *
 * `buildQuery` must be a function that returns a FRESH PostgREST query
 * builder each call (so `.range()` can be applied per page) and MUST
 * already include a deterministic `.order(...)` — pagination without a
 * stable order can skip or duplicate rows across pages in Postgres.
 */
export async function fetchAllRows(buildQuery, { pageSize = 1000 } = {}) {
  let allRows = []
  let from = 0

  while (true) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1)
    if (error) {
      return { data: allRows.length ? allRows : null, error }
    }
    const rows = data ?? []
    allRows = allRows.concat(rows)
    if (rows.length < pageSize) break
    from += pageSize
  }

  return { data: allRows, error: null }
}
