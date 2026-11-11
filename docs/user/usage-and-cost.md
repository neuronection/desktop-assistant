# Usage and cost

**Settings → Data & Cost** shows what the assistant's model calls have used
this month and what they cost, without sending anything anywhere.

## What is recorded

Every chat and agent-loop model call writes a local audit row: task,
provider, model, input and output tokens when the provider reports them,
duration and outcome. Embedding calls are counted but do not report token
usage, so they normally appear unpriced. Prompts
and replies are **not** part of this record — they live in the conversation
history and memory, not in the usage table.

The view is local SQLite. There is no telemetry, no install ID and no
reporting.

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

## Prices

Open **Prices per model** and add one row per model id, in USD per 1,000,000
tokens. Cost is `input/1M × input price + output/1M × output price`. Save to
apply. A provider whose base URL is loopback (`localhost`, `127.0.0.1`, `[::1]`)
or mDNS (`*.local`) is priced at 0 automatically; RFC1918 LAN addresses are
not, because they may front a paid gateway. A remote model without a price
row is shown as unpriced rather than guessed.

Prices are yours to maintain — they are not fetched from vendors and they can
go stale. The number here is an estimate for awareness, not a bill.

## Limits

- Token counts come from the provider. When a provider or endpoint omits
  them, the call is still counted but priced as unknown; a cancelled chat stream
  keeps the partial usage already reported.
- Totals cover every call of the current month; the recent list is capped at
  50 rows.
- Tool, MCP and speech calls have their own audits; this page is about model
  usage only.
