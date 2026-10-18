# Calculator

The calculator is a bundled surface pack that turns the launcher input
into a live calculator. Type an expression in the summon bar and the
result appears under it as you type — press Enter to copy.

- **Live, offline, deterministic** — evaluation is a pure local
  expression parser, no model call, nothing leaves the machine.
- **A mode, not a window** — while active the composer shows the
  calculator chrome with an accent border; Escape exits back to the
  normal launcher.
- **One command** — the palette entry comes from the pack's
  `calc:evaluate` command contribution: disable the pack and the
  entry disappears with it.

## When to use it

Quick arithmetic without leaving the flow you're in — summon, `calc`
(or just start typing an expression), read the result, Enter to copy,
Escape to dismiss.

## When NOT to use it

Anything needing variables, units, or history — this is a one-line
scratchpad, not a CAS. (For unit-heavy conversions, the translate pad
or a web search is the better tool.)
