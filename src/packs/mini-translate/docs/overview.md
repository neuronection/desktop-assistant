# Translate pad

The translate pad is a bundled surface pack that turns the launcher
input into a live translation scratchpad. Type (or paste) text and a
debounced translation appears as a copyable card — with the engine and
the language route shown as metadata.

- **Live with a pause** — translation fires after the pad's debounce
  window (default 1.5 s) so typing isn't flooded with requests; the
  delay is a pack config knob.
- **Target language per invocation** — open the pad with `/tr` (or a
  target code) to set the direction; otherwise the engine default
  applies.
- **Host engines** — the pack declares the `llm` capability but never
  a provider: translation runs through the app's translation funnel,
  the same audited path as the `/tr` command and the agent tool.

## When to use it

Reading or drafting short foreign-language text without switching
apps — summon, type, copy. It is a scratchpad: no glossary, no
document mode.

## When NOT to use it

Whole documents, certified translations, or offline needs — the pad
requires a configured engine (see Setup) and caps at scratchpad-scale
input. Long text belongs in a dedicated tool.
