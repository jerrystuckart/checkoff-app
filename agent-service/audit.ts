// Phase 0E — the only DB-touching part of the audit layer. Fetches
// current state via the existing Phase 0C read functions (read-only —
// see db.ts; getChiefAuditReport never opens a write transaction) and
// hands it to the pure computation in auditRules.ts. Kept deliberately
// thin: all the actual anomaly logic lives in auditRules.ts so it can be
// unit-tested without a database.

import { getProjects, getAllTasks } from './queries'
import { computeChiefAuditReport } from './auditRules'
import type { ChiefAuditReport, ChiefAuditOptions } from './auditTypes'

export async function getChiefAuditReport(options: ChiefAuditOptions = {}): Promise<ChiefAuditReport> {
  const [projects, tasks] = await Promise.all([getProjects(), getAllTasks()])
  return computeChiefAuditReport(projects, tasks, options)
}

export * from './auditTypes'
export {
  computeChiefAuditReport,
  computeAttentionFindings,
  computeExceptionFindings,
  computeBlockerCycles,
  computeProjectHealth,
  compareFindings,
} from './auditRules'
