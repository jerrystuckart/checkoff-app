# Admin tool changes — curated list metro overlay

For `checkoff_admin.html` (outside this repo). Written as a standalone deliverable per
the mission brief — I have incidental access to this file from an unrelated earlier
task in this session, but Phase 5 explicitly asked for a drop-in deliverable rather
than direct edits, so that's what this is. All snippets use the file's existing
`api()` helper (service-role key, already bypasses RLS — no new auth pattern).

## Constant — add once, near the top of the script

```js
const METRO_SLUGS = [
  { slug: 'phoenix',   label: 'Phoenix' },
  { slug: 'milwaukee', label: 'Milwaukee' },
  { slug: 'tucson',    label: 'Tucson' },
  // add future metros here — both dropdowns below read from this list
]
```

## 1. Per-item-row metro dropdown → `curated_list_items.city_slug`

Drop into whatever row-renderer currently lists a curated list's items (each item row
needs its `curated_list_items.id`, not just `item_id`):

```js
function renderItemCitySlugDropdown(cliId, currentSlug) {
  const options = [`<option value="">Universal</option>`]
    .concat(METRO_SLUGS.map(m =>
      `<option value="${m.slug}" ${currentSlug === m.slug ? 'selected' : ''}>${m.label}</option>`
    )).join('')
  return `<select onchange="setItemCitySlug('${cliId}', this.value)" style="font-size:11px;padding:2px 6px;border-radius:6px">${options}</select>`
}

async function setItemCitySlug(cliId, slug) {
  try {
    await api(`curated_list_items?id=eq.${cliId}`, {
      method: 'PATCH',
      body: JSON.stringify({ city_slug: slug || null }),
    })
    toast('Updated', 'success')
  } catch (e) {
    toast('Failed to update: ' + e.message, 'error')
  }
}
```

Wire `renderItemCitySlugDropdown(item.id, item.city_slug)` into each item row's markup.

## 2. List-level metro visibility — multi-select checkboxes → `curated_list_metros`

Load existing rows when opening a list for editing:

```js
async function loadListMetros(curatedListId) {
  const rows = await api(`curated_list_metros?curated_list_id=eq.${curatedListId}&select=city_slug`)
  return new Set((rows ?? []).map(r => r.city_slug))
}

function renderMetroCheckboxes(currentSlugs) {
  return METRO_SLUGS.map(m => `
    <label style="display:flex;align-items:center;gap:6px;font-size:12px;margin-bottom:4px">
      <input type="checkbox" id="metro-${m.slug}" ${currentSlugs.has(m.slug) ? 'checked' : ''}>
      ${m.label}
    </label>
  `).join('') + `<div style="font-size:11px;color:#7a7870;margin-top:6px">No boxes checked = universal, visible everywhere.</div>`
}
```

Save on submit — diff against what's currently in the DB, insert the newly-checked,
delete the newly-unchecked:

```js
async function saveListMetros(curatedListId, previousSlugs) {
  const nowChecked = new Set(
    METRO_SLUGS.filter(m => document.getElementById(`metro-${m.slug}`)?.checked).map(m => m.slug)
  )
  const toAdd    = [...nowChecked].filter(s => !previousSlugs.has(s))
  const toRemove = [...previousSlugs].filter(s => !nowChecked.has(s))

  if (toAdd.length) {
    await api('curated_list_metros', {
      method: 'POST',
      body: JSON.stringify(toAdd.map(slug => ({ curated_list_id: curatedListId, city_slug: slug }))),
    })
  }
  for (const slug of toRemove) {
    await api(`curated_list_metros?curated_list_id=eq.${curatedListId}&city_slug=eq.${slug}`, {
      method: 'DELETE',
    })
  }
}
```

**Flagging the exception explicitly, per the mission brief: this is the one place in
the curated-list editor that does a hard `DELETE`, not a soft-deactivate.**
`curated_list_metros` is pure visibility config, not history — a removed row just
means "this list is no longer scoped to that metro," there's nothing to preserve.
Everywhere else (items, lists) stays soft-deactivate only. Please confirm this
reasoning holds before wiring the delete call in — it's the one deviation from the
"never hard-delete" rule everywhere else in this project, and I'd rather you sign off
on it explicitly than have it slip in as a side effect of a generic save function.

## 3. "Preview as metro" dropdown — filtered item count

Add to the list editor's toolbar:

```js
function renderPreviewMetroDropdown(selected) {
  const options = [`<option value="">All metros (universal only)</option>`]
    .concat(METRO_SLUGS.map(m =>
      `<option value="${m.slug}" ${selected === m.slug ? 'selected' : ''}>Preview as ${m.label}</option>`
    )).join('')
  return `<select onchange="previewAsMetro(this.value)">${options}</select>`
}

async function previewAsMetro(citySlug) {
  const items = await api(`curated_list_items?curated_list_id=eq.${currentCuratedListId}&select=id,city_slug`)
  const visible = (items ?? []).filter(i => i.city_slug === null || i.city_slug === citySlug)
  document.getElementById('preview-count').textContent =
    `${visible.length} of ${items.length} items visible` + (citySlug ? ` in ${citySlug}` : ' (universal only)')
}
```

This mirrors the exact same filter rule the app now uses in
`fetchCuratedListItems()` (`lib/useItems.js`) — universal (`city_slug IS NULL`) always
counts, metro-specific only counts when it matches the selected preview metro. No
metro selected = "universal only," matching what a Tucson or no-metro user
currently sees.

## 4. Destinations tab

Untouched — this deliverable only concerns the curated-list editor. Nothing here
should touch the Destinations tab or the `destListEngagement` / `curated_list_metros`
usage added there in the earlier engagement-visibility work (that usage is read-only
and for a completely different set of lists — Willcox-style destination lists, not
these Phoenix/Milwaukee merges).
