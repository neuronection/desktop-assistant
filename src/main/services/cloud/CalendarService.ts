import type { CalendarEvent } from '@shared/connectors';
import type { ProviderRow } from './ProviderCatalog';
import { ConnectorError } from './ConnectorStore';

// Wire normalizers for the family calendar contract (ADR-0052 §4/§5). Outputs
// are pinned to tests/fixtures/cloud-connectors.fixtures.json by
// tests/cloud-connectors-conformance.test.ts — implementations may differ,
// outputs may not (ADR-0040 §22). Provider text is untrusted: sanitized and
// capped. Adapters are keyed by PROTOCOL and never see a provider name
// (plan 52 §12 rule 3): a provider's quirks are catalog data.

export interface NormalizedPage {
  events: CalendarEvent[];
  cursor?: string;
}

const MAX_FIELD_CHARS = 2000;
const MAX_DESCRIPTION_CHARS = 4000;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const DAY_MS = 24 * 60 * 60 * 1000;

export function sanitizeText(value: unknown, cap: number = MAX_FIELD_CHARS): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const clean = value.replace(CONTROL_CHARS, '').trim();
  return clean ? clean.slice(0, cap) : undefined;
}

/** Graph naive dateTime + IANA timeZone → UTC ISO (fixture: `…T09:00:00Z`). */
export function graphDateTimeToIso(dateTime: string, timeZone: string | undefined): string {
  const trimmed = dateTime.trim();
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d{1,7}))?$/.exec(trimmed);
  if (!match) {
    const fallback = new Date(trimmed);
    if (Number.isNaN(fallback.getTime())) {
      throw new ConnectorError('provider-error', 'Graph returned an unparseable dateTime.');
    }
    return fallback.toISOString();
  }
  const [, datePart, timePart, fraction = ''] = match;
  const millis = fraction ? Number(fraction.slice(0, 3).padEnd(3, '0')) : 0;
  const naive = `${datePart}T${timePart}.${String(millis).padStart(3, '0')}`;
  const zone = timeZone && timeZone !== 'UTC' ? timeZone : 'UTC';
  if (zone === 'UTC') {
    return utcCanonical(`${naive}Z`);
  }
  try {
    return utcCanonical(zonedToUtc(naive, zone));
  } catch (error) {
    if (error instanceof RangeError) {
      return utcCanonical(`${naive}Z`);
    }
    throw error;
  }
}

