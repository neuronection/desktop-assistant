import { useEffect, useState, type JSX } from 'react';
import type { TurnReceipt as TurnReceiptData } from '@shared/usage';
import { TEXT, interpolate } from '@shared/constants/text';

function cost(micros: number | null): string {
  return micros === null ? TEXT.RECEIPT_UNPRICED : `$${(micros / 1_000_000).toFixed(4)}`;
}

export function TurnReceipt({ messageId }: { messageId: string }): JSX.Element | null {
  const [receipt, setReceipt] = useState<TurnReceiptData | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReceipt(null);
    const request = window.electronAPI?.getTurnReceipt?.(messageId);
    if (!request) {
      return undefined;
    }
    request
      .then((value) => {
        if (!cancelled) {
          setReceipt(value);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [messageId]);

  if (!receipt) {
    return null;
  }
  const empty = receipt.calls === 0 && receipt.tools.length === 0 && receipt.destinations.length === 0;
  if (empty) {
    return (
      <section className="space-y-1">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider opacity-50">{TEXT.RECEIPT_TITLE}</h3>
        <p className="text-xs opacity-40">{TEXT.RECEIPT_EMPTY}</p>
      </section>
    );
  }

  return (
    <section className="space-y-1">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider opacity-50">{TEXT.RECEIPT_TITLE}</h3>
      <p className="text-xs">
        {interpolate(TEXT.RECEIPT_COST, { cost: cost(receipt.costMicros) })} ·{' '}
        {interpolate(TEXT.RECEIPT_TOKENS, {
          input: receipt.inputTokens.toLocaleString(),
          output: receipt.outputTokens.toLocaleString(),
        })}
        {receipt.unpricedCalls > 0 && ` · ${receipt.unpricedCalls} ${TEXT.RECEIPT_UNPRICED}`}
      </p>
      {receipt.models.length > 0 && (
        <ul className="space-y-0.5 text-[11px] opacity-70">
          {receipt.models.map((row) => (
            <li key={`${row.providerId ?? ''}:${row.model}`}>
              {interpolate(TEXT.RECEIPT_MODEL_LINE, {
                model: row.model,
                calls: String(row.calls),
                tokens: interpolate(TEXT.RECEIPT_TOKENS, {
                  input: row.inputTokens.toLocaleString(),
                  output: row.outputTokens.toLocaleString(),
                }),
              })}
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-0.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider opacity-40">{TEXT.RECEIPT_DESTINATIONS}</p>
        {receipt.destinations.length === 0 ? (
          <p className="text-[11px] opacity-40">{TEXT.RECEIPT_NO_DESTINATIONS}</p>
        ) : (
          <ul className="space-y-0.5 text-[11px] opacity-70">
            {receipt.destinations.map((entry) => (
              <li key={entry.id}>
                {entry.host} · {entry.allowed ? TEXT.EGRESS_ALLOWED : TEXT.EGRESS_BLOCKED}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-0.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider opacity-40">{TEXT.RECEIPT_TOOLS}</p>
        {receipt.tools.length === 0 ? (
          <p className="text-[11px] opacity-40">{TEXT.RECEIPT_NO_TOOLS}</p>
        ) : (
          <ul className="space-y-0.5 text-[11px] opacity-70">
            {receipt.tools.map((tool, index) => (
              <li key={`${tool.tool}-${index}`}>
                {tool.tool} · {tool.outcome} · {tool.approvedBy}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
