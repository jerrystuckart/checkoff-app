# Repeat recovery policy: existing behaviour and a proposal (not implemented)

Status: **proposal only.** Nothing here changes behaviour. No once-per-season rule has been introduced.

## Existing behaviour (verified 2026-09-30)
* **Live and list check-offs are repeatable per list instance.** `check_ins` is unique on `(user_id, list_item_id)`. Official/seasonal lists get a fresh `lists` row and fresh `list_items` rows each season (see `lib/checkOffAttachment.js`), so the same item can be completed again in a later season's list. The data shows it happens: of 315 user-items, **15** were completed again more than a day apart and **5** more than 30 days apart (all `is_recurring = true`; all via lists).
* **`items.is_recurring` is catalogue metadata.** No check-off code reads it. 1,167 active items are `is_recurring = true`, 851 are `false`.
* **Recovery (visit suggestion) is once per item, forever.** Confirming a suggestion writes a standalone item-level `check_ins` row (`list_item_id` NULL, `verification_method = 'historical_visit_confirmed'`). The database enforces: a unique index `(user_id, item_id)` for confirmed visits, and the 2026-09-24 duplicate-completion guard that rejects the confirm when **any** `check_ins` row exists for that user and item ("already done, by any means"). The inbox, the badges (`actionableCandidates.js`) and, since 20260930e, the server exit function apply the same rule, so a suggestion that could never be confirmed is not offered. It reads the current state: unchecking an item makes an unexpired suggestion reappear.
* **Manual and list check-offs of a recurring item are unaffected** by any of this.

## The gap
A person who completed "Sunset at X" last season and visits again this season gets **no recovery suggestion**, yet could legitimately check it off again in the new season's list by hand. Standalone experiences (not on any list, or on no current list) have no "new instance" to check off, so a repeat visit there has no path at all.

## Proposed policy (for a separate decision)
1. **Identify the completion instance, not the item.** A repeat is legitimate when the earlier completion belongs to a different *instance* of the experience: a previous season's `list_items` row, or (standalone experiences) an earlier period.
2. **Recurring items only** (`is_recurring = true`). One-time items (`is_recurring = false`) stay once-per-user.
3. **Suppress only when the current instance is already done.** For an item on a current official list: suppress iff the user's `list_items` row **in the current list** is checked. For a standalone recurring experience with no list instance: suppress iff a completion exists within a configured cooldown (proposal: 180 days, per-item override possible).
4. **Confirm path.** A recovered repeat must write an instance-level row (the current `list_item_id` when one exists; otherwise a standalone row with a `period` key) so the duplicate guard and the unique index become per instance/period rather than per item. Points follow the same per-instance rule the list check-off already uses; no extra points path.
5. **Wording.** The card says it is a repeat ("You checked this off on <date>; you were here again"), so nobody confirms by reflex.
6. **Safeguards unchanged:** opt-in, user confirmation, dismissal, 7-day expiry, daily cap, duplicate-pending.

## Work it would need
* DB: per-period uniqueness replacing `check_ins_one_confirmed_visit_per_item`; a `visit_item_completed(user, item, at)` helper used by the confirm trigger, `visit_presence_exit`, `visit_close_uncertain`, `visit_reevaluate_sessions` and the client rule (`actionableCandidates.js`) so they cannot drift apart; a check that proves equivalence (as `visit_confirmation_integrity.sql` does today).
* App: repeat wording; fan-out to the current list instance.
* Data: decide the cooldown and whether any `is_recurring` items should be non-repeatable.

## Decisions needed from product
Cooldown length for standalone recurring experiences; whether repeats earn full points; whether a repeat is allowed when the earlier completion was also a recovered visit.
