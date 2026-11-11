# Usage and cost

**Settings → Data & Cost** shows what the assistant's model calls have used
this month and what they cost, without sending anything anywhere.

## What is recorded

Every model call writes a local audit row: task, provider, model, input and
output tokens when the provider reports them, duration and outcome. Prompts
and replies are **not** part of this record — they live in the conversation
history and memory, not in the usage table.

The view is local SQLite. There is no telemetry, no install ID and no
reporting.

## Reading the cards

- **Today** and **This month** show calls, input/output tokens and an
  estimated cost.
- **Cost unknown** means at least one call had no configured price, or the
  provider did not report both token counts (some streaming and local
  endpoints omit them).
- The **recent calls** table lists the last 50 calls of the month with the
  task, model, tokens and estimate.

## Prices

Open **Prices per model** and add one row per model id, in USD per 1,000,000
tokens. Cost is `input/1M × input price + output/1M × output price`. Save to
apply. A local model can be entered at 0; a model without a row is shown as
unpriced rather than guessed.

Prices are yours to maintain — they are not fetched from vendors and they can
go stale. The number here is an estimate for awareness, not a bill.

## Limits

- Token counts come from the provider. When a provider or endpoint omits
  them, the call is still counted but priced as unknown.
- The table covers the current month, newest first, and caps the recent list
  at 50 rows.
- Tool, MCP and speech calls have their own audits; this page is about model
  usage only.
