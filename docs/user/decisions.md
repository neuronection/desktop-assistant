# Decisions

The **decision engine** routes short commands straight to a tool without a
full chat turn. "Dim the living room to 30" can dispatch immediately
instead of costing a model round-trip. Everything else — and any doubt —
falls through to the normal chat answer.

Decisions are **off by default**. Configure them in **Settings → Tools →
Decision**.

> For a spotlight on the engines themselves — the local Needle 3 model
> and the cloud TypeSafe Jev model, where they are used and what they
> unlock — see [decision models](decision-models.md).

## Engines

| Engine | What it is |
|---|---|
| **Off** | Standard behavior: every input goes to the chat turn |
| **Chat model (structured)** | Uses the **Decisions (intent)** task model (falling back to the chat model) to pick tools for short commands |
| **Local - Cactus-Compute \| Needle 3** | Runs the Needle 3 model on this device (~34 MB download, works offline after). Fast and private; asks when unsure |
| **Cloud - TypeSafe Jev** | TypeSafe System One (Jev) via OpenRouter — a fast cloud decision model. Sends the command and candidate tool list off-device; needs an OpenRouter API key. Model `jev-1.13` |

For the **local** engine, **Download model** fetches the pinned weights
(~34 MB, checksum-verified) with progress and cancel. Readiness shows
**Ready**, **API key required**, **Model download required**, or **Not
ready — reason**.

For the **cloud** engine, save an OpenRouter API key (stored encrypted in
the OS keyring, never in config). The API endpoint is selectable:
**OpenRouter**, **TypeSafe (direct)**, or **Custom** (a validated
http/https base URL; the SDK appends `/v1/systemone`). The saved key must
be valid for the chosen endpoint.

## Confidence bands

The engine returns a confidence, and thresholds decide what happens:

| Band | Result |
|---|---|
| Above **Act above** | Runs the tool (risk policy and approvals still apply) |
| Between the thresholds | Asks for approval |
| Below **Ask above** | Lets chat answer |

A multi-tool or failed dispatch always falls through to the agent/chat
path. Confident calls run, but **nothing bypasses the approval policy** —
a destructive tool still confirms every time.

## Scope

Nothing is in scope until you choose it:

- **Tool apps in scope** — only the selected apps expose their tools to
  the engine. Empty means no app tools.
- **Include built-in tools** — the curated built-in vocabulary
  (screenshot, volume, files, windows…).

With nothing in scope, the engine idles and every command falls through
to chat. Some apps are **not eligible for the fast path** because their
tools match devices by name instead of entity ids; their tools stay in the
regular agent path.

### Grounding

When an app in scope has published a live context digest (see
[tool apps](apps-and-mcp.md#live-context)), the engine's catalog arguments
are constrained to real entity/area ids, so it can only pick a real
target. Unknown names are refused locally instead of shipped as guesses.

### Extra prompt

**Extra prompt** (max 1000 characters) steers the engine — for example,
naming conventions or room names.

## Route tools

A **route tool** hands a picked input to a normal chat turn on a model you
choose — it never runs anything itself. Give it a name, description,
target model, and up to six examples of inputs that should pick it. This
turns the decision engine into a router.

If the route target's model is not configured or has no key, the input
falls through with a trace note.

## Custom rules

**Custom rules** run one safe action when the engine picks a matching
command. They are validated config data, never scripts. Actions:

- **Just run the command**
- **Route to a model**
- **Show a notification**
- **Speak a message** (or the reply)
- **Tag the conversation**

Dispatch actions still go through policy and approvals.

## Prompt-armed auto-speak

A pre-model check over your own prompt ("read that to me", "say it out
loud") arms speaking for that reply even when the global **Speak replies**
toggle is off, and steers the model to write for the ear. It is a
non-blocking advisory decision point: it never gates the turn, and a model
reply can never arm it.

## Voice auto-send

The voice auto-send verdict runs through the `utterance-gate` decision
point. It stays fail-closed — any error, timeout, or low confidence means
the transcript is not sent. See [voice](voice.md).

## Testing

**Try a command** runs the engine without executing anything and shows
what it would pick, the confidence, and the band (**run it**, **ask you
first**, or **let chat answer**).

## Audit

Every decision is audited locally like any other AI call. An engine that
reports token usage records it on the audit row. Decision trace rows show
the engine, confidence, chosen tools, and any failure or routing.
