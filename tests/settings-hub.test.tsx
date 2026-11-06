// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import axe from 'axe-core';
import { HubTab } from '@renderer/settings-react/tabs/HubTab';
import { DEFAULT_CONFIG, type AppConfig } from '@shared/config/AppConfig';
import { TEXT } from '@shared/constants/text';
import { chooseOption } from './combobox';

afterEach(cleanup);

function config(overrides: Partial<AppConfig['voice']> = {}): AppConfig {
  return { ...DEFAULT_CONFIG, voice: { ...DEFAULT_CONFIG.voice, ...overrides } };
}

async function expectNoViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container);
  const summary = results.violations.map((v) => `${v.id} (${v.impact})`).join('\n');
  expect(summary).toBe('');
}

describe('Settings → Hub (plan 65/66)', () => {
  it('offers the three HUD styles and patches the flat key', () => {
    const onChange = vi.fn();
    render(<HubTab config={config()} onChange={onChange} />);
    for (const label of [
      TEXT.VOICE_SPEECH_HUD_STYLE_CARD,
      TEXT.VOICE_SPEECH_HUD_STYLE_EDGE,
      TEXT.VOICE_SPEECH_HUD_STYLE_DOT,
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole('button', { name: TEXT.VOICE_SPEECH_HUD_STYLE_DOT }));
    expect(onChange.mock.calls.at(-1)?.[0].voice.speechHudStyle).toBe('dot');
  });

  it('configures the dot buttons only while the dot is the active style', () => {
    const onChange = vi.fn();
    render(<HubTab config={config()} onChange={onChange} />);
    expect(screen.queryByText(TEXT.HUB_DOT_ACTIONS_NEEDS_DOT)).toBeTruthy();
    expect(screen.queryByLabelText(`${TEXT.HUB_DOT_ACTIONS}: ${TEXT.HUB_ACTION_DICTATE}`)).toBeNull();
    cleanup();

    render(<HubTab config={config({ speechHudStyle: 'dot' })} onChange={onChange} />);
    expect(screen.queryByText(TEXT.HUB_DOT_ACTIONS_NEEDS_DOT)).toBeNull();
    const dictate = screen.getByLabelText(`${TEXT.HUB_DOT_ACTIONS}: ${TEXT.HUB_ACTION_DICTATE}`) as HTMLInputElement;
    expect(dictate.checked).toBe(true);
    fireEvent.click(dictate);
    expect(onChange.mock.calls.at(-1)?.[0].voice.hubDotActions).toEqual(['speak-selection', 'live-toggle']);
  });

  it('configures the dock side, position and text mode', () => {
    const onChange = vi.fn();
    render(
      <HubTab
        config={config({ speechHudStyle: 'edge', speechHudEdgeRatio: 0.5, hubDockText: 'latest', hubDockWidth: 'auto' })}
        onChange={onChange}
      />
    );
    for (const [label, side] of [
      [TEXT.VOICE_SPEECH_HUD_DOCK_LEFT, 'left'],
      [TEXT.VOICE_SPEECH_HUD_DOCK_TOP, 'top'],
      [TEXT.VOICE_SPEECH_HUD_DOCK_BOTTOM, 'bottom'],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(onChange.mock.calls.at(-1)?.[0].voice.speechHudEdgeSide).toBe(side);
    }
    const slider = screen.getByLabelText(TEXT.VOICE_SPEECH_HUD_ALONG_EDGE) as HTMLInputElement;
    expect(slider.value).toBe('50');
    fireEvent.change(slider, { target: { value: '75' } });
    expect(onChange.mock.calls.at(-1)?.[0].voice.speechHudEdgeRatio).toBeCloseTo(0.75, 5);

    chooseOption(TEXT.HUB_DOCK_TEXT, TEXT.HUB_DOCK_TEXT_OFF);
    expect(onChange.mock.calls.at(-1)?.[0].voice.hubDockText).toBe('off');
  });

  it('edits posture, content protection and the orb reset', () => {
    const onChange = vi.fn();
    const { rerender } = render(<HubTab config={config()} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(TEXT.VOICE_HUD_CONTENT_PROTECTION));
    expect(onChange.mock.calls.at(-1)?.[0].voice.hudContentProtection).toBe(true);
    chooseOption(TEXT.VOICE_SPEECH_HUD_POSTURE, TEXT.VOICE_SPEECH_HUD_POSTURE_PINNED);
    expect(onChange.mock.calls.at(-1)?.[0].voice.speechHudPosture).toBe('pinned');

    rerender(<HubTab config={config({ speechHudStyle: 'dot', speechHudDotXRatio: 0.2 })} onChange={onChange} />);
    expect(screen.queryByRole('button', { name: TEXT.VOICE_SPEECH_HUD_TOP_RIGHT })).toBeNull();
    expect(screen.queryByText(TEXT.VOICE_SPEECH_HUD_ALONG_EDGE)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: TEXT.VOICE_SPEECH_HUD_RESET_POSITION }));
    expect(onChange.mock.calls.at(-1)?.[0].voice).toMatchObject({ speechHudDotXRatio: 1, speechHudDotYRatio: 1 });
  });

  it('selects a coherent HUD size and applies a custom size', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <HubTab config={config({ speechHudStyle: 'edge' })} onChange={onChange} />
    );
    fireEvent.click(screen.getByRole('button', { name: TEXT.HUB_SIZE_LARGE }));
    expect(onChange.mock.calls.at(-1)?.[0].voice.hudSizePreset).toBe('large');
    fireEvent.click(screen.getByRole('button', { name: TEXT.HUB_SIZE_COMPACT }));
    expect(onChange.mock.calls.at(-1)?.[0].voice.hudSizePreset).toBe('compact');

    rerender(
      <HubTab
        config={config({ speechHudStyle: 'edge', hudSizePreset: 'custom' })}
        onChange={onChange}
      />
    );
    const face = screen.getByLabelText(TEXT.HUB_SIZE_FACE) as HTMLInputElement;
    const control = screen.getByLabelText(TEXT.HUB_SIZE_CONTROL) as HTMLInputElement;
    const text = screen.getByLabelText(TEXT.HUB_SIZE_TEXT) as HTMLInputElement;
    fireEvent.change(face, { target: { value: '240' } });
    fireEvent.change(control, { target: { value: '26' } });
    fireEvent.change(text, { target: { value: '13' } });
    fireEvent.click(screen.getByRole('button', { name: TEXT.HUB_SIZE_APPLY }));
    expect(onChange.mock.calls.at(-1)?.[0].voice).toMatchObject({
      hudSizePreset: 'custom',
      hudCustomSize: { faceWidth: 240, controlSize: 26, textSize: 13 },
    });
  });

  it('orders and toggles popover actions', () => {
    const onChange = vi.fn();
    render(<HubTab config={config({ speechHudStyle: 'edge' })} onChange={onChange} />);

    fireEvent.click(screen.getByRole('checkbox', { name: `${TEXT.HUB_QUICK_ACTIONS}: ${TEXT.HUB_ACTION_DICTATE}` }));
    expect(onChange.mock.calls.at(-1)?.[0].voice.hubQuickActions).not.toContain('dictate');

    fireEvent.click(screen.getByRole('button', { name: `${TEXT.HUB_MOVE_DOWN} (${TEXT.HUB_QUICK_ACTIONS}): ${TEXT.HUB_ACTION_LIVE}` }));
    expect(onChange.mock.calls.at(-1)?.[0].voice.hubQuickActions.slice(0, 2)).toEqual([
      'translate-selection',
      'live-toggle',
    ]);
  });

  it('restores the default actions', () => {
    const onChange = vi.fn();
    render(<HubTab config={config({ hubQuickActions: ['dictate'] })} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: TEXT.HUB_RESET_ACTIONS }));
    expect(onChange.mock.calls.at(-1)?.[0].voice.hubQuickActions).toEqual([
      'live-toggle',
      'translate-selection',
      'speak-selection',
      'dictate',
      'open-assistant',
      'hide-hub',
    ]);
  });

  it('edits the Studio preset, motion and result timeout', () => {
    const onChange = vi.fn();
    render(<HubTab config={config()} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(TEXT.HUB_PRESET_AURORA) }));
    expect(onChange.mock.calls.at(-1)?.[0].voice.hudPreset).toBe('aurora');

    fireEvent.click(screen.getByLabelText(TEXT.HUB_MOTION));
    expect(onChange.mock.calls.at(-1)?.[0].voice.hudMotion).toBe(false);

    fireEvent.change(screen.getByLabelText(TEXT.HUB_RESULT_AUTO_HIDE), { target: { value: '20' } });
    expect(onChange.mock.calls.at(-1)?.[0].voice.hubResultAutoHideMs).toBe(20000);
  });

  it('has no a11y violations', async () => {
    const { container } = render(<HubTab config={config({ speechHudStyle: 'edge' })} onChange={vi.fn()} />);
    await expectNoViolations(container);
  });
});
