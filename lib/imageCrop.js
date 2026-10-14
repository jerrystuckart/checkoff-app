// Cover-crop placement with an adjustable focal point, for the Secret reveal background.
// React Native's resizeMode="cover" always centers; this lets an admin choose which part of
// the photo stays in view (focus 0..100 on each axis; 50/50 = center).
//
// Returns the size and offset to render the image at inside a box so that it covers the box
// and the point (fx%, fy%) of the image is as close to the box's same relative point as the
// overflow allows. Pure; no React.

export const DEFAULT_FOCUS = { x: 50, y: 35 } // bias slightly up: subjects usually sit above center

export function clampFocus(v, fallback) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(100, Math.max(0, n))
}

export function normalizeFocus(focus) {
  return {
    x: clampFocus(focus?.x, DEFAULT_FOCUS.x),
    y: clampFocus(focus?.y, DEFAULT_FOCUS.y),
  }
}

export function coverPlacement({ imgW, imgH, boxW, boxH, focus }) {
  if (!(imgW > 0 && imgH > 0 && boxW > 0 && boxH > 0)) return null
  const { x, y } = normalizeFocus(focus)
  const scale = Math.max(boxW / imgW, boxH / imgH)
  const width = imgW * scale
  const height = imgH * scale
  return {
    width,
    height,
    left: -(width - boxW) * (x / 100),
    top: -(height - boxH) * (y / 100),
  }
}
