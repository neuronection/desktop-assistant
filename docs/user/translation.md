# Translation

Translate text with `/tr [language] <text>`, for example
`/tr el Good morning`. Translation is also available as a tool the
assistant can call during a turn.

## Engines

Two kinds of engine back translation, tried in the order your mode allows:

1. **Translation services** — DeepL or a self-hosted LibreTranslate
   server, in your configured priority order. The first that answers wins;
   the rest are fallbacks.
2. **The LLM engine** — the model assigned to the **Translation (LLM
   engine)** task. It never falls back to the chat model: unassigned means
   the LLM engine is off.

**Engine mode** in **Settings → Tools → Translation**:

| Mode | Behavior |
|---|---|
| **Auto — services first, then LLM** | Services, then the LLM if needed |
| **Translation services only** | Services only |
| **LLM model only** | The assigned LLM only |

When nothing is configured, `/tr` reports exactly what is missing instead
of guessing.

## Services

Add a service with **Add service**:

| Type | Fields |
|---|---|
| **DeepL** | API key (free keys ending in `:fx` are routed automatically); optional endpoint override |
| **LibreTranslate** | Server URL (the JSON API must be enabled); optional API key |

Services have a **priority order** (move up/down), an enable toggle, a
timeout, and a **Test** action. API keys are stored in the OS keyring,
never in the config file.

## Options

- **Default target language** — used when `/tr` is called without a
  language. Choose "None — required per command" to always require one.
- **Custom languages** — add your own codes (2–12 characters: a-z, 0-9 and
  dashes) with a display name and optional native name. They work as
  targets and sources just like built-in codes. A code that collides with
  a built-in language is rejected.

## The translate pad

Run bare `/tr` (or `/tr <language>` with no text) to open the **translate
pad** — a live mini app that opens straight into typing:

- **Opens ready** — source is *Automatic* and the target is the direction
  you last applied, otherwise the default language above, otherwise
  English. The route shows in the pad's bar (`→ el`).
- **Settings in the pad** — the **Settings** button opens the direction
  menu without leaving the pad: a searchable language browser with flags,
  English and native names, an *Automatic* entry for the source, your
  custom languages, and a field that turns a typed code into a new custom
  language. **Apply** keeps the text you already typed; **Close**
  discards the changes.
- **Engine per pad** — the same menu's *Engine* row overrides the engine
  for this pad only: configured default, services then model, services
  only, or model only. Provider instances, keys and failover order stay
  in this panel — the menu links here.
- **Swap, speak, retry** — with an explicit source the ⇄ button reverses
  the direction and translates again; **Speak** on the result reads it
  aloud through the assistant's voice; a failed request keeps its error
  with **Retry**.
- **Pace** — translation fires after the pad's *Auto-translate delay*
  (default 1.5 s, set on the Mini-apps card). It is the only home for
  that knob; the older global value is dropped on the next save.
- `Enter` copies the result. `Esc` closes the options menu first, then
  exits the pad. The pad header is draggable.

The pad calls translation directly — no chat turn and no persistence. The
calculator mini app's path is unaffected.

## Result metadata

A translation shows a meta line like `via <engine> · <route>` so you can
tell which engine answered. Service calls are audited locally.
