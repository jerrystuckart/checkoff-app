// Extracted verbatim from screens/HomeScreen.jsx so the Destination Hub
// location section hands ItemDetail the identical item shape Home does.
// Pure — no imports.

// Flattens a raw items-table row into the same shape ItemDetailScreen
// reads from every other entry point (useItems.js / DiscoverScreen.jsx's
// augmentWithDistance) — camelCase fields ItemDetailScreen reads directly
// (categoryName, photoRequired, isSecret, allowsPersonalNote, ...), not
// just the raw snake_case columns. Rail items must be shape-complete
// before reaching the detail screen, not just column-complete — several
// of ItemDetailScreen's reads have no snake_case fallback.
export function mapRailItem(item) {
  return {
    id:                  item.id,
    body:                item.body,
    checkin_type:        item.checkin_type,
    checkinType:         item.checkin_type,
    is_universal:        item.is_universal ?? false,
    isUniversal:         item.is_universal ?? false,
    difficulty:          item.difficulty ?? 1,
    photo_required:      item.photo_required ?? false,
    photoRequired:       item.photo_required ?? false,
    maps_lat:            item.maps_lat ?? null,
    maps_lng:            item.maps_lng ?? null,
    geo_radius_m:        item.geo_radius_m ?? null,
    is_secret:           item.is_secret ?? false,
    isSecret:            item.is_secret ?? false,
    secret_reveal_text:  item.secret_reveal_text ?? null,
    website_url:         item.website_url ?? null,
    maps_query:          item.maps_query ?? null,
    partner_id:          item.partner_id ?? null,
    partnerName:         item.partners?.business_name ?? null,
    // 2026 redesign image audit: neither items nor partners currently has
    // photo_url populated for any live row (0/4 partners as of this
    // audit) — this field exists so the new home/*.jsx card components
    // have a real path forward the moment photos are added, without
    // another data-plumbing change. Every card gracefully falls back to a
    // solid-color initial glyph when this is null (see
    // components/home/WhatsGoodDiscovery.jsx).
    photo_url:           item.partners?.photo_url ?? null,
    // Community Cover Photos V1 — the item's admin-selected cover, if any
    // (see lib/coverCandidates.js's resolveActiveCoverUrl). Resolved to a
    // real signed activeCoverImageUrl just below, in resolveActiveCoverImages
    // — this raw id is the input to that resolution, not consumed directly
    // by any card component.
    activeCoverCandidateId: item.active_cover_candidate_id ?? null,
    has_alcohol:         item.has_alcohol ?? false,
    season_tag:          item.season_tag ?? null,
    allowsPersonalNote:  item.allows_personal_note ?? false,
    personalPromptLabel: item.personal_prompt_label ?? null,
    personalPlaceLabel:  item.personal_place_label ?? null,
    categoryName:        item.categories?.name ?? 'Misc',
    categoryColor:       item.categories?.color_hex ?? '#888780',
    neighborhoodId:      item.neighborhoods?.id ?? null,
    neighborhoodName:    item.neighborhoods?.name ?? null,
    // Archetype Fallback Artwork V1 (2026-09-17) — optional per-item
    // override consumed by lib/fallbackArtSource.js's resolver (see
    // components/home/useCardArtwork.js). Snake->camel mapping mirrors
    // every other field in this function; null is the common case and
    // means "use the category default archetype."
    fallbackArtKey:      item.fallback_art_key ?? null,
  }
}
