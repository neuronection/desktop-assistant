# Decision models: Needle 3 and Jev

Most assistants spend a full chat turn to understand "dim the living room
to 30" — a round-trip to a large model just to decide which tool to call.
Desktop Assistant can instead hand that decision to a **decision model**:
a small, fast, purpose-built model that picks the tool and arguments in
one shot.

Two are built in, one local and one cloud, alongside a no-download
fallback:

| Engine | Where it runs | Cost | Best for |
|---|---|---|---|
| **Chat model (structured)** | Your configured provider | Normal model call | Trying decisions with what you already have |
| **Local — Cactus-Compute \| Needle 3** | On your machine, offline | Free, private | Privacy-sensitive commands; no network |
| **Cloud — TypeSafe Jev** | TypeSafe System One via OpenRouter | Fast cloud call | Fastest picks with the strongest grounding |

Decisions are **off by default**. Turn one on in **Settings → Tools →
Decision**.

## Needle 3 (local)

**Needle 3 by Cactus Compute** is a small model that runs entirely on
your device. You download it once — about **34 MB** — and it works
offline forever after.

- **Private by construction.** The command never leaves your machine.
  There is no key, no account, and no network call.
- **Fast and light.** It answers a routing question in a fraction of the
  size and latency of a chat model.
- **Verified download.** The pinned weights are size- and
  checksum-verified and written atomically; a corrupt download can be
  retried.
- **Honest when unsure.** It asks for confirmation rather than guessing.

Credited to Cactus Compute under Apache-2.0; the model page is linked
from the settings card.

**Use it when** your commands touch private things — files, messages,
your home — and you would rather they never leave the device.

## Jev (cloud)

**TypeSafe System One ("Jev")** is a fast cloud decision model served
through OpenRouter (or TypeSafe directly, or a custom endpoint). It
answers *typed* questions natively rather than free text, which is what
makes it unusually safe for dispatch.

- **It cannot invent a tool.** The candidate tools are projected into a
  `__tool__` choice that always includes a `__none__` out, so the only
  possible answers are real tools or "none".
- **It cannot invent an argument.** Arguments are asked as closed-set
  choices, so an invalid enum value is impossible.
- **It is grounded in your real devices.** With an app in scope, its live
  context digest becomes a choice over the *actual* entity and area ids —
  unknown names are refused locally instead of shipped as guesses.
- **It is fast.** A purpose-built decision model returns a verdict in one
  short call, with 429/529 backoff and a wall-clock timeout.

It is cloud-only and opt-in: requests send the command and the candidate
tool list off-device, under an OpenRouter API key stored in the OS
keyring (never in config). An engine that reports usage records it on the
local audit row.

**Use it when** you want the quickest, best-grounded picks and are happy
for the command to be sent to the cloud.

## The chat-model fallback

No download, no extra key: the **Chat model (structured)** engine uses
your **Decisions (intent)** task model (falling back to the chat model)
with structured output. It is the easiest way to try decisions before
committing to a dedicated engine.

## Where decision models are used

The engine is not only a tool router — it powers a set of **decision
points** across the app:

- **The turn fast path.** Short, plain inputs ("volume 20", "open the
  downloads folder") dispatch straight to a tool. The engine only sees
  the few most relevant candidates (a curated vocabulary of tagged
  tools); off-topic inputs skip it entirely. Anything multi-tool or
  uncertain falls through to the normal chat answer.
- **Voice auto-send.** A dictated phrase is judged for completeness
  before it is sent — fail-closed. You choose the judge: the decision
  engine or the assigned Voice model (see [voice](voice.md)).
- **Prompt-armed auto-speak.** "Read that to me" arms speaking for that
  reply, even when the global toggle is off. It never gates the turn.
- **Custom rules.** When the engine picks a matching command, run a safe
  action: just run it, route to a model, notify, speak, or tag.
- **Route tools.** A picked route tool hands the input to a normal chat
  turn on a model you choose — turning the engine into a router.

## What stays safe

Decision models decide *what* to do; they never get to skip the rules.

- **Policy and approvals are unchanged.** A confident pick still obeys
  the risk class, grants and kill switches. A destructive tool confirms
  every single time.
- **Confidence bands.** Above **Act above** (default 85%) the tool runs;
  between the thresholds (default 50%) it asks; below, chat answers.
- **Fail-closed and fail-through.** Any error, timeout or low confidence
  falls through to the chat answer — never a silent action.
- **Everything is audited** locally on the `intent` task.

## Choosing an engine

| If you want… | Pick |
|---|---|
| The simplest start | Chat model (structured) |
| Nothing leaving your machine | Needle 3 (local) |
| The fastest, most grounded picks | Jev (cloud) |
| No decisions at all | Off |

Configure the engine, scope, thresholds and route tools in **Settings →
Tools → Decision**, and try inputs with **Try a command** — it shows what
the engine would pick without executing anything. Full details:
[decisions](decisions.md).