function zoneOffsetMinutes(zone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(at);
  const name = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT+00:00';
  const match = /GMT(?:([+-])(\d{2}):(\d{2}))?/.exec(name);
  if (!match) return 0;
  if (!match[1]) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

function zonedToUtc(naiveIso: string, zone: string): string {
  const guessUtc = new Date(`${naiveIso}Z`);
  let offset = zoneOffsetMinutes(zone, guessUtc);
  let result = new Date(guessUtc.getTime() - offset * 60_000);
  const corrected = zoneOffsetMinutes(zone, result);
  if (corrected !== offset) {
    offset = corrected;
    result = new Date(guessUtc.getTime() - offset * 60_000);
  }
  return result.toISOString();
}

function allDayDate(iso: string): string {
  return iso.slice(0, 10);
}

/** Canonical UTC form: second precision when there is no sub-second part. */
function utcCanonical(value: string): string {
  const iso = new Date(value).toISOString();
  return iso.endsWith('.000Z') ? `${iso.slice(0, -5)}Z` : iso;
}

/**
 * The exclusive all-day end, never before start + 1 day (plan 52 E2). The
 * canonical model allows the single-day shorthand `end == start`; providers
 * require `end > start` and treat `end` as exclusive, so both spellings write
 * exactly one day — never zero, never two.
 */
export function allDayEndDate(startIso: string, endIso: string): string {
  const start = allDayDate(startIso);
  const end = allDayDate(endIso);
  return end > start ? end : allDayDate(new Date(Date.parse(`${start}T00:00:00Z`) + DAY_MS).toISOString());
}

/** Recurrence is read-only in v1 (plan 52 H1) — every series write is refused. */
function refuseRecurrence(event: { recurrence?: string }): void {
  if (event.recurrence) {
    throw new ConnectorError('unsupported', 'Recurring events are read-only in v1 — edit the series in the provider.');
  }
}

export function normalizeGoogleEvent(raw: GoogleEvent): CalendarEvent | null {
  if (!raw.id || !raw.start) {
    return null;
  }
  const allDay = !raw.start.dateTime;
  const start = allDay ? raw.start.date! : raw.start.dateTime!;
  const end = allDay ? raw.end?.date : raw.end?.dateTime;
  if (!start || !end) {
    return null;
  }
  const location = sanitizeText(raw.location);
  const description = sanitizeText(raw.description, MAX_DESCRIPTION_CHARS);
  const htmlLink = sanitizeText(raw.htmlLink);
  // E1: iCalUID IS the identity — it is what WE push as the uid. Google's
  // `id` is an opaque handle and changes across calendars/accounts; keying on
  // it re-pulls every pushed event as new and duplicates local rows.
  const uid = raw.iCalUID ?? raw.iCalUId ?? raw.id;
  // E8: Google has no categories field — ours ride private extended properties.
  const marker = raw.extendedProperties?.private?.nxCategories;
  const categories = marker ? marker.split(',').filter((part) => part.length > 0) : undefined;
  return {
    uid,
    summary: sanitizeText(raw.summary) ?? '(untitled)',
    start: allDay ? allDayDate(start) : utcCanonical(start),
    end: allDay ? allDayDate(end) : utcCanonical(end),
    allDay,
    ...(location ? { location } : {}),
    ...(description ? { description } : {}),
    ...(htmlLink ? { htmlLink } : {}),
    ...(categories && categories.length > 0 ? { categories } : {}),
    remoteId: raw.id,
    ...(raw.etag ? { etag: raw.etag } : {}),
  };
}

export function normalizeGraphEvent(raw: GraphEvent): CalendarEvent | null {
  const uid = raw.iCalUId ?? raw.id;
  if (!uid || !raw.start?.dateTime || !raw.end?.dateTime) {
    return null;
  }
  const allDay = raw.isAllDay === true;
  const startIso = graphDateTimeToIso(raw.start.dateTime, raw.start.timeZone);
  const endIso = graphDateTimeToIso(raw.end.dateTime, raw.end.timeZone);
  const startDate = raw.start.dateTime.slice(0, 10);
  const endDate = raw.end.dateTime.slice(0, 10);
  const bodyContent = typeof raw.body?.content === 'string' ? raw.body.content : undefined;
  const location = sanitizeText(raw.location?.displayName);
  const description = sanitizeText(bodyContent, MAX_DESCRIPTION_CHARS);
  const webLink = sanitizeText(raw.webLink);
  return {
    uid,
    summary: sanitizeText(raw.subject) ?? '(untitled)',
    start: allDay ? startDate : startIso,
    end: allDay ? endDate : endIso,
    allDay,
    ...(location ? { location } : {}),
    ...(description ? { description } : {}),
    ...(webLink ? { htmlLink: webLink } : {}),
    ...(Array.isArray(raw.categories) && raw.categories.length > 0 ? { categories: raw.categories.slice(0, 12) } : {}),
    ...(raw.id ? { remoteId: raw.id } : {}),
    ...(raw.changeKey ? { etag: raw.changeKey } : {}),
  };
}

export interface GoogleEvent {
  id?: string;
  iCalUID?: string;
  iCalUId?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  status?: string;
  etag?: string;
  extendedProperties?: { private?: { nxCategories?: string } };
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  recurrence?: string[];
  recurringEventId?: string;
}

export interface GoogleListResponse {
  items?: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

export interface GraphEvent {
  id?: string;
  iCalUId?: string;
  changeKey?: string;
  subject?: string;
  body?: { content?: string; contentType?: string };
  bodyPreview?: string;
  location?: { displayName?: string };
  webLink?: string;
  isAllDay?: boolean;
  categories?: string[];
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  type?: string;
  seriesMasterId?: string;
  recurrence?: { pattern?: unknown } | null;
}

export interface GraphListResponse {
  value?: GraphEvent[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}

/** One row from a provider's calendar-list — the picker source (ADR-0052 Rev 6). */
export interface CalendarListRow {
  id: string;
  name: string;
  url: string;
  primary: boolean;
  access?: string;
}

export interface GoogleCalendarListItem {
  id?: string;
  summary?: string;
  primary?: boolean;
  accessRole?: string;
  htmlLink?: string;
}

export interface GraphCalendarListItem {
  id?: string;
  name?: string;
  isDefaultCalendar?: boolean;
  webLink?: string;
  owner?: { name?: string };
}

/**
 * Normalized picker rows for Google's `users/me/calendarList`. Pure — the
 * transport fetches, this maps. Mirrors `cloud_calendar.py`'s
 * `GoogleCalendarTransport.discover_calendars` (implementations may differ,
 * outputs may not).
 */
export function googleCalendarRow(item: GoogleCalendarListItem): CalendarListRow {
  return {
    id: String(item.id ?? ''),
    name: String(item.summary ?? item.id ?? ''),
    url: item.htmlLink ?? '',
    primary: Boolean(item.primary),
    access: String(item.accessRole ?? ''),
  };
}

/** Mirrors `GraphCalendarTransport.discover_calendars` for `/me/calendars`. */
export function graphCalendarRow(item: GraphCalendarListItem): CalendarListRow {
  return {
    id: String(item.id ?? ''),
    name: String(item.name ?? item.id ?? ''),
    url: item.webLink ?? '',
    primary: Boolean(item.isDefaultCalendar),
    access: String(item.owner?.name ?? ''),
  };
}

export interface CalendarFetch {
  (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
}

function providerErrorDetail(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  const record = payload as { error?: unknown; message?: unknown };
  const error = record.error as { message?: unknown } | string | undefined;
  const message =
    typeof error === 'string'
      ? error
      : error && typeof error === 'object' && typeof error.message === 'string'
        ? error.message
        : typeof record.message === 'string'
          ? record.message
          : '';
  return sanitizeText(message, 200) ?? '';
}

/** Bounded, domain-scoped fetch: token-bearing calls reach only catalog domains. */
export async function guardedFetch(
  fetchImpl: CalendarFetch,
  url: string,
  allowedDomains: string[],
  init?: { method?: string; headers?: Record<string, string>; body?: string },
  timeoutMs = 20_000
): Promise<{ ok: boolean; status: number; payload: unknown }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ConnectorError('invalid', 'The provider URL could not be parsed.');
  }
  if (parsed.protocol !== 'https:' || !allowedDomains.some((domain) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`))) {
    throw new ConnectorError('invalid', `Host '${parsed.hostname}' is outside the provider's declared domains.`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      if (response.status >= 500 || response.status === 429) {
        throw new ConnectorError('transient', `The calendar endpoint is temporarily unavailable (${response.status}).`);
      }
      if (response.status === 403) {
        throw new ConnectorError('needs-secret', 'The grant lacks a required scope — reconnect to consent again.');
      }
      if (response.status === 401) {
        throw new ConnectorError('needs-auth', 'The access token was rejected — reconnect the account.');
      }
      const detail = providerErrorDetail(payload);
      throw new ConnectorError('provider-error', `The calendar request failed (${response.status})${detail ? `: ${detail}` : ''}.`);
    }
    return { ok: true, status: response.status, payload };
  } catch (error) {
    if (error instanceof ConnectorError) {
      throw error;
    }
    throw new ConnectorError('transient', 'The calendar endpoint could not be reached.');
  } finally {
    clearTimeout(timer);
  }
}

function calendarApiBase(row: ProviderRow): string {
  const apiBase = row.serviceConfig.calendar?.apiBase;
  if (!apiBase) {
    throw new ConnectorError('invalid', 'The catalog row has no calendar apiBase.');
  }
  return apiBase;
}

function googleWindowParams(fromIso: string, toIso: string, max: number, query?: string): URLSearchParams {
  const params = new URLSearchParams({
    timeMin: fromIso,
    timeMax: toIso,
    maxResults: String(Math.min(max, 250)),
    singleEvents: 'true',
    orderBy: 'startTime',
  });
  if (query) {
    // Server-side free-text search (Google `q`): case-insensitive words
    // across title, description and location.
    params.set('q', query);
  }
  return params;
}

export async function googleList(
  fetchImpl: CalendarFetch,
  row: ProviderRow,
  accessToken: string,
  fromIso: string,
  toIso: string,
  max: number,
  query?: string
): Promise<NormalizedPage> {
  const apiBase = calendarApiBase(row);
  const events: CalendarEvent[] = [];
  let pageToken: string | undefined;
  let syncToken: string | undefined;
  for (let page = 0; page < 4; page++) {
    const params = googleWindowParams(fromIso, toIso, Math.max(1, max - events.length), query);
    if (pageToken) {
      params.set('pageToken', pageToken);
    }
    const { payload } = await guardedFetch(fetchImpl, `${apiBase}/calendars/primary/events?${params.toString()}`, row.domains, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = payload as GoogleListResponse;
    for (const raw of data.items ?? []) {
      const normalized = normalizeGoogleEvent(raw);
      if (normalized) {
        events.push(normalized);
      }
    }
    pageToken = data.nextPageToken;
    syncToken = data.nextSyncToken ?? syncToken;
    if (!pageToken || events.length >= max) {
      break;
    }
  }
  return {
    events: events.slice(0, max),
    ...(syncToken ? { cursor: syncToken } : {}),
  };
}

/**
 * E6 URL law: Graph has no `/users/me` — `me` is its own segment. The default
 * transport addresses `/me`; a named user is `/users/{id}` (fixture
 * `wire.graphUrls`). Pinned by the wall — reintroducing `/users/me` turns it red.
 */
export function graphBase(apiBase: string, user: string = 'me', calendarId?: string): string {
  const root = user === 'me' ? '/me' : `/users/${encodeURIComponent(user)}`;
  const base = `${apiBase.replace(/\/$/, '')}${root}`;
  return calendarId ? `${base}/calendars/${encodeURIComponent(calendarId)}` : base;
}

export async function graphList(
  fetchImpl: CalendarFetch,
  row: ProviderRow,
  accessToken: string,
  fromIso: string,
  toIso: string,
  max: number,
  predicate?: (event: CalendarEvent) => boolean
): Promise<NormalizedPage> {
  const apiBase = calendarApiBase(row);
  const events: CalendarEvent[] = [];
  let nextLink: string | undefined = `${graphBase(apiBase)}/calendar/calendarView?startDateTime=${encodeURIComponent(fromIso)}&endDateTime=${encodeURIComponent(toIso)}&$top=${Math.min(max, 100)}`;
  let deltaLink: string | undefined;
  for (let page = 0; page < 4 && nextLink; page++) {
    const { payload } = await guardedFetch(fetchImpl, nextLink, row.domains, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = payload as GraphListResponse;
    for (const raw of data.value ?? []) {
      const normalized = normalizeGraphEvent(raw);
      if (normalized && (!predicate || predicate(normalized))) {
        events.push(normalized);
      }
    }
    nextLink = data['@odata.nextLink'];
    deltaLink = data['@odata.deltaLink'] ?? deltaLink;
    if (events.length >= max) {
      break;
    }
  }
  return {
    events: events.slice(0, max),
    ...(deltaLink ? { cursor: deltaLink } : {}),
  };
}

/** One write request shape: the adapter input shared by create and move. */
export interface WriteEvent {
  uid?: string;
  summary: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  allDay: boolean;
  categories?: string[];
  recurrence?: string;
}

/**
 * Google write mapper (plan 52 E1/E2/E8/E13):
 * - `iCalUID` carries our identity so a push-then-pull never duplicates;
 * - all-day ends pass through exclusive (clamped to start + 1 day);
 * - categories ride `extendedProperties.private.nxCategories` (Google has no
 *   category field) and our events carry the `nxSource` marker;
 * - recurrence writes are refused (`unsupported`).
 */
export function googleEventBody(event: WriteEvent): GoogleEvent & { extendedProperties: { private: Record<string, string> } } {
  refuseRecurrence(event);
  const body: GoogleEvent & { extendedProperties: { private: Record<string, string> } } = {
    ...(event.summary ? { summary: event.summary } : {}),
    ...(event.description ? { description: event.description } : {}),
    ...(event.location ? { location: event.location } : {}),
    ...(event.uid ? { iCalUID: event.uid } : {}),
    extendedProperties: { private: { nxSource: 'neuronection' } },
  };
  if (event.allDay) {
    body.start = { date: allDayDate(event.start) };
    body.end = { date: allDayEndDate(event.start, event.end) };
  } else {
    body.start = { dateTime: utcCanonical(event.start) };
    body.end = { dateTime: utcCanonical(event.end) };
  }
  if (event.categories && event.categories.length > 0) {
    body.extendedProperties.private.nxCategories = event.categories.join(',');
  }
  return body;
}

export async function googleCreate(
  fetchImpl: CalendarFetch,
  row: ProviderRow,
  accessToken: string,
  event: WriteEvent
): Promise<CalendarEvent> {
  const apiBase = calendarApiBase(row);
  const { payload } = await guardedFetch(fetchImpl, `${apiBase}/calendars/primary/events`, row.domains, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(googleEventBody(event)),
  });
  const normalized = normalizeGoogleEvent(payload as GoogleEvent);
  if (!normalized) {
    throw new ConnectorError('provider-error', 'The created event could not be read back.');
  }
  return normalized;
}

/**
 * E1 preflight (plan 52 C1): resolve our identity uid to Google's write
 * handle before mutating. An unknown uid is a typed not-found, never a blind
 * PATCH against an opaque id that may have changed.
 */
export async function googleResolveUid(
  fetchImpl: CalendarFetch,
  row: ProviderRow,
  accessToken: string,
  uid: string
): Promise<GoogleEvent> {
  const apiBase = calendarApiBase(row);
  const params = new URLSearchParams({ iCalUID: uid, maxResults: '5', showDeleted: 'false' });
  const { payload } = await guardedFetch(fetchImpl, `${apiBase}/calendars/primary/events?${params.toString()}`, row.domains, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = payload as GoogleListResponse;
  const found = (data.items ?? []).find((entry) => entry.iCalUID === uid || entry.iCalUId === uid || entry.id === uid);
  if (!found?.id) {
    throw new ConnectorError('not-found', `No event with id '${uid}' was found on this account.`);
  }
  return found;
}

export async function googleMove(
  fetchImpl: CalendarFetch,
  row: ProviderRow,
  accessToken: string,
  uid: string,
  start: string,
  end: string | null,
  allDay: boolean | null
): Promise<CalendarEvent> {
  const current = await googleResolveUid(fetchImpl, row, accessToken, uid);
  if (current.recurrence || current.recurringEventId) {
    throw new ConnectorError('unsupported', 'Recurring events are read-only in v1 — edit the series in the provider.');
  }
  const currentStart = current.start?.dateTime ?? (current.start?.date ? `${current.start.date}T00:00:00Z` : null);
  const currentEnd = current.end?.dateTime ?? (current.end?.date ? `${current.end.date}T00:00:00Z` : null);
  const resolvedAllDay = allDay ?? (!current.start?.dateTime && !!current.start?.date);
  const resolvedStart = start;
  let resolvedEnd = end;
  if (!resolvedEnd && currentStart && currentEnd) {
    // Preserve the event's duration unless an explicit end arrives.
    const duration = Math.max(Date.parse(currentEnd) - Date.parse(currentStart), 60_000);
    resolvedEnd = new Date(Date.parse(resolvedStart) + duration).toISOString();
  }
  resolvedEnd = resolvedEnd ?? resolvedStart;
  const timeFields = googleEventBody({
    summary: '',
    start: resolvedStart,
    end: resolvedEnd,
    allDay: resolvedAllDay,
  });
  const { payload } = await guardedFetch(
    fetchImpl,
    `${calendarApiBase(row)}/calendars/primary/events/${encodeURIComponent(current.id!)}`,
    row.domains,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ start: timeFields.start, end: timeFields.end }),
    }
  );
  const normalized = normalizeGoogleEvent(payload as GoogleEvent);
  if (!normalized) {
    throw new ConnectorError('provider-error', 'The moved event could not be read back.');
  }
  return normalized;
}

