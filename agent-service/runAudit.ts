#!/usr/bin/env node
// Developer-only CLI for the Phase 0E Chief Audit / Exception Report.
// Read-only — never opens a write transaction. `npm run agent:audit`.

import { getChiefAuditReport } from './audit'
import { renderChiefAuditReport } from './renderAudit'
import { closePool } from './db'

async function main(): Promise<void> {
  const report = await getChiefAuditReport()
  console.log(renderChiefAuditReport(report))
}

main()
  .catch((err) => {
    console.error('[agent-service/runAudit] failed:', err)
    process.exitCode = 1
  })
  .finally(() => {
    void closePool()
  })
