import { type JSX } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import { AppConfig } from '@shared/config/AppConfig';
import { TEXT } from '@shared/constants/text';
import {
  DEFAULT_HUB_QUICK_ACTIONS,
  HUB_ACTION_IDS,
  HUB_ACTIONS,
  HUD_PRESETS,
  DEFAULT_HUB_DOT_ACTIONS,
  HUB_DOT_ACTION_IDS,
  type HudPreset,
  type HubActionId,
} from '@shared/hub';
import { Field, SelectField } from './fields';
import { HudSizeControl } from './HudSizeControl';
import {
  HUD_CORNERS,
  HUD_CORNER_MARKERS,
  HUD_DOCK_MARKERS,
  HUD_DOCKS,
  HUD_POSTURES,
  HUD_STYLE_OPTIONS,
  HudPositionGlyph,
  positionButtonClass,
} from './hudOptions';

export interface HubTabProps {
  config: AppConfig;
  onChange: (updates: Partial<AppConfig>) => void;
}

const PRESET_LABELS: Record<HudPreset, { label: string; hint: string; swatch: string }> = {
  pulse: {
    label: TEXT.HUB_PRESET_PULSE,
    hint: TEXT.HUB_PRESET_PULSE_HINT,
    swatch: 'bg-[linear-gradient(135deg,#6ea8ff,#2fd3c0)]',
  },
  aurora: {
    label: TEXT.HUB_PRESET_AURORA,
    hint: TEXT.HUB_PRESET_AURORA_HINT,
    swatch: 'bg-[conic-gradient(from_0deg,#6ea8ff,#c084fc,#2fd3c0,#f5b04a,#6ea8ff)]',
  },
  minimal: {
    label: TEXT.HUB_PRESET_MINIMAL,
    hint: TEXT.HUB_PRESET_MINIMAL_HINT,
    swatch: 'bg-[var(--as-secondary)]',
  },
  snake: {
    label: TEXT.HUB_PRESET_SNAKE,
    hint: TEXT.HUB_PRESET_SNAKE_HINT,
    swatch: 'bg-[conic-gradient(from_0deg,transparent,#6ea8ff,transparent_60%,#2fd3c0,transparent)]',
  },
  terminal: {
    label: TEXT.HUB_PRESET_TERMINAL,
    hint: TEXT.HUB_PRESET_TERMINAL_HINT,
    swatch: 'bg-[#0b0f0b]',
  },
};

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}): JSX.Element {
  return (
    <div className="space-y-0.5">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
      {hint ? <p className="pl-6 text-xs opacity-60">{hint}</p> : null}
    </div>
  );
}

