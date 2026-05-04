-- Run this in Supabase Dashboard → SQL Editor
-- Adds Stripe billing columns to the partners table.
-- Safe to run multiple times (uses IF NOT EXISTS pattern).

ALTER TABLE partners
  ADD COLUMN IF NOT EXISTS stripe_customer_id     text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS billing_interval       text DEFAULT 'monthly'
    CHECK (billing_interval IN ('monthly', 'annual'));

-- Index for webhook lookups (subscription.deleted / updated)
CREATE UNIQUE INDEX IF NOT EXISTS partners_stripe_subscription_id_idx
  ON partners (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

-- Index for customer lookups
CREATE INDEX IF NOT EXISTS partners_stripe_customer_id_idx
  ON partners (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;
