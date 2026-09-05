// Chief Phase 2I/2J — the real Gmail/Google Calendar/Google Contacts
// (People API) connectors. Same DI/config discipline as openAiAdapter.ts
// and remoteAiExecutor.ts's AnthropicMessagesAdapter: a real HTTP
// implementation, isConfigured() honestly false without credentials, and
// every method throws rather than silently no-opping if called
// unconfigured. `fetchImpl` is injectable purely so this module's own
// tests never make a real network call.
//
// Phase 2J: a bare GOOGLE_OAUTH_ACCESS_TOKEN (Phase 2I) expires in about
// an hour — useless for a Chief meant to run unattended for days/weeks.
// Each adapter now resolves its token through a shared
// GoogleCredentialProvider (googleCredentialProvider.ts), which caches
// and refreshes via the OAuth refresh_token grant — the ONE place that
// logic lives, never duplicated per adapter. `accessToken` remains
// available as a hard override (tests, or a caller pinning one token
// deliberately) — when set, it bypasses the credential provider
// entirely; a real long-running deployment should NOT set it and should
// rely on the credential provider instead.
//
// THIS SESSION HAS NO GOOGLE OAUTH CREDENTIALS CONFIGURED — these
// adapters are real, production-ready code, but every capability they
// expose stays unreachable (isConfigured() === false) until Jerry
// completes the one-time authorization flow (agent-service/googleAuthorize.ts).

import { GoogleCredentialProvider } from './googleCredentialProvider'

export interface GoogleAdapterOptions {
  /** Hard override — bypasses the credential provider entirely. Mainly for tests/manual pinning; a real long-running Chief should rely on credentialProvider since a bare token expires. */
  accessToken?: string
  /** Shared credential provider (Gmail/Calendar/Contacts can all pass the SAME instance). Defaults to a provider reading GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REFRESH_TOKEN from the environment. */
  credentialProvider?: GoogleCredentialProvider
  baseUrl?: string
  fetchImpl?: typeof fetch
}

abstract class GoogleAdapterBase {
  protected readonly accessTokenOverride: string | undefined
  protected readonly credentialProvider: GoogleCredentialProvider
  protected readonly fetchImpl: typeof fetch

