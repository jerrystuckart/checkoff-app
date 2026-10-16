// Which neighborhoods the post-check-off "also here / nearest next" suggestions may come from.
// Regular metros: every neighborhood of the checked item's metro (unchanged). Destination Hubs such as Willcox have a neighborhood with
// NO metro (neighborhoods.metro_id is null), which used to skip the suggestions entirely; there the pool is the item's own neighborhood.
// Pure, no React Native.
export function candidateNeighborhoodIds({ metroId, metroNeighborhoodIds, neighborhoodId }) {
  if (metroId) return Array.isArray(metroNeighborhoodIds) ? metroNeighborhoodIds : []
  return neighborhoodId ? [neighborhoodId] : []
}
