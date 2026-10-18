# Importing packs: files, sources and consent

Packs reach your machine in two ways: as a single file you import, or
through a **source** you subscribe to — a git repository or a local folder
that can hold several packs and keeps them updatable. Sources never install
anything on their own: every install and every meaningful update asks you
first. The pack basics live in [Mini-apps](mini-apps.md); the safety side
in [What a pack can never do](mini-apps-safety.md).

## Import a pack file

**Settings → Apps → Mini-apps → Import pack…** and pick a pack file
(`.json`). Invalid packs are rejected with precise, path-level reasons —
nothing installs. Imported file packs arrive **enabled**. Re-importing a
pack you already have requires the new file to raise its version.

Packs that carry **code** cannot be imported this way at all — code packs
install only through a source below, where consent and content pinning are
the price of admission.

## Add a source (git URL or local folder)

Each source folder can hold several packs: the root plus one level of
subfolders, each with a `manifest.json`.

1. **Add source…** — paste a git URL (https), or switch to a local folder
   and give an absolute path (local folders are a development feature:
   packaged app builds accept git sources only). Pick a ref strategy: the
   latest release tag, a tag pattern like `v*`, a branch, or a pinned
   commit. Adding only records the source — nothing is fetched or
   installed yet.
2. **Check for updates** — fetches the source, validates every manifest it
   finds against the family contract, and lists what it **offers**.
   Candidates this desktop cannot honor (packs declaring surfaces or
   capabilities the host does not implement) are shown with the exact
   reason and cannot be installed.
3. **Install…** opens a consent dialog first — see below. Nothing installs
   before you confirm.
4. Installed packs start **disabled** — flip the switch when you want them
   live.

Private repositories work: credentials use named secret slots in your
encrypted key store; a token never goes into the URL.

## What the consent dialog shows

- every **capability** the pack declares, verbatim;
- the **tier** — imported data packs are **T0 — declarative data only**:
  no code, no network; imported code packs are **T2 — sandboxed**, with
  the plain-language sandbox disclosure;
- the author / license / repository / description **exactly as the pack
  declares them** — never paraphrased;
- the exact **content digest** the install will be pinned to.

For sandboxed code packs the dialog states verbatim: *"This extension's
code runs sandboxed, not reviewed. Sandboxing limits the blast radius of
this code; it is not a review of its intent. The import is pinned to this
exact content digest."* For data packs: *"This extension is declarative
data only: it carries no code, and the app renders exactly what it
declares — validated against a closed UI vocabulary and schema at import.
Content stays inside the app's rendering and theming; nothing from this
extension executes or reaches the network on its own."* Your confirmation
is recorded with the install — what you consented to stays verifiable
against the digest.

The confirmation itself is verified, not just recorded: the app checks
that the digest and capabilities you were shown still match the content
actually being installed, and refuses the install if anything moved in
between — the recorded consent always binds what really landed.

## Updates never apply on their own

**Check for updates** shows what changed. Data-only updates — same
capabilities, same settings schema — apply with one click. Anything that
grows the pack (new capabilities, changed settings) asks for consent
again, like a browser permission prompt; refusing leaves everything as it
was. Code packs **always** re-consent: there is no automatic path that
ever replaces code you approved.

If a pinned ref's content silently changes underneath you (the exact
bytes you consented to no longer match), the source is flagged
**degraded** and nothing is refetched until you verify and re-consent —
silent substitution is impossible by design.

## Removing a source parks its packs

Removing a source **parks** its installs: they turn disabled and flagged,
but nothing is deleted — data, settings and consent history stay. You can
restore a parked pack (it stays disabled until you enable it) or remove it
properly whenever you like. Bundled apps and their settings are untouched
by any of this.

## Where installs live

Source installs land content-addressed under your app data folder
(`<app data>/mini-apps/<pack id>/<digest>/`), pinned to the digest you
consented to; the sandbox re-checks that digest before the pack's code
ever runs again. Pack cards show where each pack came from: *bundled*
(shipped with the app), *imported* (with its pin + provenance), or
*listed* (offered by a source, not installed).
