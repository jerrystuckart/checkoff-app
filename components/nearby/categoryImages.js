// Nearby category rail metadata (1.1.10). One entry per category:
// { id, label, image, accent, zoom? }. To ship final art, overwrite the matching
// PNG in assets/nearby-categories/ (square, ~512px) — no code change needed.
//
// Optional `zoom` (>1) scales the photo inside the circle, for art that has
// its own ring/border baked in (misc, travel) so the app's ring isn't doubled.
//
// Live categories come from the DB (admin-managed), so lookup is by
// normalized name; an unmapped category falls back to the legacy icon tile.

export const CATEGORY_IMAGES = [
  { id: 'adventure',     label: 'Adventure',       image: require('../../assets/nearby-categories/adventure.png'),     accent: '#E8833A' },
  { id: 'arts-culture',  label: 'Arts & Culture',  image: require('../../assets/nearby-categories/arts-culture.png'),  accent: '#B05FD6' },
  { id: 'bar-drinks',    label: 'Bar & drinks',    image: require('../../assets/nearby-categories/bar-drinks.png'),    accent: '#E0457B' },
  { id: 'food-drink',    label: 'Food & drink',    image: require('../../assets/nearby-categories/food-drink.png'),    accent: '#E5A52E' },
  { id: 'misc',          label: 'Misc',            image: require('../../assets/nearby-categories/misc.png'),          accent: '#4FB3A9', zoom: 1.14 },
  { id: 'nightlife',     label: 'Nightlife',       image: require('../../assets/nearby-categories/nightlife.png'),     accent: '#6C5CE7' },
  { id: 'play',          label: 'Play',            image: require('../../assets/nearby-categories/play.png'),          accent: '#3DB2F2' },
  { id: 'shopping',      label: 'Shopping',        image: require('../../assets/nearby-categories/shopping.png'),      accent: '#F06A8E' },
  { id: 'social',        label: 'Social',          image: require('../../assets/nearby-categories/social.png'),        accent: '#F2B84B' },
  { id: 'spa-self-care', label: 'Spa & Self-Care', image: require('../../assets/nearby-categories/spa-self-care.png'), accent: '#6FCFA0' },
  { id: 'sports',        label: 'Sports',          image: require('../../assets/nearby-categories/sports.png'),        accent: '#4C9F38' },
  { id: 'travel',        label: 'Travel',          image: require('../../assets/nearby-categories/travel.png'),        accent: '#2F80ED', zoom: 1.14 },
]

const normalize = s => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
const BY_KEY = Object.fromEntries(CATEGORY_IMAGES.map(c => [normalize(c.label), c]))

/** @returns {{id,label,image,accent}|null} */
export function resolveCategoryImage(categoryName) {
  return BY_KEY[normalize(categoryName)] ?? null
}
