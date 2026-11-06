# Calendar accounts

Connect a Google or Microsoft 365 calendar and the assistant can check
your schedule in chat and — with your approval for every change — create
or move events. **Settings → Calendar** lists every provider this build
knows; the list comes from the app's bundled provider catalog, so it can
grow without an app update changing it by hand.

## Before you connect (one-time setup)

This release is **bring your own registration**: it does not ship a
provider OAuth client. Register one desktop client with the provider,
then give the app its public client values through the environment:

| Provider | Variables |
|---|---|
| Google | `DESKTOP_GOOGLE_CLIENT_ID`, `DESKTOP_GOOGLE_CLIENT_SECRET` |
| Microsoft 365 | `DESKTOP_MICROSOFT_CLIENT_ID` |

- **Google**: create an OAuth client of type **Desktop app**. Its client
  id and its public client value are both non-confidential for installed
  apps; Google requires the value at the token endpoint even with PKCE.
- **Microsoft**: register a **Mobile and desktop applications** client
  with the loopback redirect `http://127.0.0.1/oauth/callback` (the app
  uses an ephemeral port). No client secret is used.

Restart the app after setting them. When a value is missing,
**Settings → Calendar** names the exact variable, offers a copy action
and links this guide; **Connect** stays disabled with the reason until it
is set. The values are read from the environment and never written to
the profile; tokens live only in the OS keyring.

## Connect an account

1. Open **Settings → Calendar** and press **Connect** on a provider.
2. A consent window lists, before anything opens:
   - the provider and the account name you are binding;
   - **every permission exactly as the provider spells it** (the full
     scope string — never a paraphrase);
   - **every server your credentials will be sent to**, verbatim.
3. Press **Open browser to consent**. Your system browser opens at the
   provider; this app only ever learns whether you finished — the
   sign-in code never passes through the app window.
4. The account card shows the family status (`ok`, `degraded`, `failing`,
   `stale`) plus `needs re-authentication` / `needs consent` /
   `needs configuration` conditions.

## What the assistant may do in chat

| Tool | Class | What it does |
|---|---|---|
| `calendar_list` | read-only | Events from yesterday through the next N days (default 14, bounded, capped at 250). |
| `calendar_search` | read-only | Case-insensitive words matched against titles, locations and bodies; today through the next N days (default 60, hard cap 400, results capped at 100). On Google the provider searches server-side; on Microsoft the app filters the same bounded window. |
| `calendar_create` | state-changing, needs approval | Creates an event on the account's primary calendar. Attendees, invitations and recurring (series) events are not supported. |
| `calendar_move` | state-changing, needs approval | Reschedules an event by id; the duration is preserved unless an end is given. Series instances cannot be moved. |

There is **no delete tool** in v1. Every result names the account it
acted on (`Account: "Personal" (Google)`), so two bound accounts can
never make "what's on Thursday" ambiguous. Event text comes from the
provider and is treated as untrusted data — it is rendered as plain
text and never executed as an instruction.

All-day ends are **exclusive** (a one-day event on 2026-11-20 ends
midnight 2026-11-21), matching Google and the family calendar contract.

## Consent growth and scope changes

If a re-connect asks for a permission your stored grant does not have,
the consent window shows the **new permissions being added**. If a
re-connect no longer asks for a permission you granted, it shows
**permissions being dropped**. Nothing widens silently.

## Disconnecting

**Disconnect** revokes the grant at the provider (best effort) and
deletes the stored credentials from this device. Where a provider
offers no revoke endpoint (Microsoft does not), the window says exactly
that: the account and its credentials are deleted **from this device**,
and the grant itself stays valid at the provider until it expires or
you remove the app in the provider's own security settings.

## Where credentials live

Tokens live only in the OS-backed secret store (keyring), under
per-account slots. They never appear in chats, config files, logs,
exports or backups. A calendar account is a credential binding, not a
profile — you can bind several accounts (personal + work) and they are
separate instances, not separate users.
