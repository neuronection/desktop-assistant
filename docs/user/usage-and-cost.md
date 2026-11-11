# Usage and cost

**Settings → Data & Cost** shows what the assistant's model calls have used
this month and what they cost, without sending anything anywhere. It is split
into **Overview** (totals and the by-model breakdown), **Prices**,
**Recent calls** and **Network** (the egress policy and its session log) so
the page stays scannable.

## What is recorded

Every chat and agent-loop model call writes a local audit row: task,
provider, model, input and output tokens when the provider reports them,
duration and outcome. Embedding calls are counted but usually do not report
token usage, so they normally appear unpriced. Prompts
and replies are **not** part of this record — they live in the conversation
history and memory, not in the usage table.

The cost is **recorded at the time of the call**. Changing a price later does
not rewrite an earlier month. The view is local SQLite. There is no telemetry,
no install ID and no reporting.

## Reading the cards

- **Today** and **This month** show calls, input/output tokens and an
  estimated cost.
- **Cost unknown** means no call could be priced. When some calls are
  priced and others are not, the headline is marked **≥** and the unpriced
  count sits underneath. For a remote provider, a call with only one token
  count reported keeps the known side and is still unpriced; a loopback
  provider is free regardless. A partial-token count under the cards says how
  many calls contributed an incomplete token sum.
- The **recent calls** table lists the last 50 calls of the month with the
  task, model, tokens and estimate.

## Per-turn receipt

In the desktop window, the inspector shows a **Receipt** for the selected
reply: model calls, tokens, recorded cost, tools and their approval source,
and the destinations that turn reached. It is the same recorded data as this
page, scoped to one turn.

## Budgets

Optional **Daily cap** and **Monthly cap** fields in **Overview** take a USD
amount. When the recorded spend reaches a cap, a new turn is refused with a
message naming the cap; raise it or wait. Empty means no cap. The caps apply
to chat and scheduled turns; mini-app runs and background decisions are not
blocked yet.

## Prices

Open **Prices per model**. The page shows **built-in list prices** for the
models it knows, with the date the price was last checked, and your own
**custom prices**. A custom row overrides the built-in row; **Reset** removes
the override and lets the built-in row apply again.

Built-in prices are standard-tier, uncached and non-batch. They are estimates,
not a bill: they exclude taxes, credits, negotiated rates, cached/batch
discounts and regional pricing. Your provider bill is authoritative. Unknown
stays unpriced.

Add a custom row with:

- the model id as the provider reports it, or a trailing prefix such as
  `gpt-6.1-sol-` with **Prefix** matching;
- an optional provider key (blank means any remote provider; a local endpoint
  needs an explicit provider row to be priced);
- input and output USD per 1,000,000 tokens.

Cost is `input/1M × input price + output/1M × output price`. Save to apply.
A provider whose base URL is loopback (`localhost`, `127.0.0.1`, `[::1]`) or
mDNS (`*.local`) is priced at 0 automatically unless you add an explicit
custom row with that provider key (a local proxy can be paid); RFC1918 LAN
addresses are not, because they may front a paid gateway. A remote model without a built-in or
custom price is shown as unpriced rather than guessed.

Prices ship with app releases. They are never fetched from vendors in the background, so they can go stale; the checked date is shown on every built-in row.

## Limits

- Token counts come from the provider. When a provider or endpoint omits
  them, the call is still counted but priced as unknown; a cancelled chat stream
  keeps the partial usage already reported.
- Totals cover every call of the current month; the recent list is capped at
  50 rows.
- Tool, MCP and speech calls have their own audits; this page is about model
  usage only.
