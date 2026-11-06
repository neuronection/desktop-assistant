# Cloud calendar connectors (plan 52 P3)

How the desktop hosts the family cloud-calendar contract: the provider
catalog as data, protocol adapters as code, the loopback OAuth bind,
token custody, the chat tool surface, and the TypeScript conformance
wall. The family law is ADR-0052 (canonical text lives in the family
`dev` monorepo: `decisions/0052-family-cloud-accounts.md` and
`guidelines/cloud-connectors.md`); the user-facing behavior is
[Calendar accounts](../user/calendar.md).

## The three layers

```
HOST (desktop)      domain mapping · chat tools · consent UI · secret custody
   ↓ normalized CalendarEvent
PROTOCOL (code)     google-calendar · graph-calendar        ← closed adapter set
   ↓ calendarAdapterFor(protocol)
PROVIDER (data)     contracts/cloud-providers.json          ← open row set
```

**A provider is data, a protocol is code.** Adding a provider that
speaks an existing protocol costs one `cloud-providers.json` row and
nothing else: no code change, no UI change, no new app copy. Adding a
protocol costs one adapter in `src/main/services/cloud/CalendarService.ts`
plus fixture rows. Adapters never branch on a provider name — a grep
for `google`/`microsoft` outside the vendored catalog is a defect.

## Key files

| File | Role |
|---|---|
| `contracts/cloud-providers.json` | The vendored family catalog (read-only — never edited in this repo; report drift, run `scripts/sync-cloud-connectors.sh`). |
| `src/main/services/cloud/ProviderCatalog.ts` | Loader + client-id convention (`DESKTOP_<ID>_CLIENT_ID`) + verbatim scopes. |
| `src/main/services/cloud/CalendarService.ts` | Wire normalizers, write mappers, the Graph URL builder and the protocol adapter registry. |
| `src/main/services/cloud/ConnectorService.ts` | Account lifecycle, list/create/move dispatch, live reads. |
| `src/main/services/cloud/OAuthService.ts` | PKCE + loopback bind, one refresh scheduler per account. |
| `src/main/services/cloud/ConnectorAudit.ts` | External-mutation audit sink. |
| `src/main/ai/tools/native/calendar.ts` | The four chat tools. |
| `tests/cloud-connectors-conformance.test.ts` | The TypeScript fixture wall. |

## Identity and write-mapper law (fixture-pinned)

Outputs are pinned to `tests/fixtures/cloud-connectors.fixtures.json`
by `tests/cloud-connectors-conformance.test.ts` — implementations may
differ, outputs may not:

- **Identity (E1):** the normalized `uid` is Google's `iCalUID` /
  Graph's `iCalUId` — what *we* push. The provider's opaque `id` is
  `remoteId`, the write handle only. Keying identity on the opaque id
  re-pulls every pushed event as new (duplicates). Chat-created events
  mint `desktop:event:<uuid>` and push it as `iCalUID`.
- **All-day ends (E2):** exclusive everywhere; the single-day shorthand
  (`end == start`) clamps to `start + 1 day` on write. Never zero days,
  never two.
- **Categories (E8):** Google has no category field — categories ride
  `extendedProperties.private.nxCategories` (comma-joined) and our
  events carry the `nxSource` marker. Graph writes categories verbatim.
- **Recurrence (H1/E13):** read-only in v1. Any series write refuses
  with the typed code `unsupported`.
- **Graph URLs (E6):** `/me`, never `/users/me`; a named user is
  `/users/{id}` (fixture `wire.graphUrls`).
- **Writes preflight by identity (C1):** moves resolve the uid to the
  write handle first (Google `iCalUID=` query, Graph
  `$filter=iCalUId eq …`), so a crash between write and read-back can
  never double-write.
- **Canonical time form:** second-precision UTC (`2026-11-12T09:00:00Z`);
  sub-second precision is preserved when present.

## Token custody (ADR-0042 clause 3)

