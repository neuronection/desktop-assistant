/**
 * Bundled OAuth client ids — the GNOME Online Accounts model (ADR-0042 §5).
 *
 * A shipped build carries the **family-registered public client id**, so the
 * user's whole experience is: Settings → Calendar → "Sign in with Google" →
 * browser consent → done. Nobody is asked to open a cloud console.
 *
 * These are **public client ids**, not secrets: a client id travels in the
 * authorize URL, so shipping it is correct and safe.
 *
 * **One honest caveat about secrets.** The flow is PKCE (RFC 8252 loopback)
 * and a client secret is not *needed* by the protocol. But **Google's token
 * endpoint requires one anyway for "Desktop app" clients** — Google documents
 * it as **Optional**, yet in practice rejects a PKCE-only exchange (their own
 * developer Q&A says so, and GNOME/Thunderbird ship theirs for exactly this
 * reason). Google also documents that value as **not confidential** for
 * installed apps. So it is bundled below as a *public* value, exactly like the
 * client id — it is not a secret in any meaningful sense, and it grants
 * nothing without a user consenting in a browser.
 *
 * Microsoft's "Mobile and desktop applications" platform is a true public
 * client: it needs no secret, and none is bundled for it.
 *
 * ── Owner action (once per provider, per release channel) ────────────────
 * Register the app and paste the id below. This is a *deployment* act, not a
 * runtime one:
 *
 *   Google   — Cloud Console → Credentials → OAuth client → **Desktop app**
 *              (public client; the loopback redirect is accepted with any
 *              ephemeral port under RFC 8252). Calendar API enabled; consent
 *              screen published *or* the account added as a test user.
 *   Microsoft — Entra → App registration → **Mobile and desktop** platform
 *              with redirect `http://127.0.0.1`; delegated Graph permissions
 *              `Calendars.Read`, `Calendars.ReadWrite`, `User.Read`,
 *              `offline_access`.
 *
 * Self-hosters and forks override with `DESKTOP_<PROVIDER>_CLIENT_ID`
 * (env wins — see `clientIdFor`), which is why the env path still exists.
 *
 * Google's "sensitive scope" rules mean an *unverified* app is limited to
 * ~100 test users and shows an "unverified app" interstitial. Distributing
 * to arbitrary users needs Google's OAuth verification (privacy policy, demo
 * video, review) — a business process, not a code change. Microsoft has a
 * similar publisher-verification tier for public multi-tenant apps.
 */

/** Provider id → the family-registered public client id. Empty = not built. */
export const BUNDLED_CLIENT_IDS: Readonly<Record<string, string>> = {
  // Owner action: paste the registered Desktop-app client id here.
  google: '',
  // Owner action: paste the registered Application (client) id here.
  microsoft: '',
};

/**
 * Provider id → the bundled *public* client value for providers that demand
 * one at the token endpoint. Only Google does today (see the note above:
 * documented as non-confidential for installed apps). Microsoft's public
 * client needs none — leave it empty.
 */
export const BUNDLED_CLIENT_SECRETS: Readonly<Record<string, string>> = {
  google: '',
};

/** The bundled client id, or null when this build carries none. */
export function bundledClientId(providerId: string): string | null {
  const value = BUNDLED_CLIENT_IDS[providerId]?.trim();
  return value ? value : null;
}

/** The bundled public client value, or null (most providers need none). */
export function bundledClientSecret(providerId: string): string | null {
  const value = BUNDLED_CLIENT_SECRETS[providerId]?.trim();
  return value ? value : null;
}
