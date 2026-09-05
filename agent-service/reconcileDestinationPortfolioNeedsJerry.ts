#!/usr/bin/env node
// Chief Phase 2M — the one operational consequence of the real Willcox
// forwarded-message proof (see supabase/migrations/20260905_agent_destination_portfolio_backfill.sql
// for the per-destination project/contact/interaction backfill this
// depends on). Re-running the inbound-association pipeline against the
// backfilled contact directory correctly associates Gmail message
// 1a071eba028425e5 to destination-willcox/Desiree Gerth with high
// confidence, but the destination_relationship playbook driver rejects
// it (`No relationship run for project destination-willcox`) because no
// driver-managed relationship lifecycle has ever been started for
// Willcox — it predates Phase 2I entirely. That rejection is honest, not
// a bug: no synthetic run is fabricated here to paper over it.
//
// What IS a genuine, verifiable operational fact from the message itself:
// Desiree is asking Jerry to confirm previously-proposed pricing before
// the Willcox Chamber board votes on adopting CheckOff this Thursday —
// a real, time-sensitive decision only Jerry can make (pricing/commitment
// responses are APPROVAL_REQUIRED per standingAuthority.ts regardless).
// This script creates exactly one NEEDS_JERRY task capturing that,
// idempotent via (source_type, source_ref) keyed to the real Gmail
// message id — safe to re-run, never duplicates.
//
// `npx tsx agent-service/reconcileDestinationPortfolioNeedsJerry.ts`

import { closePool } from './db'
import { createTask } from './mutations'
import { getDestinationContactEmails } from './queries'

const ACTOR = 'chief'
const SOURCE_TYPE = 'gmail_forwarded_message_reclassification'
const SOURCE_REF = 'gmail:1a071eba028425e5'
const DESIREE_EMAIL = 'dez@strivevineyards.com'

async function main(): Promise<void> {
  const legacyContacts = await getDestinationContactEmails()
  const desiree = legacyContacts.find((c) => c.email.toLowerCase() === DESIREE_EMAIL && c.projectKey === 'destination-willcox')
  if (!desiree) {
    throw new Error(`Expected the backfilled Desiree Gerth contact (${DESIREE_EMAIL}) linked to destination-willcox via agent.interactions — run the Phase 2M migration first.`)
  }

  const result = await createTask({
    title: 'Willcox — confirm pricing with Desiree before Thursday Chamber board vote',
    projectKey: 'destination-willcox',
    status: 'NEEDS_JERRY',
    changedByOwnerKey: ACTOR,
    ownerKey: ACTOR,
    contactId: desiree.contactId,
    description:
      'Desiree Gerth (Strive Vineyards) wrote ahead of the Willcox Chamber board meeting to confirm the pricing Jerry ' +
      'had already proposed (Willcox Destination Champion $5,200/12mo; Additional Destination Partners $1,000 each/12mo) ' +
      'before the board votes on adopting CheckOff. Recovered from a forwarded message (transport sender ' +
      'forwarder@getcheckoff.com, original sender dez@strivevineyards.com via Reply-To) — see agent.interactions ' +
      "(source_ref='gmail:1a071eba028425e5') for the full evidence record.",
    jerryRequest: 'Confirm the proposed Willcox pricing with Desiree (and answer any questions/clarifications) before the Chamber board meeting this Thursday.',
    nextAction: 'Jerry responds to Desiree directly — Chief does not send pricing/commitment communications unilaterally (APPROVAL_REQUIRED).',
    sourceType: SOURCE_TYPE,
    sourceRef: SOURCE_REF,
  })
  console.log(`[reconcile] Willcox NEEDS_JERRY task: ${result.created ? 'created' : 'already existed'} (task ${result.task.id})`)
}

main()
  .catch((err) => {
    console.error('[agent-service/reconcileDestinationPortfolioNeedsJerry] failed:', err)
    process.exitCode = 1
  })
  .finally(() => {
    void closePool()
  })