/**
 * Graph write mapper: all-day stamps are midnight UTC (`…T00:00:00`), ends
 * stay exclusive with the single-day clamp, categories write verbatim, and
 * recurrence writes are refused (`unsupported`).
 */
export function graphEventBody(event: WriteEvent): GraphEvent {
  refuseRecurrence(event);
  const graphStamp = (iso: string, allDay: boolean): GraphEvent['start'] => {
    if (allDay) {
      return { dateTime: `${allDayDate(iso)}T00:00:00`, timeZone: 'UTC' };
    }
    return { dateTime: new Date(iso).toISOString().slice(0, 19), timeZone: 'UTC' };
  };
  const end = event.allDay ? allDayEndDate(event.start, event.end) : event.end;
  return {
    subject: event.summary,
    isAllDay: event.allDay,
    ...(event.description ? { body: { content: event.description, contentType: 'text' } } : {}),
    ...(event.location ? { location: { displayName: event.location } } : {}),
    start: graphStamp(event.start, event.allDay),
    end: graphStamp(end, event.allDay),
    ...(event.categories && event.categories.length > 0 ? { categories: [...event.categories] } : {}),
  };
}

export async function graphCreate(
  fetchImpl: CalendarFetch,
  row: ProviderRow,
  accessToken: string,
  event: WriteEvent
): Promise<CalendarEvent> {
  const apiBase = calendarApiBase(row);
  const { payload } = await guardedFetch(fetchImpl, `${graphBase(apiBase)}/events`, row.domains, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(graphEventBody(event)),
  });
  const normalized = normalizeGraphEvent(payload as GraphEvent);
  if (!normalized) {
    throw new ConnectorError('provider-error', 'The created event could not be read back.');
  }
  return normalized;
}