  constructor(options: GoogleAdapterOptions) {
    this.accessTokenOverride = options.accessToken
    this.credentialProvider = options.credentialProvider ?? new GoogleCredentialProvider({ fetchImpl: options.fetchImpl })
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  isConfigured(): boolean {
    return !!this.accessTokenOverride || this.credentialProvider.isConfigured()
  }

  protected async resolveAccessToken(callerName: string): Promise<string> {
    if (this.accessTokenOverride) return this.accessTokenOverride
    if (!this.credentialProvider.isConfigured()) throw new Error(`${callerName} called without configured Google credentials — isConfigured() should have prevented this.`)
    return this.credentialProvider.getAccessToken()
  }
}

// ---------------------------------------------------------------------------
// Gmail (gmail.googleapis.com, Gmail API v1)
// ---------------------------------------------------------------------------

export interface GmailMessageSummary {
  id: string
  threadId: string
  from: string
  to: string[]
  subject: string
  snippet: string
  receivedAt: string | null
}

export interface GmailSendAsIdentity {
  sendAsEmail: string
  displayName: string | null
  isDefault: boolean
  isPrimary: boolean
  /** Google's own verification state for a non-primary alias ('accepted', 'pending', etc) — null when not applicable (e.g. the primary address). A non-'accepted' alias cannot actually send yet, regardless of what this list otherwise shows. */
  verificationStatus: string | null
}

export interface GmailSendInput {
  to: string
  subject: string
  bodyText: string
  threadId?: string
  /**
   * The From identity to send/draft as — e.g. 'jerry@getcheckoff.com'. A
   * real live proof (Phase 2J) caught that omitting this silently sends
   * as whichever mailbox the OAuth token authenticates as (the actual
   * inbox, e.g. jerrystuckart@gmail.com) — never the intended business
   * identity. Required here specifically so no caller can forget it;
   * must be one of the addresses listSendAsIdentities() actually returns
   * for this account.
   */
  from: string
}

export interface GmailAdapter {
  isConfigured(): boolean
  /** Real Gmail search syntax (e.g. `from:someone@example.com subject:Hood River`). */
  searchMessages(query: string, maxResults?: number): Promise<GmailMessageSummary[]>
  /** AUTO, read-only — enumerates configured send-as identities/aliases so Chief/Jerry can verify which From address is actually available before any send. Never modifies settings. */
  listSendAsIdentities(): Promise<GmailSendAsIdentity[]>
  /** AUTO (destination_relationship.draft_outreach) — creates a Gmail draft, never sends. */
  createDraft(input: GmailSendInput): Promise<{ draftId: string; messageId: string; threadId: string }>
  /** APPROVAL_REQUIRED (destination_relationship.send_email) — the driver must never call this without a recorded Jerry approval. */
  sendMessage(input: GmailSendInput): Promise<{ messageId: string; threadId: string }>
}

function base64UrlEncode(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function buildRfc2822Message(input: { to: string; from: string; subject: string; bodyText: string }): string {
  return [`From: ${input.from}`, `To: ${input.to}`, `Subject: ${input.subject}`, 'Content-Type: text/plain; charset="UTF-8"', '', input.bodyText].join('\r\n')
}

export class RealGmailAdapter extends GoogleAdapterBase implements GmailAdapter {
  private readonly baseUrl: string

  constructor(options: GoogleAdapterOptions = {}) {
    super(options)
    this.baseUrl = options.baseUrl ?? 'https://gmail.googleapis.com'
  }

  async searchMessages(query: string, maxResults = 10): Promise<GmailMessageSummary[]> {
    const token = await this.resolveAccessToken('RealGmailAdapter.searchMessages')
    const listRes = await this.fetchImpl(`${this.baseUrl}/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`, { headers: { authorization: `Bearer ${token}` } })
    if (!listRes.ok) throw new Error(`Gmail messages.list returned ${listRes.status}: ${await listRes.text().catch(() => '<no body>')}`)
    const list = (await listRes.json()) as { messages?: Array<{ id: string; threadId: string }> }
    const ids = list.messages ?? []

    const summaries: GmailMessageSummary[] = []
    for (const { id, threadId } of ids) {
      const headers = ['From', 'To', 'Subject', 'Date']
      const params = headers.map((h) => `metadataHeaders=${h}`).join('&')
      const msgRes = await this.fetchImpl(`${this.baseUrl}/gmail/v1/users/me/messages/${id}?format=metadata&${params}`, { headers: { authorization: `Bearer ${token}` } })
      if (!msgRes.ok) throw new Error(`Gmail messages.get(${id}) returned ${msgRes.status}: ${await msgRes.text().catch(() => '<no body>')}`)
      const msg = (await msgRes.json()) as { id: string; threadId: string; snippet?: string; payload?: { headers?: Array<{ name: string; value: string }> } }
      const h = (name: string) => msg.payload?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase())?.value ?? ''
      summaries.push({
        id: msg.id,
        threadId: msg.threadId,
        from: h('From'),
        to: h('To')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        subject: h('Subject'),
        snippet: msg.snippet ?? '',
        receivedAt: h('Date') || null,
      })
    }
    return summaries
  }

  async listSendAsIdentities(): Promise<GmailSendAsIdentity[]> {
    const token = await this.resolveAccessToken('RealGmailAdapter.listSendAsIdentities')
    const res = await this.fetchImpl(`${this.baseUrl}/gmail/v1/users/me/settings/sendAs`, { headers: { authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error(`Gmail settings.sendAs.list returned ${res.status}: ${await res.text().catch(() => '<no body>')}`)
    const json = (await res.json()) as { sendAs?: Array<{ sendAsEmail: string; displayName?: string; isDefault?: boolean; isPrimary?: boolean; verificationStatus?: string }> }
    return (json.sendAs ?? []).map((s) => ({
      sendAsEmail: s.sendAsEmail,
      displayName: s.displayName ?? null,
      isDefault: !!s.isDefault,
      isPrimary: !!s.isPrimary,
      verificationStatus: s.verificationStatus ?? null,
    }))
  }

  async createDraft(input: GmailSendInput): Promise<{ draftId: string; messageId: string; threadId: string }> {
    const token = await this.resolveAccessToken('RealGmailAdapter.createDraft')
    const raw = base64UrlEncode(buildRfc2822Message(input))
    const res = await this.fetchImpl(`${this.baseUrl}/gmail/v1/users/me/drafts`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message: { raw, threadId: input.threadId } }),
    })
    if (!res.ok) throw new Error(`Gmail drafts.create returned ${res.status}: ${await res.text().catch(() => '<no body>')}`)
    const json = (await res.json()) as { id: string; message: { id: string; threadId: string } }
    return { draftId: json.id, messageId: json.message.id, threadId: json.message.threadId }
  }

  async sendMessage(input: GmailSendInput): Promise<{ messageId: string; threadId: string }> {
    const token = await this.resolveAccessToken('RealGmailAdapter.sendMessage')
    const raw = base64UrlEncode(buildRfc2822Message(input))
    const res = await this.fetchImpl(`${this.baseUrl}/gmail/v1/users/me/messages/send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ raw, threadId: input.threadId }),
    })
    if (!res.ok) throw new Error(`Gmail messages.send returned ${res.status}: ${await res.text().catch(() => '<no body>')}`)
    const json = (await res.json()) as { id: string; threadId: string }
    return { messageId: json.id, threadId: json.threadId }
  }
}

// ---------------------------------------------------------------------------
// Google Calendar (www.googleapis.com/calendar/v3)
// ---------------------------------------------------------------------------

export interface FreeBusyWindow {
  startIso: string
  endIso: string
}

export interface GoogleCalendarAdapter {
  isConfigured(): boolean
  /** AUTO (checking availability is read-only). */
  freeBusy(calendarId: string, timeMinIso: string, timeMaxIso: string): Promise<FreeBusyWindow[]>
  /** APPROVAL_REQUIRED (destination_relationship.create_calendar_event) — the driver must never call this without a recorded Jerry approval. */
  createEvent(calendarId: string, input: { summary: string; description: string; startIso: string; endIso: string; attendeeEmails: string[] }): Promise<{ eventId: string }>
}

export class RealGoogleCalendarAdapter extends GoogleAdapterBase implements GoogleCalendarAdapter {
  private readonly baseUrl: string

  constructor(options: GoogleAdapterOptions = {}) {
    super(options)
    this.baseUrl = options.baseUrl ?? 'https://www.googleapis.com'
  }

  async freeBusy(calendarId: string, timeMinIso: string, timeMaxIso: string): Promise<FreeBusyWindow[]> {
    const token = await this.resolveAccessToken('RealGoogleCalendarAdapter.freeBusy')
    const res = await this.fetchImpl(`${this.baseUrl}/calendar/v3/freeBusy`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ timeMin: timeMinIso, timeMax: timeMaxIso, items: [{ id: calendarId }] }),
    })
    if (!res.ok) throw new Error(`Calendar freeBusy returned ${res.status}: ${await res.text().catch(() => '<no body>')}`)
    const json = (await res.json()) as { calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }> }
    const busy = json.calendars?.[calendarId]?.busy ?? []
    return busy.map((b) => ({ startIso: b.start, endIso: b.end }))
  }

  async createEvent(calendarId: string, input: { summary: string; description: string; startIso: string; endIso: string; attendeeEmails: string[] }): Promise<{ eventId: string }> {
    const token = await this.resolveAccessToken('RealGoogleCalendarAdapter.createEvent')
    const res = await this.fetchImpl(`${this.baseUrl}/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        summary: input.summary,
        description: input.description,
        start: { dateTime: input.startIso },
        end: { dateTime: input.endIso },
        attendees: input.attendeeEmails.map((email) => ({ email })),
      }),
    })
    if (!res.ok) throw new Error(`Calendar events.insert returned ${res.status}: ${await res.text().catch(() => '<no body>')}`)
    const json = (await res.json()) as { id: string }
    return { eventId: json.id }
  }
}

