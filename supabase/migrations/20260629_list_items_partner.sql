-- Add is_partner_item flag to list_items so partner-attributed items
-- can be identified and sorted to the top of creator lists.
ALTER TABLE list_items
ADD COLUMN IF NOT EXISTS is_partner_item boolean DEFAULT false;
