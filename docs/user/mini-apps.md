# Mini-apps

Mini-apps are focused task apps you can import and configure. The app
ships with the **Deletion review** pack (below); anyone can author and
import more.

## Deletion review (bundled)

Assess any folder for files that could be safely deleted:

1. Start from either surface: the command palette (Ctrl+K → "Deletion
   review — assess a folder") or **Settings → Apps → Mini-apps** →
   **Run…**. Pick a folder (system folders and over-broad locations are
   refused). From the palette, the launcher jumps straight to the run's
   conversation so you can watch progress live.
2. Rules decide the clear majority instantly (recently modified files
   stay, build caches and common junk become candidates, sensitive files
   are untouchable); a decision model judges only the rest — with the
   estimated call count shown before it starts.
3. Review the report: every verdict carries its evidence; mark *ask*
   items Keep/Candidate/Exclude (remembered for later runs of that
   folder).
4. **Quarantine candidates…** asks for explicit approval, moves approved
   files into an app-managed quarantine folder, and **Restore** brings
   any of them back at any time. Changed files drop back to *ask*
   automatically; nothing is permanently deleted except by your own
   "empty quarantine".

Pack settings cover everything you'd tweak: the keep-fresh window,
exception globs, excluded extensions, and whether content excerpts may
be sent to the decision model (off by default — only names and metadata
are used). Every pack that declares settings gets its own form on its
card (Settings → Apps → Mini-apps); packs with nothing to configure
(the Calculator) show no form. The Translate pad's delay is configured
on its pack card; the translation **engines** (providers, keys,
routing) stay under Tools → Translation, where the agent's translate
tool and /tr turns share them.

Pre-installed apps (Calculator, Translate pad, Deletion review) are
regular packs: disable them to retire their surfaces (a disabled pad
falls back to the normal command behavior) or remove them entirely —
removal is permanent across restarts, and **Restore pre-installed
apps** brings them back.

## Managing packs (Settings → Apps → Mini-apps)

- **Import pack…** picks a pack file (`.json`). Invalid packs are
  rejected with precise, path-level reasons — nothing installs.
- Each pack shows its **capabilities** (what the host lets it do — e.g.
  *Read files*, *Decision engine*, *Report UI*) and where it came from
  (bundled with the app, or imported).
- The per-pack switch enables/disables it; the **Enable mini-apps**
  switch at the top is the master kill switch for every pack.
- A pack that stops validating (e.g. after an app downgrade) shows
  **Disabled — reason** and stays inert until you re-import a fixed
  version. Re-importing an installed pack must raise its version.

## Importing from a source (git URL or local folder)

**Extension sources** let you import packs straight from a git
repository (https URL) or a local folder that contains them — each
folder can hold several packs (the root plus one level of
subfolders, each with a `manifest.json`).

1. **Add source…** — paste a git URL (or switch to a local folder and
   give an absolute path), pick a ref strategy (latest release tag, a
   tag pattern like `v*`, a branch, or a pinned commit), and add it.
   Nothing is installed yet: adding only records the source.
2. **Check for updates** — fetches the source, validates every manifest
   it finds against the family contract, and lists what it **offers**.
   Candidates this desktop cannot honor (for example packs that
   declare surfaces or capabilities the host does not implement) are
   shown with the exact reason and cannot be installed.
3. **Install…** opens a consent dialog first. It names every
   capability, the author / license / repository **exactly as the
   extension declares them**, the exact content digest, and the tier
   (imported packs are T0 — declarative data only: no code, no
   network). Nothing installs before you confirm.
4. Installed packs start **disabled** — flip the switch when you want
   them live.

**Updates never apply on their own.** Check for updates shows what
changed; data-only updates (identical capabilities and settings schema)
apply with one click, anything that grows the extension asks for
consent again — like a browser permission prompt. If a pinned ref's
content silently changes underneath you, the source is flagged
**degraded** and nothing is refetched until you verify and re-consent.

Removing a source **parks** its imports (disabled, data kept) — nothing
is deleted; you can restore them and remove the packs themselves
whenever you like. Private-repo credentials use named secret slots in
the encrypted key store; a token never goes into the URL.

## Pack settings

Packs declare their own settings schema; the host renders it as a
normal form (numbers, toggles, dropdowns, lists). Values are validated
against the pack's schema on save — a pack can never receive arbitrary
configuration. Everything user-tweakable is a setting: guidelines,
exception lists, excluded extensions, whether file content may be read.
Changing settings does not require a new pack version.

## Running a pack

Assessment packs run on a folder you choose:

1. **Settings → Apps → Mini-apps** → **Run…** on the pack, pick the
   folder. The folder is validated (system folders, your home itself and
   other broad roots are refused with the reason).
2. While it runs you'll see the **pre-flight estimate** ("≈ N model
   calls") and live progress. The run's card in the conversation is
   **live**: a status badge, a progress bar ("3 of 12" while deciding),
   verdict tallies and the model-call cost update in place, and the
   same card carries **View report** — full details one click away,
   no settings detour. The desktop window opens on it automatically.
   Runs can also repeat on a rhythm — see
   [automation](automation.md#scheduled-mini-app-runs).
3. Runs can be **paused** by budget or rate limits — resume continues
   exactly where they stopped, without re-paying decided items. Every
   verdict is cached, so re-running an unchanged folder costs no model
   calls.
4. The **Runs** list shows each run with its cost (calls and tokens);
   export any run as Markdown, JSON or CSV, or open **Changed since last
   run** to see new, removed, changed and verdict-flipped files.
5. **View report** opens the pack's own report: stat tiles, filters, the
   items table and — for every item — its **evidence** (which rule fired
   or which questions were asked and with what confidence). The same
   report opens straight from the conversation: the result card in the
   desktop window carries a **View report** chip, no detour through
   settings needed. Items marked
   *ask* form a review queue: choose **Keep**, **Candidate** or
   **Exclude** and your decision is remembered for later runs of that
   folder. You can also reveal any item in its folder or open it
   (executables are refused). Packs that declare a window surface add
   an **Open in window** button on the report: the report then lives in
   its own app window (one per pack) and closes by itself when the pack
   is disabled or removed, or mini-apps are switched off.
6. For packs that can quarantine: **Quarantine candidates…** shows the
   gated batch (grouped, with confidences) and asks for your explicit
   approval. Approved files move into an app-managed quarantine folder —
   **Restore** brings any item back at any time, nothing is ever
   permanently deleted except by your own "empty quarantine" action.
   If a file changed after the assessment it is left alone and drops
   back to *ask* automatically.

## Safety model (what a pack can never do)

- No pack code runs — packs are data. Buttons and reports render from a
  closed component vocabulary; actions are closed typed ids.
- A pack window (when a pack declares one) is a normal constrained app
  window — no pack code in it, nothing beyond the declared report; it
  closes with the pack's own switches.
- A pack never talks to the network, never picks a model or provider,
  and never touches files outside the folder you choose for a run.
- File content is untrusted input: it can inform questions, never arm
  an action. Destructive outcomes (when a later stage adds them) go
  through an approval you arm explicitly, land in a reversible
  quarantine with Undo/Restore, and are never permanently deleted by
  the app.
- Every recommendation carries its **evidence** — which rule fired or
  which questions were asked and with what confidence. A recommendation
  without justification is treated as a bug.

## What runs cost

Assessment packs ask a decision engine about only the files their rules
can't classify — the decidable majority never costs a model call.
Before a run starts you'll see an estimate of the calls it will make;
the finished report shows what it actually used (both from the app's
local audit log).

## Settings surfaces (family-shared)

Settings → Apps → Mini-apps renders through the same UI kit the other
Neuronection assistants use: pack cards, pack settings forms, the
extension-sources list, the add-source dialog and the install consent
dialog look and behave identically family-wide (origin and tier chips,
verbatim consent text, digest pins). Everything that is desktop's own —
run history and reports, quarantine and overrides, the pack file import
— stays exactly where it was, embedded in the cards.
