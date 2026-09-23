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
pad** — a live mini app:

- Type and it translates as you go, after a configurable **Auto-translate
  delay** (`translation.padDebounceMs`, default 1.5 s; longer means fewer
  engine calls).
- The target language carries over from the opening slash.
- The result panel is multiline and scrollable, with an engine/route
  footer. `Enter` copies the result; `Esc` exits.
- The pad header is draggable.

The pad calls translation directly — no chat turn and no persistence. The
calculator mini app's path is unaffected.

## Result metadata

A translation shows a meta line like `via <engine> · <route>` so you can
tell which engine answered. Service calls are audited locally.
