import { useEffect, useState, type CSSProperties, type JSX } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import { TEXT, interpolate } from '@shared/constants/text';
import type { AppConfig } from '@shared/config/AppConfig';
import {
  HUD_CUSTOM_LIMITS,
  HUD_SIZE_PRESETS,
  clampHudCustomSize,
  hudSizeTokens,
  type HudCustomSize,
  type HudSizePreset,
} from '@shared/speechHud';

export interface HudSizeControlProps {
  voice: AppConfig['voice'];
  onChange: (updates: Partial<AppConfig['voice']>) => void;
}

const PRESET_COPY: Record<HudSizePreset, { label: string; hint: string }> = {
  compact: { label: TEXT.HUB_SIZE_COMPACT, hint: TEXT.HUB_SIZE_COMPACT_HINT },
  comfort: { label: TEXT.HUB_SIZE_COMFORT, hint: TEXT.HUB_SIZE_COMFORT_HINT },
  large: { label: TEXT.HUB_SIZE_LARGE, hint: TEXT.HUB_SIZE_LARGE_HINT },
};

function metrics(size: { faceWidth: number; controlSize: number; textSize: number }): string {
  return interpolate(TEXT.HUB_SIZE_METRICS, {
    width: size.faceWidth,
    control: size.controlSize,
    text: size.textSize,
  });
}