Tokens live only in `SecretService` (Electron `safeStorage`) under
`connector:<accountId>:access|refresh|expires|extra`. No column, IPC
payload, log line, notification, export or test fixture may carry a
token-shaped value — the custody tests scan the surfaces by string.
`ConnectorAccount` is metadata only; the schema's shape is the
enforcement. A host without a keyring-backed store refuses to bind
(fail closed, no plaintext fallback).

## OAuth flow and failure posture

Authorization code + PKCE (S256), one-shot loopback listener on
`127.0.0.1` (RFC 8252), one in-flight flow per provider, ~5-minute
timeout, `state` check, listener closed on the first valid callback
(replayed callbacks are refused at the TCP level). The renderer
receives status only.

| Failure | Status | Behavior |
|---|---|---|
| `invalid_grant` / revoked | `needs-auth` | stop refreshing, notify once, no further calls (a cached token is never handed out) |
| transient (network, 5xx, 429) | `degraded` → `failing` | bounded full-jitter backoff, capped attempts, then stop |
| `403 insufficient_scope` | `needs-secret` | re-bind with the growth consent screen |
| rotation crash mid-persist | — | the old refresh chain is never discarded; a retry recovers |

## The chat tools

`calendar_list` / `calendar_search` are `read-only`;
`calendar_create` / `calendar_move` are `state-changing` and ride the
normal per-grant approval rails. No delete tool in v1. Every result
names the acting account (plan 52 M2); `accountId` stays an explicit
argument. Desktop is **live-read/write** — no local mirror, no cursor,
no background job; `ConnectorAccount.status` reflects the last call.

Search semantics: Google maps the query to the server-side `q`
parameter; Graph v1 `calendarView` has no `$search`, so the adapter
filters the same bounded window client-side on title/location/body.

## External-mutation audit (ADR-0052 §8)

`calendar_create` and `calendar_move` each write one `ConnectorAudit`
row: account id, action (`create|move`), outcome (`ok` or the typed
`ConnectorErrorCode`), duration. No event title, attendee, provider
text or credential-shaped field may ever be added to that table.

## The conformance wall

```
npx vitest run tests/cloud-connectors-conformance.test.ts
```

runs every desktop-relevant fixture row: catalog provider sets, verbatim
scope presets, scope growth/removal, the Google/Graph list normalizers,
all write-mapper rows (including the recurrence refusal) and the Graph
URL rows. It is mutation-tested: reintroducing E1 (opaque-id identity),
E2 (all-day off-by-one) or E6 (`/users/me`) turns it red. The Python
family cloud-connector conformance runner executes the same rows
against the canonical implementation.

## Adding a provider

1. One row in the family `cloud-providers.json` (upstream dev commit) —
   sync it here with `scripts/sync-cloud-connectors.sh`.
2. Register the deployment client id under
   `DESKTOP_<PROVIDER-ID>_CLIENT_ID`; providers that require a public
   client value at the token endpoint (Google) also read
   `DESKTOP_GOOGLE_CLIENT_SECRET`. These are public values for installed
   apps, never credentials — and this release ships none, so Settings
   names the variable, copies it and links the setup guide instead of
   pretending Connect will work.
3. No code, no UI, no copy: the Settings surface, consent screen and
   tools derive everything from the row.
4. If the protocol is new, add exactly one adapter + fixture rows.

## Known gaps (reported, not worked around here)

- v1 connects the account's **primary** calendar. The catalog's
  `calendar_id` setup field is not applied yet, so the OAuth bind modal
  shows only the account label and states the primary-calendar scope;
  selection is a follow-up (it needs per-account config storage).
- The CalDAV/ICS setup fields (app-password/URL) have no adapter yet, so
  those providers stay in `upcoming`.
- The catalog carries no MCP descriptor; the external `google-calendar`
  MCP preset in `src/shared/app-presets.ts` remains the reviewed
  hand-curated fallback (ADR-0052 keeps it until the native connector
  replaces it) — it is not part of the provider-catalog surface.
