// Chief Phase 2J — a proper OAuth credential lifecycle for Google APIs.
// Phase 2I's adapters read a single static GOOGLE_OAUTH_ACCESS_TOKEN —
// real for a scripted proof, but useless for a Chief that must operate
// unattended for days/weeks: access tokens expire in about an hour.
// This provider is the ONE place refresh logic lives; Gmail/Calendar/
// Contacts adapters ask it for a token rather than each reimplementing
// the refresh dance.
//
// SECURITY: this module never logs or includes the client secret or
// refresh token in any thrown error or return value — only Google's own
// (secret-free) error response body, when refresh fails.

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
/** Refresh this many ms before actual expiry — never cut it so close that an in-flight adapter call gets a token that expires mid-request. */
const REFRESH_SKEW_MS = 60_000

export class GoogleAuthNotConfiguredError extends Error {
  constructor() {
    super('Google OAuth is not configured — GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN must all be set. Run the one-time authorization flow (agent-service/googleAuthorize.ts) to obtain a refresh token.')
    this.name = this.constructor.name
  }
}

/** Thrown specifically when Google's token endpoint reports the refresh token itself is bad (revoked, expired, or the wrong client) — distinct from a transient network/5xx failure, since this one needs Jerry to re-run the authorization flow, not a retry. */
export class GoogleAuthRevokedError extends Error {
  constructor(detail: string) {
    super(`Google refresh token was rejected — authorization has likely been revoked or expired. Re-run the one-time authorization flow (agent-service/googleAuthorize.ts). Google said: ${detail}`)
    this.name = this.constructor.name
  }
}

export interface GoogleCredentialConfig {
  clientId?: string
  clientSecret?: string
  refreshToken?: string
  fetchImpl?: typeof fetch
  /**
   * Called after a successful refresh with ONLY the new expiry — never
   * the access token, client secret, or refresh token itself. Exists so
   * a caller can persist non-secret token metadata (e.g. "last refreshed
   * at") if useful; entirely optional, no-op by default.
   */
  onTokenRefreshed?: (info: { expiresAtIso: string }) => void | Promise<void>
}

interface GoogleTokenResponse {
  access_token: string
  expires_in: number
  token_type?: string
  scope?: string
}

/**
 * `GoogleCredentialProvider.getAccessToken()`:
 *   - returns the cached token if it's still valid (with a safety skew)
 *   - refreshes via the OAuth refresh_token grant if expired/near expiry
 *   - throws GoogleAuthNotConfiguredError if no credentials are set
 *   - throws GoogleAuthRevokedError if Google rejects the refresh token
 * Never duplicated in each adapter — Gmail/Calendar/Contacts all share
 * one instance (or one each, constructed the same way; the provider
 * itself is stateless aside from its own token cache).
 */
export class GoogleCredentialProvider {
  private readonly clientId: string | undefined
  private readonly clientSecret: string | undefined
  private readonly refreshToken: string | undefined
  private readonly fetchImpl: typeof fetch
  private readonly onTokenRefreshed: GoogleCredentialConfig['onTokenRefreshed']

  private cachedAccessToken: string | null = null
  private cachedExpiresAtMs: number | null = null
  /** Coalesces concurrent getAccessToken() calls during a refresh into one actual HTTP request. */
  private refreshInFlight: Promise<string> | null = null

  constructor(config: GoogleCredentialConfig = {}) {
    this.clientId = config.clientId ?? process.env.GOOGLE_CLIENT_ID
    this.clientSecret = config.clientSecret ?? process.env.GOOGLE_CLIENT_SECRET
    this.refreshToken = config.refreshToken ?? process.env.GOOGLE_REFRESH_TOKEN
    this.fetchImpl = config.fetchImpl ?? fetch
    this.onTokenRefreshed = config.onTokenRefreshed
  }

  isConfigured(): boolean {
    return !!(this.clientId && this.clientSecret && this.refreshToken)
  }

  async getAccessToken(now: () => number = Date.now): Promise<string> {
    if (!this.isConfigured()) throw new GoogleAuthNotConfiguredError()
    const nowMs = now()
    if (this.cachedAccessToken && this.cachedExpiresAtMs !== null && nowMs < this.cachedExpiresAtMs - REFRESH_SKEW_MS) {
      return this.cachedAccessToken
    }
    if (this.refreshInFlight) return this.refreshInFlight
    this.refreshInFlight = this.refresh(nowMs).finally(() => {
      this.refreshInFlight = null
    })
    return this.refreshInFlight
  }

  private async refresh(nowMs: number): Promise<string> {
    const response = await this.fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.clientId!, client_secret: this.clientSecret!, refresh_token: this.refreshToken!, grant_type: 'refresh_token' }).toString(),
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '<no body>') // Google's own error body — never echoes the secret/refresh token we sent
      if (response.status === 400 || response.status === 401) throw new GoogleAuthRevokedError(`${response.status}: ${errText}`)
      throw new Error(`Google token refresh failed with an unexpected status ${response.status}: ${errText}`)
    }

    const json = (await response.json()) as GoogleTokenResponse
    this.cachedAccessToken = json.access_token
    this.cachedExpiresAtMs = nowMs + json.expires_in * 1000
    await this.onTokenRefreshed?.({ expiresAtIso: new Date(this.cachedExpiresAtMs).toISOString() })
    return this.cachedAccessToken
  }
}

/**
 * The minimum Google API scopes Chief actually needs for its current
 * capabilities — never Drive, never broad account access. Each scope
 * maps to exactly one capability already built:
 *   gmail.readonly  — search/read (RealGmailAdapter.searchMessages)
 *   gmail.compose   — create drafts (RealGmailAdapter.createDraft)
 *   gmail.send      — send (RealGmailAdapter.sendMessage, APPROVAL_REQUIRED at the driver level)
 *   contacts.readonly — search contacts (RealGoogleContactsAdapter.searchContacts)
 *   calendar.freebusy  — free/busy lookup (RealGoogleCalendarAdapter.freeBusy)
 *   calendar.events    — create events (RealGoogleCalendarAdapter.createEvent, APPROVAL_REQUIRED at the driver level)
 */
export const GOOGLE_OAUTH_SCOPES: readonly string[] = Object.freeze([
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/contacts.readonly',
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.events',
])

/** Documentation-only — the exact env vars this provider reads, never their values. */
export const GOOGLE_OAUTH_ENV_VARS = Object.freeze({
  GOOGLE_CLIENT_ID: '<unset — from the OAuth client created in Google Cloud Console>',
  GOOGLE_CLIENT_SECRET: '<unset — from the same OAuth client>',
  GOOGLE_REFRESH_TOKEN: '<unset — obtained by running the one-time authorization flow, agent-service/googleAuthorize.ts>',
})
