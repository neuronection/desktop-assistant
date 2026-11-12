# Calculator

The calculator is a bundled surface pack that turns the launcher input
into a live calculator. Type an expression in the summon bar and the
result appears under it as you type — press Enter to copy.

- **Live, offline, deterministic** — evaluation is a pure local
  expression parser, no model call, nothing leaves the machine.
- **Units included** — write `10 km to mi`, `72 f in c`, `2 * 3 m -> ft`
  or `1 gib to mib`; length, mass, temperature, volume, data, speed,
  area, time and angle conversions are built in. Currency and timezone
  conversion are not.
- **A mode, not a window** — while active the composer shows the
  calculator chrome with an accent border; Escape exits back to the
  normal launcher.
- **One command** — the palette entry comes from the pack's
  `calc:evaluate` command contribution: disable the pack and the
  entry disappears with it.

## When to use it

Quick arithmetic and everyday unit conversion without leaving the flow
you're in — summon, `calc` (or just start typing an expression), read the
result, Enter to copy, Escape to dismiss.

## When NOT to use it

Anything needing variables, live currency rates, or history — this is a
one-line scratchpad, not a CAS. (For a currency quote, a web search is
the better tool.)
