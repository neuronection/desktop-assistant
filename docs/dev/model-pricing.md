# Model pricing and call-time cost

The app keeps a local model-pricing table for estimates and records the
resolved cost on every model call. This page covers the contract, the
resolution order, the audit fields and the settings surface; it is the
developer companion to the user guide.

## Contract

`contracts/model-pricing.json` is a vendored family contract. It is generated
from the family canonical and checked byte-for-byte; never hand-edit it. The
shape is:

```jsonc
{
  "schema": 1,
  "currency": "USD",
  "unit": "micros_per_million_tokens",
  "compiled": "YYYY-MM-DD",
  "coverageExceptions": [],
  "models": [
    {
      "provider": "openai",
      "match": { "exact": [], "prefix": [], "aliases": [] },
      "inputMicrosPerMillion": 0,
      "outputMicrosPerMillion": 0,
      "metering": "tokens",
      "basis": "list",
      "reviewed": "YYYY-MM-DD",
      "source": "https://…",
      "retiredAt": null
    }
  ]
}
```

Built-ins are standard-tier list prices. The seed is intentionally allowed to
be empty; a row without a verifiable vendor source is omitted. `unknown` stays
unpriced, never a fabricated zero. `metering` is `tokens`, `input_only`
(embeddings) or `output_only`; `basis: "free"` is a permanent zero, not a
quota tier.

## Resolution

`src/shared/modelPricing.ts` owns the pure resolver. The truth table is:

1. explicit user row (`config.usage.pricing`), then
2. loopback / mDNS endpoint = 0, then
3. built-in contract row, then
4. unknown (unpriced).

Within a class, exact/alias beats a delimiter-aware prefix; the longest prefix
wins; then `resolvedModel` is tried before the requested `model`. A built-in
match on a dated snapshot never outranks a user row on the base id. A blank
user-row provider means “any non-local provider”; a loopback override needs an
explicit matching provider.

## Call-time audit

`AiCall` records `costMicros`, `usageSource`, `estimateMethod`, `priceSource`
and `priceVersion`. The gateway/audit seam resolves the price when the call
finishes; `UsageService` only sums recorded `costMicros`, so a later price
edit cannot rewrite history. `usageSource` is `provider`, `partial` or
`unknown`; a partial provider report stays unpriced. Non-token writers
(translation, TTS, decision/intent) record `unknown` and are not priced.

## Settings

Settings → Data & Cost reads `UsageReport` (micros) and shows:

- **Overview** — today/month totals and by-model rows;
- **Prices** — built-in rows with the checked date, plus editable custom rows
  (provider, model, exact/prefix, USD per 1M stored as micros); Reset removes
  the override;
- **Recent calls** — the last 50 calls of the month.

The assignment surface shows the effective rate and origin through the app's
`renderMeta` slot and links to Prices; it never edits a price inline.

## Verification

- `python3 scripts/check-model-pricing.py --today … --self-test` (family
  canonical, run in the dev repo).
- `node scripts/sync-model-pricing.mjs --check src/shared/ai/modelPricing.generated.ts`
  and `--check-vendored` (vendored JSON + fixture table).
- `tests/model-pricing.test.ts` runs the vendored fixture wall.
- `tests/ai-pricing.test.ts` covers write-time provenance;
  `tests/usage-service.test.ts` covers recorded-micros totals.
