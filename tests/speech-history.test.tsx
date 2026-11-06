// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { RecentSpeechPanel } from '@renderer/chat-react/RecentSpeechPanel';
import type { SpeechHistoryEntry } from '@shared/speech';
import { TEXT, interpolate } from '@shared/constants/text';

afterEach(cleanup);

const ENTRIES: SpeechHistoryEntry[] = [
  {
    utteranceId: 12,
    source: 'selection',
    preview: 'The first selected paragraph.',
    at: 1_700_000_000_000,
    chunks: 4,
    cached: 3,
    synthesisCalls: 1,
  },
  {
    utteranceId: 11,
    source: 'reply',
    preview: 'An assistant reply read aloud.',
    at: 1_700_000_000_000,
    chunks: 1,
    cached: 0,
    synthesisCalls: 1,
  },
];

function installApi(entries: SpeechHistoryEntry[]) {
  const api = {
    getSpeechHistory: vi.fn(async () => entries.map((entry) => ({ ...entry }))),
    replaySpeech: vi.fn(async () => 'started'),
  };
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: api });
  return api;
}

describe('Recent speech panel (plan 58 S6b)', () => {
  it('lists source, preview, cached ratio and call count', async () => {
    installApi(ENTRIES);
    render(<RecentSpeechPanel onClose={vi.fn()} />);
    expect(await screen.findByText(ENTRIES[0].preview)).toBeTruthy();
    expect(screen.getByText(new RegExp(interpolate(TEXT.SPEECH_HISTORY_CACHED, { cached: 3, chunks: 4 })))).toBeTruthy();
    expect(
      screen.getAllByText(new RegExp(interpolate(TEXT.SPEECH_HISTORY_CALLS, { calls: 1 }))).length
    ).toBeGreaterThan(0);
    expect(screen.getByText(new RegExp(TEXT.SPEECH_SOURCE_SELECTION))).toBeTruthy();
  });

  it('replays by utterance id through the bus', async () => {
    const api = installApi(ENTRIES);
    render(<RecentSpeechPanel onClose={vi.fn()} />);
    const replay = await screen.findByRole('button', { name: `${TEXT.SPEECH_HISTORY_REPLAY}: ${ENTRIES[0].preview}` });
    replay.click();
    await waitFor(() => expect(api.replaySpeech).toHaveBeenCalledWith(12));
  });

  it('shows an honest empty state', async () => {
    installApi([]);
    render(<RecentSpeechPanel onClose={vi.fn()} />);
    expect(await screen.findByText(TEXT.SPEECH_HISTORY_EMPTY)).toBeTruthy();
  });

  it('closes', () => {
    installApi(ENTRIES);
    const onClose = vi.fn();
    render(<RecentSpeechPanel onClose={onClose} />);
    screen.getByRole('button', { name: TEXT.CLOSE_BUTTON }).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('has no axe violations', async () => {
    installApi(ENTRIES);
    const { container } = render(<RecentSpeechPanel onClose={vi.fn()} />);
    await screen.findByText(ENTRIES[0].preview);
    const results = await axe.run(container);
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