export function HubTab({ config, onChange }: HubTabProps): JSX.Element {
  const voice = config.voice;
  const patch = (updates: Partial<AppConfig['voice']>): void => {
    onChange({ voice: { ...voice, ...updates } });
  };

  const quick = voice.hubQuickActions;
  const quickOrdered = [...quick, ...HUB_ACTION_IDS.filter((id) => !quick.includes(id))];
  const moveQuick = (id: HubActionId, delta: -1 | 1): void => {
    const index = quick.indexOf(id);
    const next = [...quick];
    const target = index + delta;
    if (index < 0 || target < 0 || target >= next.length) {
      return;
    }
    [next[index], next[target]] = [next[target], next[index]];
    patch({ hubQuickActions: next });
  };
  const toggleQuick = (id: HubActionId): void => {
    patch({
      hubQuickActions: quick.includes(id) ? quick.filter((entry) => entry !== id) : [...quick, id],
    });
  };

  const dot = voice.hubDotActions;
  const moveDot = (id: HubActionId, delta: -1 | 1): void => {
    const index = dot.indexOf(id);
    const next = [...dot];
    const target = index + delta;
    if (index < 0 || target < 0 || target >= next.length) {
      return;
    }
    [next[index], next[target]] = [next[target], next[index]];
    patch({ hubDotActions: next });
  };
  const toggleDot = (id: HubActionId): void => {
    patch({
      hubDotActions: dot.includes(id) ? dot.filter((entry) => entry !== id) : [...dot, id],
    });
  };

  const isEdge = voice.speechHudStyle === 'edge';

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold">{TEXT.SETTINGS_NAV_HUB}</h3>
        <p className="text-xs opacity-60">{TEXT.SETTINGS_NAV_HUB_DESCRIPTION}</p>
      </div>

      <section className="space-y-3">
        <h4 className="text-sm font-medium">{TEXT.HUB_SECTION_APPEARANCE}</h4>
        <fieldset className="space-y-1">
          <legend className="text-xs font-medium opacity-80">{TEXT.VOICE_SPEECH_HUD_STYLE}</legend>
          <div className="grid grid-cols-2 gap-2">
            {HUD_STYLE_OPTIONS.map((option) => {
              const selected = voice.speechHudStyle === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => patch({ speechHudStyle: option.value })}
                  className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors ${
                    selected
                      ? 'border-[var(--as-primary)] bg-[var(--as-primary)]/10'
                      : 'border-[var(--as-border)] hover:bg-[var(--as-secondary)]'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`shrink-0 border border-[var(--as-primary)] bg-[var(--as-primary)]/25 ${option.preview}`}
                  />
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>
          <p className="text-xs opacity-60">{TEXT.VOICE_SPEECH_HUD_STYLE_HINT}</p>
        </fieldset>

        <div className="space-y-2">
          <span className="text-xs font-medium opacity-80">{TEXT.VOICE_SPEECH_HUD_POSITION}</span>
          {!isEdge && voice.speechHudStyle === 'card' && (
            <div className="grid grid-cols-2 gap-2" role="group" aria-label={TEXT.VOICE_SPEECH_HUD_POSITION}>
              {HUD_CORNERS.map((option) => {
                const selected = voice.speechHudCorner === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => patch({ speechHudCorner: option.value })}
                    className={positionButtonClass(selected)}
                  >
                    <HudPositionGlyph marker={HUD_CORNER_MARKERS[option.value]} />
                    <span>{option.label}</span>
                  </button>
                );
              })}
            </div>
          )}
          {isEdge && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2" role="group" aria-label={TEXT.VOICE_SPEECH_HUD_DOCK}>
                {HUD_DOCKS.map((option) => {
                  const selected = voice.speechHudEdgeSide === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => patch({ speechHudEdgeSide: option.value })}
                      className={positionButtonClass(selected)}
                    >
                      <HudPositionGlyph marker={HUD_DOCK_MARKERS[option.value]} />
                      <span>{option.label}</span>
                    </button>
                  );
                })}
              </div>
              <label className="block space-y-1">
                <span className="flex items-center justify-between text-xs opacity-80">
                  <span>{TEXT.VOICE_SPEECH_HUD_ALONG_EDGE}</span>
                  <span className="tabular-nums opacity-70">{Math.round(voice.speechHudEdgeRatio * 100)}%</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  aria-label={TEXT.VOICE_SPEECH_HUD_ALONG_EDGE}
                  value={Math.round(voice.speechHudEdgeRatio * 100)}
                  onChange={(e) => patch({ speechHudEdgeRatio: Number(e.target.value) / 100 })}
                  className="w-full accent-[var(--as-primary)]"
                />
              </label>
              <p className="text-xs opacity-60">{TEXT.VOICE_SPEECH_HUD_EDGE_HINT}</p>
            </div>
          )}
          {voice.speechHudStyle === 'dot' && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--as-border)] px-3 py-2">
              <p className="text-xs opacity-70">{TEXT.VOICE_SPEECH_HUD_FREE_POSITION}</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => patch({ speechHudDotXRatio: 1, speechHudDotYRatio: 1 })}
              >
                {TEXT.VOICE_SPEECH_HUD_RESET_POSITION}
              </Button>
            </div>
          )}
        </div>

        <SelectField
          id="hub-posture-select"
          label={TEXT.VOICE_SPEECH_HUD_POSTURE}
          value={voice.speechHudPosture}
          onChange={(value) => patch({ speechHudPosture: value as AppConfig['voice']['speechHudPosture'] })}
          options={HUD_POSTURES}
        />
        <Toggle
          checked={voice.hudContentProtection}
          onChange={(checked) => patch({ hudContentProtection: checked })}
          label={TEXT.VOICE_HUD_CONTENT_PROTECTION}
          hint={TEXT.VOICE_HUD_CONTENT_PROTECTION_HINT}
        />

        {isEdge && (
          <div className="space-y-2 rounded-lg border border-[var(--as-border)] p-3">
            <SelectField
              id="hub-dock-text-select"
              label={TEXT.HUB_DOCK_TEXT}
              value={voice.hubDockText}
              onChange={(value) => patch({ hubDockText: value as AppConfig['voice']['hubDockText'] })}
              options={[
                { value: 'off', label: TEXT.HUB_DOCK_TEXT_OFF },
                { value: 'latest', label: TEXT.HUB_DOCK_TEXT_ON },
              ]}
            />
            <p className="text-xs opacity-60">{TEXT.HUB_DOCK_TEXT_HINT}</p>
            <p className="text-xs opacity-60">{TEXT.HUB_PRIVACY_HINT}</p>
          </div>
        )}

        {isEdge && <HudSizeControl voice={voice} onChange={patch} />}
      </section>

      <section className="space-y-3">
        <h4 className="text-sm font-medium">{TEXT.HUB_SECTION_ACTIONS}</h4>
        <Field label={TEXT.HUB_QUICK_ACTIONS} hint={TEXT.HUB_QUICK_ACTIONS_HINT} htmlFor="hub-quick-actions">
          <ol className="space-y-1">
            {quickOrdered.map((id) => {
              const def = HUB_ACTIONS[id];
              const enabled = quick.includes(id);
              const index = quick.indexOf(id);
              return (
                <li
                  key={id}
                  className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs ${
                    enabled ? 'border-[var(--as-border)]' : 'border-transparent opacity-60'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={() => toggleQuick(id)}
                    aria-label={`${TEXT.HUB_QUICK_ACTIONS}: ${def.label}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{def.label}</span>
                    <span className="block opacity-60">{def.hint}</span>
                  </span>
                  {enabled && (
                    <span className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        className="rounded border border-[var(--as-border)] px-1.5 py-0.5"
                        aria-label={`${TEXT.HUB_MOVE_UP} (${TEXT.HUB_QUICK_ACTIONS}): ${def.label}`}
                        disabled={index <= 0}
                        onClick={() => moveQuick(id, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="rounded border border-[var(--as-border)] px-1.5 py-0.5"
                        aria-label={`${TEXT.HUB_MOVE_DOWN} (${TEXT.HUB_QUICK_ACTIONS}): ${def.label}`}
                        disabled={index < 0 || index >= quick.length - 1}
                        onClick={() => moveQuick(id, 1)}
                      >
                        ↓
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              patch({ hubQuickActions: [...DEFAULT_HUB_QUICK_ACTIONS] })
            }
          >
            {TEXT.HUB_RESET_ACTIONS}
          </Button>
        </div>

      </section>

      <section className="space-y-3">
        <h4 className="text-sm font-medium">{TEXT.HUB_DOT_ACTIONS}</h4>
        {voice.speechHudStyle === 'dot' ? (
          <>
            <Field label={TEXT.HUB_DOT_ACTIONS} hint={TEXT.HUB_DOT_ACTIONS_HINT} htmlFor="hub-dot-actions">
              <ol className="space-y-1">
                {HUB_DOT_ACTION_IDS.map((id) => {
                  const def = HUB_ACTIONS[id];
                  const enabled = dot.includes(id);
                  const index = dot.indexOf(id);
                  return (
                    <li
                      key={id}
                      className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs ${
                        enabled ? 'border-[var(--as-border)]' : 'border-transparent opacity-60'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={() => toggleDot(id)}
                        aria-label={`${TEXT.HUB_DOT_ACTIONS}: ${def.label}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{def.label}</span>
                        <span className="block opacity-60">{def.hint}</span>
                      </span>
                      {enabled && (
                        <span className="flex shrink-0 gap-1">
                          <button
                            type="button"
                            className="rounded border border-[var(--as-border)] px-1.5 py-0.5"
                            aria-label={`${TEXT.HUB_MOVE_UP} (${TEXT.HUB_DOT_ACTIONS}): ${def.label}`}
                            disabled={index <= 0}
                            onClick={() => moveDot(id, -1)}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="rounded border border-[var(--as-border)] px-1.5 py-0.5"
                            aria-label={`${TEXT.HUB_MOVE_DOWN} (${TEXT.HUB_DOT_ACTIONS}): ${def.label}`}
                            disabled={index < 0 || index >= dot.length - 1}
                            onClick={() => moveDot(id, 1)}
                          >
                            ↓
                          </button>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => patch({ hubDotActions: [...DEFAULT_HUB_DOT_ACTIONS] })}
              >
                {TEXT.HUB_RESET_ACTIONS}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-xs opacity-60">{TEXT.HUB_DOT_ACTIONS_NEEDS_DOT}</p>
        )}
      </section>

      <section className="space-y-3">
        <h4 className="text-sm font-medium">{TEXT.HUB_SECTION_STUDIO}</h4>
        <div className="grid gap-2 sm:grid-cols-2">
          {HUD_PRESETS.map((preset) => {
            const meta = PRESET_LABELS[preset];
            const selected = voice.hudPreset === preset;
            return (
              <button
                key={preset}
                type="button"
                aria-pressed={selected}
                onClick={() => patch({ hudPreset: preset })}
                className={`flex items-start gap-2 rounded-lg border p-2.5 text-left text-xs transition-colors ${
                  selected
                    ? 'border-[var(--as-primary)] bg-[var(--as-primary)]/10'
                    : 'border-[var(--as-border)] hover:bg-[var(--as-secondary)]'
                }`}
              >
                <span aria-hidden="true" className={`mt-0.5 h-8 w-8 shrink-0 rounded-md border border-[var(--as-border)] ${meta.swatch}`} />
                <span className="min-w-0">
                  <span className="block font-medium">{meta.label}</span>
                  <span className="block opacity-60">{meta.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
        <Toggle
          checked={voice.hudMotion}
          onChange={(checked) => patch({ hudMotion: checked })}
          label={TEXT.HUB_MOTION}
          hint={TEXT.HUB_MOTION_HINT}
        />
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-medium">{TEXT.HUB_SECTION_RESULTS}</h4>
        <label className="block space-y-1">
          <span className="flex items-center justify-between text-xs opacity-80">
            <span>{TEXT.HUB_RESULT_AUTO_HIDE}</span>
            <span className="tabular-nums opacity-70">{Math.round(voice.hubResultAutoHideMs / 1000)}s</span>
          </span>
          <input
            type="range"
            min={3}
            max={60}
            step={1}
            aria-label={TEXT.HUB_RESULT_AUTO_HIDE}
            value={Math.round(voice.hubResultAutoHideMs / 1000)}
            onChange={(e) => patch({ hubResultAutoHideMs: Number(e.target.value) * 1000 })}
            className="w-full accent-[var(--as-primary)]"
          />
          <p className="text-xs opacity-60">{TEXT.HUB_RESULT_AUTO_HIDE_HINT}</p>
        </label>
      </section>
    </div>
  );
}