export async function graphResolveUid(
  fetchImpl: CalendarFetch,
  row: ProviderRow,
  accessToken: string,
  uid: string
): Promise<GraphEvent> {
  const url = `${graphBase(calendarApiBase(row))}/events?$filter=${encodeURIComponent(`iCalUId eq '${uid.replaceAll("'", "''")}'`)}&$top=1`;
  const { payload } = await guardedFetch(fetchImpl, url, row.domains, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = payload as GraphListResponse;
  const found = (data.value ?? []).find((entry) => entry.iCalUId === uid || entry.id === uid);
  if (!found) {
    throw new ConnectorError('not-found', `No event with id '${uid}' was found on this account.`);
  }
  return found;
}

export async function graphMove(
  fetchImpl: CalendarFetch,
  row: ProviderRow,
  accessToken: string,
  uid: string,
  start: string,
  end: string | null,
  allDay: boolean | null
): Promise<CalendarEvent> {
  const apiBase = calendarApiBase(row);
  const current = await graphResolveUid(fetchImpl, row, accessToken, uid);
  if (current.recurrence || current.seriesMasterId || current.type === 'seriesMaster' || current.type === 'occurrence') {
    throw new ConnectorError('unsupported', 'Recurring events are read-only in v1 — edit the series in the provider.');
  }
  const currentStart = current.start?.dateTime ? graphDateTimeToIso(current.start.dateTime, current.start.timeZone) : null;
  const currentEnd = current.end?.dateTime ? graphDateTimeToIso(current.end.dateTime, current.end.timeZone) : null;
  const resolvedAllDay = allDay ?? current.isAllDay === true;
  const resolvedStart = start;
  let resolvedEnd = end;
  if (!resolvedEnd && currentStart && currentEnd) {
    const duration = Date.parse(currentEnd) - Date.parse(currentStart);
    resolvedEnd = new Date(Date.parse(resolvedStart) + duration).toISOString();
  }
  resolvedEnd = resolvedEnd ?? resolvedStart;
  const { payload } = await guardedFetch(fetchImpl, `${graphBase(apiBase)}/events/${encodeURIComponent(current.id!)}`, row.domains, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      isAllDay: resolvedAllDay,
      start: graphEventBody({ summary: '', start: resolvedStart, end: resolvedEnd, allDay: resolvedAllDay }).start!,
      end: graphEventBody({ summary: '', start: resolvedStart, end: resolvedEnd, allDay: resolvedAllDay }).end!,
    }),
  });
  const normalized = normalizeGraphEvent(payload as GraphEvent);
  if (!normalized) {
    throw new ConnectorError('provider-error', 'The moved event could not be read back.');
  }
  return normalized;
}

