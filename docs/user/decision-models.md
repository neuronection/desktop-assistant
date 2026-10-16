# Decision models: one protocol, any provider

Most assistants spend a full chat turn to understand "dim the living room
to 30" — a round-trip to a large model just to decide which tool to call.
Desktop Assistant can instead hand that decision to a **decision model**:
a small, fast, purpose-built model that picks the tool and arguments in
one shot.

A decision model is an **ordinary provider model**. The provider (API key
+ base URL) and the model row are configured like any other — in
**Settings → API** — and the assignments live in the **Decision** default row and the
**Decision kinds** group of the task list. Today one transport ships, the TypeSafe **System
One** protocol, served by different providers:

| Provider | Where it runs | Notes |
|---|---|---|
| **TypeSafe (direct)** | TypeSafe's own endpoint | The reference deployment; decision-only provider row |
| **OpenRouter** | OpenRouter's Jev route | Rides your existing OpenRouter key and provider row |
| **Custom** | Any System One-compatible endpoint | A `decision`-type provider row with your base URL |

Decisions are **off until a decision model is assigned** — assign one in
**Settings → API → Tasks** (the setup wizard fills the slots for presets
that carry decision models).

## Why typed questions make it safe

System One answers *typed* questions natively rather than free text,
which is what makes it unusually safe for dispatch.

- **It cannot invent a tool.** The candidate tools are projected into a
  `__tool__` choice that always includes a `__none__` out, so the only
  possible answers are real tools or "none".
- **It cannot invent an argument.** Arguments are asked as closed-set
  choices, so an invalid enum value is impossible.
- **It is grounded in your real devices.** With an app in scope, its live
  context digest becomes a choice over the *actual* entity and area ids —
  unknown names are refused locally instead of shipped as guesses.
- **It is fast.** A purpose-built decision model returns a verdict in one
  short call, with rate-limit backoff and a wall-clock timeout.

It is cloud-only and opt-in: requests send the command and the candidate
tool list off-device, and the assignment surface says so plainly. The API
key stays on this device, stored in the OS keyring under the provider row
(never in config). The resolved model version is recorded for the pin
affordance and on the local audit row.

## Slots: what each capability is for

Every decision point asks for a capability; the assigned model answers.

- **`decision:tool-dispatch`** — the turn fast path.
- **`decision:boolean-gate`** — voice auto-send and speak-intent checks.
- **`decision:choice`** — picking one option from a known set
  (live-conversation intent, grounded arguments).
- **`decision:score`** — grading input against ordered levels (assessment
  mini-apps).

Each slot has a primary and a fallback — a second provider's model (say
TypeSafe behind OpenRouter) keeps decisions alive when the primary is
down. An unassigned slot means the decision point does not run; it never
breaks the app.

## Where decision models are used

The decision layer is not only a tool router — it powers a set of
**decision points** across the app:

- **The turn fast path.** Short, plain inputs ("volume 20", "open the
  downloads folder") dispatch straight to a tool. The model only sees the
  few most relevant candidates (a curated vocabulary of tagged tools);
  off-topic inputs skip it entirely. Anything multi-tool or uncertain
  falls through to the normal chat answer.
- **Voice auto-send.** A dictated phrase is judged for completeness before
  it is sent — fail-closed. You choose the judge: the decision model or
  the assigned Voice model (see [voice](voice.md)).
- **Prompt-armed auto-speak.** "Read that to me" arms speaking for that
  reply, even when the global toggle is off. It never gates the turn.
- **Live conversation interruptions.** While the assistant speaks,
  ambient speech is classified (echo/noise filtered first) — a missed
  interrupt is recoverable, a false one is not, so it fails closed.
- **Mini-app assessments.** Assessment packs ask their residual typed
  questions through the same shared funnel, yielding to interactive
  calls.
- **Custom rules.** When the model picks a matching command, run a safe
  action: just run it, route to a model, notify, speak, or tag.
- **Route tools.** A picked route tool hands the input to a normal chat
  turn on a model you choose — turning the decision layer into a router.

## What stays safe

Decision models decide *what* to do; they never get to skip the rules.

- **Policy and approvals are unchanged.** A confident pick still obeys the
  risk class, grants and kill switches. A destructive tool confirms every
  single time.
- **Confidence bands.** Above **Act above** (default 85%) the tool runs;
  between the thresholds (default 50%) it asks; below, chat answers.
- **Fail-closed and fail-through.** Any error, timeout or low confidence
  falls through to the chat answer — never a silent action. The voice
  auto-send gate is the deliberate exception: it degrades to *not
  sending*.
- **Everything is audited** locally under the `intent` task label, with
  provider, model and resolved version.

## Choosing a provider

| If you want… | Pick |
|---|---|
| The reference deployment | TypeSafe (direct) |
| One key for chat and decisions | OpenRouter's Jev model |
| Your own deployment | A custom `decision`-type provider row |
| No decisions at all | Leave the slots unassigned |

Assign providers, models and slots in **Settings → API**; configure
thresholds, scope, routing and rules in **Settings → Tools → Decisions**,
and try inputs with **Try a command** — it shows what the model would pick
without executing anything. Full details: [decisions](decisions.md).