function Preview({ size }: { size: ReturnType<typeof hudSizeTokens> }): JSX.Element {
  const style = {
    width: Math.min(size.faceWidth, 280),
    padding: 10,
    borderRadius: 30,
    background:
      'linear-gradient(165deg, rgba(255,255,255,0.10), rgba(255,255,255,0.02) 48%, rgba(255,255,255,0) 70%), #11141d',
    border: '1px solid color-mix(in srgb, var(--as-primary) 44%, #333746)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18), 0 8px 22px rgba(0,0,0,0.32)',
    color: '#e7eaf3',
  } as CSSProperties;
  const line = {
    height: size.textSize * 1.28 * 3,
    overflow: 'hidden',
    fontSize: size.textSize,
    lineHeight: 1.28,
    color: 'rgba(231,234,243,0.92)',
    wordBreak: 'break-word',
  } as CSSProperties;
  return (
    <div className="flex justify-center overflow-hidden rounded-lg border border-[var(--as-border)] px-3 py-3">
      <div style={style}>
        <div style={line}>{TEXT.HUB_SIZE_PREVIEW_TEXT}</div>
        <div
          className="mt-2 flex justify-center"
          style={{ gap: size.gap }}
          aria-hidden="true"
        >
          {Array.from({ length: 7 }, (_, index) => (
            <span
              key={index}
              style={{
                width: size.controlSize,
                height: size.controlSize,
                borderRadius: 9,
                border: '1px solid rgba(255,255,255,0.14)',
                background:
                  'radial-gradient(circle at 32% 16%, rgba(255,255,255,0.3), transparent 42%), linear-gradient(160deg, rgba(255,255,255,0.14), rgba(255,255,255,0.035) 48%, rgba(0,0,0,0.1))',
                boxShadow:
                  'inset 0 1px 0 rgba(255,255,255,0.34), inset 0 -1px 0 rgba(0,0,0,0.3), 0 4px 10px rgba(0,0,0,0.3)',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function HudSizeControl({ voice, onChange }: HudSizeControlProps): JSX.Element {
  const [draft, setDraft] = useState<HudCustomSize>(() => clampHudCustomSize(voice.hudCustomSize));
  const selected = voice.hudSizePreset;

  useEffect(() => {
    setDraft(clampHudCustomSize(voice.hudCustomSize));
  }, [voice.hudCustomSize.faceWidth, voice.hudCustomSize.controlSize, voice.hudCustomSize.textSize]);

  const preview = hudSizeTokens(selected, selected === 'custom' ? draft : voice.hudCustomSize);
  const faceMin = Math.max(
    HUD_CUSTOM_LIMITS.faceWidth.min,
    7 * draft.controlSize + 6 * (draft.controlSize >= 26 ? 3 : 2) + 32
  );

  const updateDraft = (patch: Partial<HudCustomSize>): void => {
    setDraft(clampHudCustomSize({ ...draft, ...patch }));
  };

  const chooseCustom = (): void => {
    const next = clampHudCustomSize(draft);
    setDraft(next);
    onChange({ hudSizePreset: 'custom', hudCustomSize: next });
  };

  const applyCustom = (): void => {
    const next = clampHudCustomSize(draft);
    setDraft(next);
    onChange({ hudSizePreset: 'custom', hudCustomSize: next });
  };

  return (
    <div className="space-y-3 rounded-lg border border-[var(--as-border)] p-3">
      <div>
        <h4 className="text-sm font-medium">{TEXT.HUB_SIZE}</h4>
        <p className="text-xs opacity-60">{TEXT.HUB_SIZE_HINT}</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {HUD_SIZE_PRESETS.map((preset) => {
          const meta = PRESET_COPY[preset];
          const active = selected === preset;
          return (
            <button
              key={preset}
              type="button"
              aria-pressed={active}
              aria-label={meta.label}
              onClick={() => onChange({ hudSizePreset: preset })}
              className={`rounded-lg border p-2 text-left text-xs transition-colors ${
                active
                  ? 'border-[var(--as-primary)] bg-[var(--as-primary)]/10'
                  : 'border-[var(--as-border)] hover:bg-[var(--as-secondary)]'
              }`}
            >
              <span className="block font-medium">{meta.label}</span>
              <span className="block opacity-60">{meta.hint}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-medium">{TEXT.HUB_SIZE_CUSTOM}</div>
          <div className="text-xs opacity-60">{TEXT.HUB_SIZE_CUSTOM_HINT}</div>
        </div>
        <Button
          type="button"
          variant={selected === 'custom' ? 'default' : 'outline'}
          size="sm"
          onClick={chooseCustom}
        >
          {TEXT.HUB_SIZE_CUSTOM}
        </Button>
      </div>

      <Preview size={preview} />
      <p className="text-xs opacity-60">{metrics(preview)}</p>

      {selected === 'custom' && (
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="flex items-center justify-between text-xs opacity-80">
              <span>{TEXT.HUB_SIZE_FACE}</span>
              <span className="tabular-nums opacity-70">{draft.faceWidth} px</span>
            </span>
            <input
              type="range"
              min={faceMin}
              max={HUD_CUSTOM_LIMITS.faceWidth.max}
              step={HUD_CUSTOM_LIMITS.faceWidth.step}
              aria-label={TEXT.HUB_SIZE_FACE}
              value={draft.faceWidth}
              onChange={(event) => updateDraft({ faceWidth: Number(event.target.value) })}
              className="w-full accent-[var(--as-primary)]"
            />
          </label>
          <label className="block space-y-1">
            <span className="flex items-center justify-between text-xs opacity-80">
              <span>{TEXT.HUB_SIZE_CONTROL}</span>
              <span className="tabular-nums opacity-70">{draft.controlSize} px</span>
            </span>
            <input
              type="range"
              min={HUD_CUSTOM_LIMITS.controlSize.min}
              max={HUD_CUSTOM_LIMITS.controlSize.max}
              step={HUD_CUSTOM_LIMITS.controlSize.step}
              aria-label={TEXT.HUB_SIZE_CONTROL}
              value={draft.controlSize}
              onChange={(event) => updateDraft({ controlSize: Number(event.target.value) })}
              className="w-full accent-[var(--as-primary)]"
            />
          </label>
          <label className="block space-y-1">
            <span className="flex items-center justify-between text-xs opacity-80">
              <span>{TEXT.HUB_SIZE_TEXT}</span>
              <span className="tabular-nums opacity-70">{draft.textSize} px</span>
            </span>
            <input
              type="range"
              min={HUD_CUSTOM_LIMITS.textSize.min}
              max={HUD_CUSTOM_LIMITS.textSize.max}
              step={HUD_CUSTOM_LIMITS.textSize.step}
              aria-label={TEXT.HUB_SIZE_TEXT}
              value={draft.textSize}
              onChange={(event) => updateDraft({ textSize: Number(event.target.value) })}
              className="w-full accent-[var(--as-primary)]"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={applyCustom}>
              {TEXT.HUB_SIZE_APPLY}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => onChange({ hudSizePreset: 'comfort' })}>
              {TEXT.HUB_SIZE_RESET}
            </Button>
          </div>
          <p className="text-xs opacity-60">
            {interpolate(TEXT.HUB_SIZE_FIT, { width: faceMin })}
          </p>
        </div>
      )}

      {selected !== 'custom' && (
        <div className="flex justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ hudSizePreset: 'comfort' })}>
            {TEXT.HUB_SIZE_RESET}
          </Button>
        </div>
      )}
    </div>
  );
}
