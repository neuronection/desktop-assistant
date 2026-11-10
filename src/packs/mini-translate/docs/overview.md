# Translate pad

The translate pad is a bundled surface pack that turns the launcher
input into a live translation scratchpad. Type (or paste) text and a
debounced translation appears as a copyable card — with the engine and
the language route shown as metadata.

- **Opens ready to type** — picking Translate (or typing `/tr`) puts the
  cursor in the pad with source **Automatic** and your target already
  chosen: the direction you last applied, otherwise the default target
  from Tools → Translation, otherwise English. The route shows in the
  pad's mode bar (`→ el`).
- **Settings lives in the pad** — the **Settings** button in the mode
  bar opens the direction menu in place: a searchable language browser
  with flags, English and native names (the family catalog, 43
  languages), an **Automatic** entry for the source, any custom language
  you have added, and a field that turns a typed code into a new custom
  language. **Apply** switches the live pad without losing typed text
  and remembers the direction; **Close** discards the changes.
- **Engine per pad** — the same menu's *Engine* row overrides the engine
  for this pad only: configured default (Tools → Translation), services
  then model, services only, or model only. Provider instances, keys and
  failover order stay in Tools → Translation; the menu's *Translation
  engine settings…* link jumps there.
- **Swap, speak, retry** — the mode bar's ⇄ button reverses an explicit
  direction (`en → el` becomes `el → en`) and translates again; the result
  card's **Speak** button reads it aloud through the assistant's speech
  bus; a failed request keeps its error row with **Retry**.
- **Live with a pause** — translation fires after the pad's debounce
  window (default 1.5 s) so typing isn't flooded with requests; the
  delay is a pack config knob.
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
input. Long text belongs in a dedicated tool. `/tr <lang> <text>`
still runs a one-shot translation as a normal turn.
