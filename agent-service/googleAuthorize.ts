// Chief Phase 2J — the one-time operator authorization flow (spec
// section 4). Run ONCE by Jerry, locally: `tsx agent-service/googleAuthorize.ts`.
// Obtains a refresh token so Chief can maintain Google API access
// unattended thereafter — Jerry never pastes a raw access token again.
//
// Prerequisites (outside this script's scope — a one-time Google Cloud
// Console setup): an OAuth 2.0 Client ID ("Desktop app" or "Web
// application" type, with http://localhost:<port>/oauth2callback added
// as an authorized redirect URI) created in the SAME Google Cloud
// project/account CheckOff uses. GOOGLE_CLIENT_ID and
// GOOGLE_CLIENT_SECRET must already be in .env before running this.
//
// What this script does:
//   1. Prints the Google authorization URL (buildAuthorizationUrl below)
//      for Jerry to open — he logs into the Google account CheckOff
//      should act as, and grants ONLY the scopes in GOOGLE_OAUTH_SCOPES.
//   2. Starts a local HTTP server on the redirect port to catch the
//      `?code=...` callback — nothing is exposed beyond localhost.
//   3. Exchanges that code for tokens (exchangeCodeForTokens below).
//   4. Prints the refresh token ONCE, to Jerry's own terminal — never to
//      a log file, never persisted by this script itself — with
//      instructions to put it in .env (already gitignored) as
//      GOOGLE_REFRESH_TOKEN. This is the one deliberate, interactive,
//      local-only exception to "never print secrets" — the same way
//      `gh auth login`/`gcloud auth login` surface a token once for the
//      operator to store themselves.
//
// After this: GoogleCredentialProvider (googleCredentialProvider.ts)
// reads GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REFRESH_TOKEN and
// refreshes access tokens automatically — this script never runs again
// unless authorization is revoked.

import { createServer } from 'node:http'
import { GOOGLE_OAUTH_SCOPES } from './specialists/googleCredentialProvider'

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

export function buildAuthorizationUrl(clientId: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_OAUTH_SCOPES.join(' '),
    access_type: 'offline', // required to receive a refresh token
    prompt: 'consent', // forces a refresh token even on a re-authorization
  })
  return `${AUTH_ENDPOINT}?${params.toString()}`
}

export interface ExchangedTokens {
  accessToken: string
  refreshToken: string | null
  expiresInSeconds: number
}

/**
 * Exchanges an authorization code for tokens. refreshToken is null if
 * Google didn't return one (e.g. re-consent without access_type=offline)
 * — the caller must tell Jerry to re-run with a fresh consent in that
 * case, never fabricate one.
 */
export async function exchangeCodeForTokens(params: { code: string; clientId: string; clientSecret: string; redirectUri: string; fetchImpl?: typeof fetch }): Promise<ExchangedTokens> {
  const fetchImpl = params.fetchImpl ?? fetch
  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: params.code, client_id: params.clientId, client_secret: params.clientSecret, redirect_uri: params.redirectUri, grant_type: 'authorization_code' }).toString(),
  })
  if (!response.ok) {
    const errText = await response.text().catch(() => '<no body>') // Google's own error body — never echoes the client secret we sent
    throw new Error(`Google code exchange failed (${response.status}): ${errText}`)
  }
  const json = (await response.json()) as { access_token: string; refresh_token?: string; expires_in: number }
  return { accessToken: json.access_token, refreshToken: json.refresh_token ?? null, expiresInSeconds: json.expires_in }
}

async function main() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    console.error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env before running this script.')
    console.error('Create an OAuth 2.0 Client ID in Google Cloud Console first (Desktop app or Web application type).')
    process.exitCode = 1
    return
  }

  const port = Number(process.env.GOOGLE_OAUTH_CALLBACK_PORT ?? 8721)
  const redirectUri = `http://localhost:${port}/oauth2callback`

  console.log('\nOpen this URL in the browser signed into the Google account CheckOff should use:\n')
  console.log(buildAuthorizationUrl(clientId, redirectUri))
  console.log(`\nWaiting for the redirect back to ${redirectUri} ...\n`)

  const code = await new Promise<string>((resolvePromise, rejectPromise) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`)
      if (url.pathname !== '/oauth2callback') {
        res.writeHead(404).end()
        return
      }
      const authCode = url.searchParams.get('code')
      const error = url.searchParams.get('error')
      res.writeHead(200, { 'content-type': 'text/plain' }).end(error ? 'Authorization failed — you can close this tab.' : 'Authorization received — you can close this tab and return to the terminal.')
      server.close()
      if (error) rejectPromise(new Error(`Google returned an authorization error: ${error}`))
      else if (authCode) resolvePromise(authCode)
      else rejectPromise(new Error('No authorization code in the callback.'))
    })
    server.listen(port)
  })

  const tokens = await exchangeCodeForTokens({ code, clientId, clientSecret, redirectUri })
  if (!tokens.refreshToken) {
    console.error('\nGoogle did not return a refresh token (this can happen on a repeat consent). Revoke CheckOff\'s access at https://myaccount.google.com/permissions and re-run this script.')
    process.exitCode = 1
    return
  }

  console.log('\nAuthorization complete. Add this ONE line to your .env (already gitignored) — this is the only time it will be shown:\n')
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refreshToken}\n`)
  console.log('Chief will refresh access tokens automatically from here on — you should not need to run this again unless you revoke access.')
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Authorization failed:', err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  })
}
