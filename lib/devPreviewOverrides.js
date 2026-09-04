// LOCAL-ONLY, __DEV__-gated preview override for evaluating a mixed
// image/no-image What's Good state ("Final Local Visual Pass Before Build
// 143", 2026-09-03). Injects ONE synthetic preview item — never a real
// database row, never a migration, never a ranking/selection change — so
// we can visually compare an image-led primary card against real
// no-image secondary cards before deciding whether to pursue a real Red
// Zone Sports Grill partnership + photo upload.
//
// Two independent kill switches must both be true for this to render
// anything: __DEV__ (false in every release/production JS bundle, not
// something this file controls) AND DEV_PREVIEW_MIXED_IMAGE_STATE below
// (an explicit, manually-set local toggle). Flip the const back to false
// the moment visual evaluation is done — do not ship it on.
//
// Image source: a real Red Zone Sports Grill social-media photo (Jerry
// has owner approval to use it for this preview), bundled as a local
// asset at assets/dev-preview/red-zone-wings.png — never uploaded to
// Supabase Storage, never written to any items/partners row.

import { Image } from 'react-native'

const DEV_PREVIEW_MIXED_IMAGE_STATE = false

const resolvedPreviewImageUri = Image.resolveAssetSource(require('../assets/dev-preview/red-zone-wings.png'))?.uri ?? null

function buildRedZonePreviewItem(photoUrl) {
  return {
    id: '__dev_preview_red_zone_wings__',
    body: "Order the Wednesday wings at 'Red Zone Sports Grill'",
    is_universal: false,
    isUniversal: false,
    is_secret: false,
    isSecret: false,
    partnerName: 'Red Zone Sports Grill',
    categoryName: 'Bar & drinks',
    distM: 900,
    photo_url: photoUrl,
  }
}

/**
 * @param {object[]} items  whatsGood.items, already ranked/selected by
 *   the real orchestrator — this NEVER reorders or filters that array;
 *   in dev builds, with the flag on, and only once the local preview
 *   asset exists, it prepends one synthetic image-led item so What's
 *   Good renders 1 image-led + up to 2 real no-image cards for visual
 *   comparison. A no-op in every other case, including every production
 *   build.
 */
export function applyDevMixedImagePreview(items) {
  if (!__DEV__ || !DEV_PREVIEW_MIXED_IMAGE_STATE) return items
  if (!resolvedPreviewImageUri) return items
  const previewItem = buildRedZonePreviewItem(resolvedPreviewImageUri)
  return [previewItem, ...(items ?? [])].slice(0, 3)
}
