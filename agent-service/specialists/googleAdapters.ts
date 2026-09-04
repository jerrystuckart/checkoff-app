// Chief Phase 2I — the real Gmail/Google Calendar/Google Contacts (People
// API) connectors. Same DI/config discipline as openAiAdapter.ts and
// remoteAiExecutor.ts's AnthropicMessagesAdapter: a real HTTP
// implementation gated entirely on a configured OAuth access token —
// isConfigured() is honestly false without one, and every method throws
// rather than silently no-opping if called unconfigured. `fetchImpl` is
// injectable purely so this module's own tests never make a real network
// call.
//
// THIS SESSION HAS NO GOOGLE OAUTH TOKEN CONFIGURED — these adapters are
// real, production-ready code, but every capability they expose stays
// unreachable (isConfigured() === false) until Jerry completes a real
// Google OAuth flow and sets GOOGLE_OAUTH_ACCESS_TOKEN. This is the
// intended state for Phase 2I: closing the "gmail_calendar_execution"
// gap documented in destinationExecutorGap.ts means writing this code,
// not fabricating credentials that don't exist.

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

export interface GmailAdapter {
  isConfigured(): boolean
  /** Real Gmail search syntax (e.g. `from:someone@example.com subject:Hood River`). */
  searchMessages(query: string, maxResults?: number): Promise<GmailMessageSummary[]>
  /** AUTO (destination_relationship.draft_outreach) — creates a Gmail draft, never sends. */
  createDraft(input: { to: string; subject: string; bodyText: string; threadId?: string }): Promise<{ draftId: string }>
  /** APPROVAL_REQUIRED (destination_relationship.send_email) — the driver must never call this without a recorded Jerry approval. */
  sendMessage(input: { to: string; subject: string; bodyText: string; threadId?: string }): Promise<{ messageId: string }>
}

function base64UrlEncode(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function buildRfc2822Message(input: { to: string; subject: string; bodyText: string }): string {
  return [`To: ${input.to}`, `Subject: ${input.subject}`, 'Content-Type: text/plain; charset="UTF-8"', '', input.bodyText].join('\r\n')
}

export interface GoogleAdapterOptions {
  accessToken?: string
  baseUrl?: string
  fetchImpl?: typeof fetch
}

export class RealGmailAdapter implements GmailAdapter {
  private readonly accessToken: string | undefined
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch

  constructor(options: GoogleAdapterOptions = {}) {
    this.accessToken = options.accessToken ?? process.env.GOOGLE_OAUTH_ACCESS_TOKEN
    this.baseUrl = options.baseUrl ?? 'https://gmail.googleapis.com'
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  isConfigured(): boolean {
    return !!this.accessToken
  }

  private requireToken(): string {
    if (!this.accessToken) throw new Error('RealGmailAdapter called without a configured GOOGLE_OAUTH_ACCESS_TOKEN — isConfigured() should have prevented this.')
    return this.accessToken
  }

  async searchMessages(query: string, maxResults = 10): Promise<GmailMessageSummary[]> {
    const token = this.requireToken()
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

  async createDraft(input: { to: string; subject: string; bodyText: string; threadId?: string }): Promise<{ draftId: string }> {
    const token = this.requireToken()
    const raw = base64UrlEncode(buildRfc2822Message(input))
    const res = await this.fetchImpl(`${this.baseUrl}/gmail/v1/users/me/drafts`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message: { raw, threadId: input.threadId } }),
    })
    if (!res.ok) throw new Error(`Gmail drafts.create returned ${res.status}: ${await res.text().catch(() => '<no body>')}`)
    const json = (await res.json()) as { id: string }
    return { draftId: json.id }
  }

  async sendMessage(input: { to: string; subject: string; bodyText: string; threadId?: string }): Promise<{ messageId: string }> {
    const token = this.requireToken()
    const raw = base64UrlEncode(buildRfc2822Message(input))
    const res = await this.fetchImpl(`${this.baseUrl}/gmail/v1/users/me/messages/send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ raw, threadId: input.threadId }),
    })
    if (!res.ok) throw new Error(`Gmail messages.send returned ${res.status}: ${await res.text().catch(() => '<no body>')}`)
    const json = (await res.json()) as { id: string }
    return { messageId: json.id }
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

export class RealGoogleCalendarAdapter implements GoogleCalendarAdapter {
  private readonly accessToken: string | undefined
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch

  constructor(options: GoogleAdapterOptions = {}) {
    this.accessToken = options.accessToken ?? process.env.GOOGLE_OAUTH_ACCESS_TOKEN
    this.baseUrl = options.baseUrl ?? 'https://www.googleapis.com'
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  isConfigured(): boolean {
    return !!this.accessToken
  }

  private requireToken(): string {
    if (!this.accessToken) throw new Error('RealGoogleCalendarAdapter called without a configured GOOGLE_OAUTH_ACCESS_TOKEN — isConfigured() should have prevented this.')
    return this.accessToken
  }

  async freeBusy(calendarId: string, timeMinIso: string, timeMaxIso: string): Promise<FreeBusyWindow[]> {
    const token = this.requireToken()
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
    const token = this.requireToken()
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

export class RealGoogleContactsAdapter implements GoogleContactsAdapter {
  private readonly accessToken: string | undefined
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch

  constructor(options: GoogleAdapterOptions = {}) {
    this.accessToken = options.accessToken ?? process.env.GOOGLE_OAUTH_ACCESS_TOKEN
    this.baseUrl = options.baseUrl ?? 'https://people.googleapis.com'
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  isConfigured(): boolean {
    return !!this.accessToken
  }

  async searchContacts(query: string): Promise<ContactSummary[]> {
    if (!this.accessToken) throw new Error('RealGoogleContactsAdapter called without a configured GOOGLE_OAUTH_ACCESS_TOKEN — isConfigured() should have prevented this.')
    const res = await this.fetchImpl(`${this.baseUrl}/v1/people:searchContacts?query=${encodeURIComponent(query)}&readMask=names,emailAddresses,organizations`, { headers: { authorization: `Bearer ${this.accessToken}` } })
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

export const GOOGLE_ADAPTERS_ENV_VARS = Object.freeze({
  GOOGLE_OAUTH_ACCESS_TOKEN: '<unset — Gmail/Calendar/Contacts stay unconfigured until Jerry completes a real Google OAuth flow>',
})
