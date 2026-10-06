-- Verification ownership for Destination Hub items. Additive. NOT applied yet.
-- Who is responsible for verifying an item. This is separate from visitor visibility: every approved item
-- stays in Nearby and the Hub regardless of owner. /{slug}/partners lists only 'business' owned items;
-- /{slug}/champion shows every item and lets a Champion or CheckOff admin assign the owner.
-- Items with no row (or a null owner) fall back to a code default (see lib/destinationPartnersStore.js defaultOwnerType).
alter table public.destination_item_decisions
  add column if not exists verification_owner_type text
    check (verification_owner_type in ('business','chamber','city','destination_partner','checkoff')),
  add column if not exists verification_owner_name text
    check (char_length(verification_owner_name) <= 120);
