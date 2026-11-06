import type { ReactElement } from 'react';
import { interpolate, TEXT } from '@shared/constants/text';
import type { MiniAppRunTotalsView } from '@shared/app-pack';

interface RingSegment {
  label: string;
  value: number;
  color: string;
}

function Ring({ segments, title, ariaLabel }: { segments: RingSegment[]; title: string; ariaLabel: string }): ReactElement {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const size = 88;
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <figure className="flex items-center gap-3" data-testid="pack-ring">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={ariaLabel}
        className="shrink-0"
      >
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--as-muted)" strokeWidth={stroke} />
        {total > 0 &&
          segments
            .filter((segment) => segment.value > 0)
            .map((segment) => {
              const length = (segment.value / total) * circumference;
              const dash = `${length} ${circumference - length}`;
              const element = (
                <circle
                  key={segment.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={segment.color}
                  strokeWidth={stroke}
                  strokeDasharray={dash}
                  strokeDashoffset={-offset}
                  transform={`rotate(-90 ${size / 2} ${size / 2})`}
                />
              );
              offset += length;
              return element;
            })}
      </svg>
      <figcaption className="min-w-0 space-y-1">
        <div className="text-xs font-medium">{title}</div>
        <ul className="space-y-0.5 text-xs">
          {segments.map((segment) => (
            <li key={segment.label} className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: segment.color }} />
              <span>{segment.label}</span>
              <span className="tabular-nums text-[var(--as-muted-foreground)]">{segment.value}</span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}

/**
 * Host-derived run rings (plan 51 S3.1): verdict distribution and
 * decision sources, computed from `run.totals` inside the report
 * renderer — no contract change, no chart component, no dependency.
 * Fixed pixel sizes, no animation (so `prefers-reduced-motion` holds),
 * the text legend carries the counts for non-visual readers.
 */
export function PackVerdictRings({ totals, labels }: { totals: MiniAppRunTotalsView; labels: Record<string, string> }): ReactElement {
  const verdictSegments: RingSegment[] = [
    { label: labels['status.keep'] ?? 'keep', value: totals.keep, color: 'var(--as-success)' },
    { label: labels['status.ask'] ?? 'ask', value: totals.ask, color: 'var(--as-warning)' },
    { label: labels['status.candidate'] ?? 'candidate', value: totals.candidate, color: 'var(--as-danger)' },
  ];
  const sourceSegments: RingSegment[] = [
    { label: TEXT.MINIAPPS_RINGS_SOURCE_RULES, value: totals.ruleDecided, color: 'var(--as-primary)' },
    { label: TEXT.MINIAPPS_RINGS_SOURCE_MODEL, value: totals.modelDecided, color: 'var(--as-ai)' },
    { label: TEXT.MINIAPPS_RINGS_SOURCE_CACHE, value: totals.cacheHits, color: 'var(--as-muted-fg)' },
  ];
  return (
    <div className="flex flex-wrap gap-6" data-testid="pack-verdict-rings">
      <Ring
        title={TEXT.MINIAPPS_RINGS_VERDICT_TITLE}
        ariaLabel={interpolate(TEXT.MINIAPPS_RINGS_VERDICT_ARIA, {
          keep: String(totals.keep),
          ask: String(totals.ask),
          candidate: String(totals.candidate),
        })}
        segments={verdictSegments}
      />
      <Ring
        title={TEXT.MINIAPPS_RINGS_SOURCE_TITLE}
        ariaLabel={interpolate(TEXT.MINIAPPS_RINGS_SOURCE_ARIA, {
          rules: String(totals.ruleDecided),
          model: String(totals.modelDecided),
          cache: String(totals.cacheHits),
        })}
        segments={sourceSegments}
      />
    </div>
  );
}
