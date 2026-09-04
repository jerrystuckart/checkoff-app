#!/usr/bin/env node
// Phase 0G — READ-ONLY live connectivity verification for the real Open
// Brain MCP transport (openBrainMcpClient.ts). This is the only script in
// this repo permitted to make a real network call to Open Brain, and it
// calls exactly one tool: get_thought_by_source. It NEVER calls
// capture_thought — nothing here can write anything.
//
// Proves: OPEN_BRAIN_MCP_URL/OPEN_BRAIN_MCP_KEY are configured, the
// x-brain-key header auth actually works against the live server, the
// StreamableHTTPClientTransport connect->call->close cycle works
// end-to-end, and the known Phase 0F link (the widget_marketing_after_build
// decision <-> its backfilled Open Brain thought) is still resolvable by
// exact source identity.
//
// Usage:
//   npm run agent:verify:open-brain-live
//
// Requires AGENT_SERVICE_DATABASE_URL-style local env config: this repo's
// root .env is auto-loaded the same way agent-service/db.ts loads it (see
// that file) — this script does the same for OPEN_BRAIN_MCP_URL/
// OPEN_BRAIN_MCP_KEY, since they live in the same place.

import * as fs from 'fs'
import * as path from 'path'
import { getDefaultOpenBrainClient } from './openBrainClient'

function loadEnvFile(relPath: string): void {
  const envPath = path.join(__dirname, '..', relPath)
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = val
  }
}
loadEnvFile('.env')

// This script's whole purpose is a deliberate, read-only LIVE call to Open
// Brain — set the explicit opt-in getDefaultOpenBrainClient() requires
// before constructing a real client while running under Node's test
// runner (see openBrainClient.ts's module doc). This script isn't
// actually invoked via `node --test` (it's a plain `tsx` script, so
// NODE_TEST_CONTEXT is never set here regardless), but setting this
// explicitly — rather than relying on that absence — keeps the real
// gating signal self-documenting in the one file that's actually supposed
// to trip it, instead of an implicit "it just happens not to apply here."
process.env.AGENT_SERVICE_ALLOW_OPEN_BRAIN_LIVE_TEST = '1'

const SOURCE_SYSTEM = 'CheckOff Chief'
const SOURCE_IDENTITY = 'agent_decision:f2bda6d4-abb3-4106-bc56-3b53b0a680a3'
const EXPECTED_THOUGHT_ID = '589d06f9-b230-4ec0-bad2-62ee49350443'

async function main(): Promise<void> {
  const missing = [!process.env.OPEN_BRAIN_MCP_URL && 'OPEN_BRAIN_MCP_URL', !process.env.OPEN_BRAIN_MCP_KEY && 'OPEN_BRAIN_MCP_KEY'].filter(Boolean)
  if (missing.length > 0) {
    console.error(`Missing required environment variable(s): ${missing.join(', ')}`)
    console.error('Set them locally (e.g. in the repo root .env) and re-run — this script never prompts for or accepts a credential value directly.')
    process.exitCode = 1
    return
  }

  const client = getDefaultOpenBrainClient()

  console.log(`Calling get_thought_by_source("${SOURCE_SYSTEM}", "${SOURCE_IDENTITY}")...`)
  const thought = await client.getThoughtBySource(SOURCE_SYSTEM, SOURCE_IDENTITY)

  if (!thought) {
    console.error('FAIL — get_thought_by_source returned null (not found). Expected the known Phase 0F backfilled thought.')
    process.exitCode = 1
    return
  }

  console.log(`Returned thought id: ${thought.id}`)

  if (thought.id !== EXPECTED_THOUGHT_ID) {
    console.error(`FAIL — expected thought id ${EXPECTED_THOUGHT_ID}, got ${thought.id}`)
    process.exitCode = 1
    return
  }

  console.log('PASS — exact source-identity lookup returned the expected thought id.')
  console.log('No capture_thought call was made. This script performed a read-only verification only.')
}

main().catch((err) => {
  console.error('[agent-service/verifyOpenBrainLive] failed:', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