// ---------------------------------------------------------------------------
// The protocol adapter seam (plan 52 §12 rule 3): `adapterFor(protocol)` is
// the ONLY protocol entry point. The closed adapter set is code; providers
// are catalog rows. A new protocol costs one adapter here plus fixture rows.
// ---------------------------------------------------------------------------

export interface CalendarListQuery {
  fromIso: string;
  toIso: string;
  max: number;
  /** Free-text query — served server-side when `serverSideSearch` is true. */
  query?: string;
}

export interface CalendarAdapter {
  protocol: string;
  /** True when the wire supports a server-side text query (Google `q`). */
  serverSideSearch: boolean;
  list(fetchImpl: CalendarFetch, row: ProviderRow, accessToken: string, query: CalendarListQuery): Promise<NormalizedPage>;
  create(fetchImpl: CalendarFetch, row: ProviderRow, accessToken: string, event: WriteEvent): Promise<CalendarEvent>;
  move(
    fetchImpl: CalendarFetch,
    row: ProviderRow,
    accessToken: string,
    input: { uid: string; start: string; end: string | null; allDay: boolean | null }
  ): Promise<CalendarEvent>;
}

const googleAdapter: CalendarAdapter = {
  protocol: 'google-calendar',
  serverSideSearch: true,
  list: (fetchImpl, row, token, q) => googleList(fetchImpl, row, token, q.fromIso, q.toIso, q.max, q.query),
  create: (fetchImpl, row, token, event) => googleCreate(fetchImpl, row, token, event),
  move: (fetchImpl, row, token, input) => googleMove(fetchImpl, row, token, input.uid, input.start, input.end, input.allDay),
};

const graphAdapter: CalendarAdapter = {
  protocol: 'graph-calendar',
  // Graph v1 calendarView has no $search — the service filters client-side
  // over the same bounded window.
  serverSideSearch: false,
  list: (fetchImpl, row, token, q) =>
    graphList(
      fetchImpl,
      row,
      token,
      q.fromIso,
      q.toIso,
      q.max,
      q.query
        ? (event) =>
            event.summary.toLowerCase().includes(q.query!.toLowerCase()) ||
            (event.location ?? '').toLowerCase().includes(q.query!.toLowerCase()) ||
            (event.description ?? '').toLowerCase().includes(q.query!.toLowerCase())
        : undefined
    ),
  create: (fetchImpl, row, token, event) => graphCreate(fetchImpl, row, token, event),
  move: (fetchImpl, row, token, input) => graphMove(fetchImpl, row, token, input.uid, input.start, input.end, input.allDay),
};

const CALENDAR_ADAPTERS: Readonly<Record<string, CalendarAdapter>> = {
  [googleAdapter.protocol]: googleAdapter,
  [graphAdapter.protocol]: graphAdapter,
};

export function calendarAdapterFor(protocol: string): CalendarAdapter | null {
  return CALENDAR_ADAPTERS[protocol] ?? null;
}
