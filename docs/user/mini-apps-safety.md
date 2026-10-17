# What a pack can never do

The pack safety model, in plain language: what each kind of pack is, what
the app guarantees, and the residual you are actually consenting to. For
how packs get onto your machine see
[Importing packs](mini-apps-sources.md); for using them
[Mini-apps](mini-apps.md).

## Ordinary packs are data, not programs

An ordinary (declarative) pack is a JSON file the app validates and
executes as **data**: rules, questions, report layouts, settings schemas.
No pack code runs — there is no code. Buttons and reports render from a
closed component vocabulary the app owns; actions are closed typed ids
("cancel this run", "restore this item"), never scripts. A declarative
pack cannot be tricked into executing something because there is nothing
to execute.

## Code packs run sandboxed — never reviewed

An imported pack whose content carries code runs in its own **sandboxed
process**, one per pack. Before the install you saw the consent dialog:
its capabilities, the exact content digest it is pinned to, and the
plain-language statement that it **runs sandboxed, not reviewed** — the
sandbox limits the blast radius of code; it is not a review of its intent.
That is the honest trade: you are consenting to containment, not to
audited code.

Inside the sandbox, pack code has **no access to your files, your
environment, other apps' windows, or the network** — network requests are
denied outright for code packs in this version, and every attempt is
audited. There is no `require`, no `process`, no `fetch`, no timers — the
names do not exist in the sandbox. Pack code can only ask the app for a
small set of audited capabilities: remembered settings, typed result
items, progress/log events, and whether a declared secret slot is
configured (**never the secret's value** — the app answers with a
placeholder only).

Every capability call lands in your local audit log; calls are rate- and
size-limited (watchdogs and daily byte budgets, with safe defaults you can
tighten). A runaway sandbox — infinite loop, memory bomb, protocol garbage
— is killed by wall-clock and memory watchdogs, and a crashed or killed
sandbox **disables its own pack** with the reason shown; the app and every
other pack keep running. Disabling the pack, removing it, the mini-apps
master switch, or quitting the app kills its sandbox immediately. A
disabled sandboxed pack comes back only through a fresh consented import —
the kill is never silent and never partial.

## Pack windows are normal app windows

A pack that declares a window surface adds an **Open in window** button on
its report: the report then lives in its own app window — a constrained
window like every other window the app opens, with no pack code in it and
nothing beyond the declared report. One window per pack; it closes by
itself when the pack is disabled or removed, when mini-apps are switched
off, or when the app quits.

## The powers a pack never gets

- A pack never picks a model or provider, and never sees provider keys —
  model questions go through the app's own audited decision funnel.
- A pack never touches files outside the folder **you** choose for a run;
  system folders and over-broad locations are refused outright.
- Sensitive files (`.env*`, keys, credentials, token files…) are
  untouchable by an app's own rules — enforced regardless of what the
  pack declares.
- File content is untrusted input: it can inform questions, never arm an
  action. Content excerpts reach a model only if the pack declares it AND
  you allow it in its settings (off by default — names and metadata only).
- The only destructive outcome anywhere is **move-to-quarantine**: it
  needs your explicit approval on a gated batch, it re-checks every file
  at execution (a changed file is left alone), it is reversible (Restore),
  and nothing is permanently deleted except by your own "empty quarantine"
  action.

## Evidence is mandatory

Every recommendation a pack makes carries its **evidence**: which rule
fired, or which questions were asked of the model and with what
confidence. A recommendation without justification is treated as a bug.