// ---------------------------------------------------------------------------
// Google Contacts (people.googleapis.com/v1, People API)
// ---------------------------------------------------------------------------

export interface ContactSummary {
  resourceName: string
  displayName: string | null
  emails: string[]
  organization: string | null
}

export interface GoogleContactsAdapter {
  isConfigured(): boolean
  searchContacts(query: string): Promise<ContactSummary[]>
}

export class RealGoogleContactsAdapter extends GoogleAdapterBase implements GoogleContactsAdapter {
  private readonly baseUrl: string

  constructor(options: GoogleAdapterOptions = {}) {
    super(options)
    this.baseUrl = options.baseUrl ?? 'https://people.googleapis.com'
  }

  async searchContacts(query: string): Promise<ContactSummary[]> {
    const token = await this.resolveAccessToken('RealGoogleContactsAdapter.searchContacts')
    const res = await this.fetchImpl(`${this.baseUrl}/v1/people:searchContacts?query=${encodeURIComponent(query)}&readMask=names,emailAddresses,organizations`, { headers: { authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error(`People searchContacts returned ${res.status}: ${await res.text().catch(() => '<no body>')}`)
    const json = (await res.json()) as { results?: Array<{ person: { resourceName: string; names?: Array<{ displayName?: string }>; emailAddresses?: Array<{ value?: string }>; organizations?: Array<{ name?: string }> } }> }
    return (json.results ?? []).map((r) => ({
      resourceName: r.person.resourceName,
      displayName: r.person.names?.[0]?.displayName ?? null,
      emails: (r.person.emailAddresses ?? []).map((e) => e.value).filter((v): v is string => !!v),
      organization: r.person.organizations?.[0]?.name ?? null,
    }))
  }
}

export { GOOGLE_OAUTH_SCOPES, GOOGLE_OAUTH_ENV_VARS } from './googleCredentialProvider'
