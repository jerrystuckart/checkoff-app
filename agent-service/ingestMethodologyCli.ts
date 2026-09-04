#!/usr/bin/env node
// Chief Phase 2E — the exact command Jerry runs once per methodology
// (DVA-1, DVA-2, DAP) to ingest the real Claude Project instructions.
//
// Usage:
//   tsx agent-service/ingestMethodologyCli.ts <sourceFile> <methodologyId> <version> <providedBy> [--force]
//
// Example:
//   tsx agent-service/ingestMethodologyCli.ts ~/Downloads/dva1-instructions.md destination/dva1 v2 Jerry
//
// This copies the source file VERBATIM into
// agent-service/specialists/methodologies/<methodologyId>/<version>.md,
// prints its content hash, and prints the exact follow-up code change
// (methodologyRegistry.ts) needed to mark it complete — it never edits
// the registry itself, per the "deliberate, reviewed decision" discipline
// used everywhere else in this codebase (standingAuthority.ts etc).

import { ingestMethodology } from './specialists/methodologyIngestion'

function main() {
  const [sourceFilePath, methodologyId, version, providedBy, ...rest] = process.argv.slice(2)
  if (!sourceFilePath || !methodologyId || !version || !providedBy) {
    console.error('Usage: tsx agent-service/ingestMethodologyCli.ts <sourceFile> <methodologyId> <version> <providedBy> [--force]')
    process.exitCode = 1
    return
  }
  const force = rest.includes('--force')
  const report = ingestMethodology({ sourceFilePath, methodologyId, version, providedBy, force })
  console.log(JSON.stringify(report, null, 2))
}

main()
