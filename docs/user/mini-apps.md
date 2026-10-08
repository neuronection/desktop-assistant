# Mini-apps

Mini-apps are focused task apps you can import and configure — starting
with directory **assessment packs** that inspect a folder and produce an
explained, reviewable report. They are declarative data files validated
on import: a pack that fails validation is disabled with the exact
reason shown, and packs never run code on your machine.

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
   calls") and live progress; the launcher and chat stay usable. Each
   run also opens an entry in your conversation history that settles
   into a permanent result summary when the run finishes.
3. Runs can be **paused** by budget or rate limits — resume continues
   exactly where they stopped, without re-paying decided items. Every
   verdict is cached, so re-running an unchanged folder costs no model
   calls.
4. The **Runs** list shows each run with its cost (calls and tokens);
   export any run as Markdown, JSON or CSV, or open **Changed since last
   run** to see new, removed, changed and verdict-flipped files.

## Safety model (what a pack can never do)

- No pack code runs — packs are data. Buttons and reports render from a
  closed component vocabulary; actions are closed typed ids.
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
