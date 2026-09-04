// Phase 0E — deterministic text renderer for a ChiefAuditReport. No LLM,
// no free-form generation: every line is template-built from the report's
// own already-deterministic fields. Given the same report object, this
// always produces byte-identical output (see audit.test.ts's renderer
// snapshot test).

import type { AuditFinding, ChiefAuditReport } from './auditTypes'

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function findingLine(f: AuditFinding): string {
  const where = f.project?.key ?? f.project?.title ?? null
  const prefix = where ? `[${where}] ` : ''
  return `  ${f.severity.padEnd(8)} ${f.code.padEnd(28)} ${prefix}${f.message}`
}

export function renderChiefAuditReport(report: ChiefAuditReport): string {
  const s = report.summary
  const lines: string[] = []

  lines.push(`CHIEF AUDIT — ${formatDate(report.generatedAt)}`)
  lines.push('')

  lines.push('ATTENTION')
  lines.push(`${s.attentionByCode.WAITING_DUE_FOR_CHECK ?? 0} follow-up(s) due for check`)
  lines.push(`${s.attentionByCode.TASK_READY ?? 0} ready task(s)`)
  lines.push(`${s.attentionByCode.TASK_BLOCKED ?? 0} blocked task(s)`)
  lines.push(`${s.attentionByCode.TASK_NEEDS_JERRY ?? 0} needs Jerry`)
  lines.push(`${s.attentionByCode.TASK_OVERDUE ?? 0} overdue`)
  lines.push(`(${s.uniqueTasksNeedingAttention} unique task(s), ${s.attentionFindingCount} finding(s) total)`)
  lines.push('')

  lines.push('EXCEPTIONS')
  if (report.exceptions.length === 0) {
    lines.push('  none')
  } else {
    for (const f of report.exceptions) lines.push(findingLine(f))
  }
  lines.push('')

  lines.push('PROJECT HEALTH')
  if (report.projectHealth.length === 0) {
    lines.push('  none')
  } else {
    for (const ph of report.projectHealth) {
      const c = ph.counts
      const flags = ph.flags.length > 0 ? ` [flags: ${ph.flags.join(', ')}]` : ''
      lines.push(
        `  ${ph.project.key}: open=${c.open} ready=${c.ready} inProgress=${c.inProgress} waiting=${c.waiting} ` +
          `blocked=${c.blocked} needsJerry=${c.needsJerry} overdue=${c.overdue} dueForCheck=${c.dueForCheck}${flags}`
      )
    }
  }

  return lines.join('\n')
}
