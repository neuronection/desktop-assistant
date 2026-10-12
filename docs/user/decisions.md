# Decisions

**Decision models** route short commands straight to a tool without a full
chat turn. "Dim the living room to 30" can dispatch immediately instead of
costing a model round-trip. Everything else — and any doubt — falls through
to the normal chat answer.

Decisions are **off until a decision model is assigned**. A decision model
is an ordinary provider model: the provider (key + base URL) and the model
row live in **Settings → API**, and the assignments sit in the **Decision
models** group of the task list (one slot per capability, each with a
primary and a fallback). **Settings → Tools → Decisions** keeps the
*behavior*: thresholds, scope, routing, rules and the dry-run test, with a
deep-link card into the API settings.

> For a spotlight on what a decision model is, where decision models are
> used and what they unlock — see [decision models](decision-models.md).

## Assigning decision models

In **Settings → API → Tasks**, the **Decision models** group offers four
capability slots:

| Slot | Serves |
|---|---|
| **Tool dispatch** | Routing short commands straight to tools |
| **Boolean gates** | Voice auto-send and speak-intent checks |
| **Choices** | Picking one option from a known set (live-conversation intent, grounded arguments) |
| **Scores** | Grading input against ordered levels (assessment mini-apps) |

Only models that declare the decision capability are offered, and a
decision model never satisfies a text/vision/… task (or vice versa). Each
slot has a **primary** and a **fallback** assignment — if the primary is
unavailable (bad key, dead model), the fallback answers before the point
falls through. An unassigned slot simply means the decision point does not
run.

The setup wizard handles this for you: presets that carry decision models
(OpenRouter's Jev route) append the decision model rows and fill the empty
slots. Because decision models are cloud models, the assignment surface
states plainly what leaves the device:

> Decision models run in the cloud: your prompt and the candidate tools
> for the step are sent to the assigned provider (e.g. TypeSafe or
> OpenRouter). Your API key stays on this device.

### Versions and pinning

A model row may be a rolling alias (`jev-latest`) or a pinned version. The
app records the version the provider actually served and, once one has been
observed, offers **Pin to …** on the slot — pinning rewrites the model row
to the observed version so a provider-side alias move can no longer change
what runs. **Use rolling alias** switches back.

## Confidence bands

The model returns a confidence, and thresholds decide what happens:

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

- **Tool apps in scope** — only the selected apps expose their tools to the
  decision model. Empty means no app tools.
- **Include built-in tools** — the curated built-in vocabulary (screenshot,
  volume, files, windows…).

With nothing in scope, the model idles and every command falls through to
chat. Some apps are **not eligible for the fast path** because their tools
match devices by name instead of entity ids; their tools stay in the
regular agent path.

### Grounding

When an app in scope has published a live context digest (see
[tool apps](apps-and-mcp.md#live-context)), the catalog arguments are
constrained to real entity/area ids, so the model can only pick a real
target. Unknown names are refused locally instead of shipped as guesses.

### Extra prompt

**Extra prompt** (max 1000 characters) steers the model — for example,
naming conventions or room names.

## Route tools

A **route tool** hands a picked input to a normal chat turn on a model you
choose — it never runs anything itself. Give it a name, description,
target model, and up to six examples of inputs that should pick it. This
turns the decision layer into a router.

If the route target's model is not configured or has no key, the input
falls through with a trace note.

## Custom rules

**Custom rules** run one safe action when the model picks a matching
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
point (the **Boolean gates** slot). It stays fail-closed — any error,
timeout, or low confidence means the transcript is not sent. See
[voice](voice.md).

## Testing

**Try a command** runs the assigned decision model without executing
anything and shows what it would pick, the confidence, and the band (**run
it**, **ask you first**, or **let chat answer**).

## Audit

Every decision is audited locally like any other AI call, under the
`intent` task label, carrying the provider, the assigned model and — when
the transport reports one — the resolved model version. A model that
reports token usage records it on the audit row. Decision trace rows show
the model, confidence, chosen tools, and any failure or routing.
