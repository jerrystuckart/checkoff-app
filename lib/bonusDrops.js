import { supabase } from './supabase'

/**
 * filterMaskedBonusDrops(items, userId)
 *
 * Bonus Drop items (list_items.is_bonus_drop) must stay masked on general
 * proximity/browse surfaces — Home's "Near you right now" rail, Nearby,
 * Discover, and PostCheckoffSheet's Also Here/Nearest Next — until the
 * viewing user has actually checked that item off. This is unrelated to a
 * given list's own unlock threshold (see ListScreen's computeBonusDropUnlocked);
 * it exists purely to stop a locked drop's real body/hook from leaking to
 * someone browsing outside the list it belongs to. Once checked, per the
 * spec, it behaves as a completely normal item everywhere — this filter
 * naturally stops applying to it, no separate "unmask" step needed.
 *
 * `items` must have an `id` field matching items.id (every call site here
 * already does).
 *
 * Fails open (returns items unfiltered) on any query error — a rare,
 * temporary early reveal of a themed teaser is a far smaller problem than
 * breaking Nearby/Discover/Home entirely.
 */
export async function filterMaskedBonusDrops(items, userId) {
  if (!items?.length) return items ?? []
  try {
    const { data: dropRows } = await supabase
      .from('list_items')
      .select('item_id')
      .eq('is_bonus_drop', true)
    const dropIds = new Set((dropRows ?? []).map(r => r.item_id).filter(Boolean))
    if (!dropIds.size) return items

    let checkedDropIds = new Set()
    if (userId) {
      const { data: checkedRows } = await supabase
        .from('check_ins')
        .select('item_id')
        .eq('user_id', userId)
        .in('item_id', [...dropIds])
      checkedDropIds = new Set((checkedRows ?? []).map(r => r.item_id))
    }

    return items.filter(item => !dropIds.has(item.id) || checkedDropIds.has(item.id))
  } catch {
    return items
  }
}
