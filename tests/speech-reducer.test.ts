import { describe, it, expect } from 'vitest';
import {
  SPEECH_INITIAL,
  isSpeechActive,
  reduceSpeech,
  speechPreempts,
  type SpeechAction,
  type SpeechSnapshot,
} from '@shared/speech';

function run(actions: SpeechAction[], from: SpeechSnapshot = SPEECH_INITIAL): SpeechSnapshot {
  return actions.reduce(reduceSpeech, from);
}

function utterance(source: SpeechSnapshot['source'], utteranceId = 1, chunkCount = 2): SpeechSnapshot {
  return run([{ type: 'start', utteranceId, source: source ?? 'reply', chunkCount }]);
}

function speaking(source: SpeechSnapshot['source'] = 'reply'): SpeechSnapshot {
  return run([
    { type: 'start', utteranceId: 1, source: source ?? 'reply', chunkCount: 2 },
    { type: 'chunk_ready', utteranceId: 1, chunkIndex: 0, chunkText: 'First chunk.' },
    { type: 'fact', fact: { utteranceId: 1, chunkIndex: 0, fact: 'chunk_started' } },
  ]);
}

describe('speech source-weighted preemption (plan 58 D6)', () => {
  it('lets an explicit gesture preempt an automatic utterance', () => {
    expect(speechPreempts(null, 'reply')).toBe(true);
    expect(speechPreempts('reply', 'selection')).toBe(true);
    expect(speechPreempts('replay', 'selection')).toBe(true);
    expect(speechPreempts('reply', 'clipboard')).toBe(true);
    expect(speechPreempts('reply', 'preview')).toBe(true);
  });

  it('never lets an automatic utterance preempt an explicit one', () => {
    expect(speechPreempts('selection', 'reply')).toBe(false);
    expect(speechPreempts('selection', 'replay')).toBe(false);
    expect(speechPreempts('clipboard', 'reply')).toBe(false);
    expect(speechPreempts('preview', 'reply')).toBe(false);
    expect(speechPreempts('selection', 'preview')).toBe(false);
    expect(speechPreempts('reply', 'replay')).toBe(false);
  });

  it('never preempts the same source — that is the queue rule', () => {
    expect(speechPreempts('reply', 'reply')).toBe(false);
    expect(speechPreempts('selection', 'selection')).toBe(false);
  });
});

describe('speech reducer — utterance lifecycle', () => {
  it('starts idle and enters synthesizing on a request', () => {
    expect(SPEECH_INITIAL.state).toBe('idle');
    expect(isSpeechActive(SPEECH_INITIAL.state)).toBe(false);
    const started = utterance('selection');
    expect(started).toMatchObject({
      state: 'synthesizing',
      source: 'selection',
      utteranceId: 1,
      chunkIndex: 0,
      chunkCount: 2,
      chunkText: '',
      resumeTo: null,
      dismissed: false,
      lastError: null,
    });
    expect(isSpeechActive(started.state)).toBe(true);
  });

  it('walks synthesizing → speaking → idle at the last chunk', () => {
    let snapshot = speaking();
    expect(snapshot).toMatchObject({ state: 'speaking', chunkIndex: 0, chunkText: 'First chunk.' });
    snapshot = reduceSpeech(snapshot, {
      type: 'fact',
      fact: { utteranceId: 1, chunkIndex: 0, fact: 'ended' },
    });
    expect(snapshot).toMatchObject({ state: 'speaking', chunkIndex: 1 });
    snapshot = reduceSpeech(snapshot, {
      type: 'chunk_ready',
      utteranceId: 1,
      chunkIndex: 1,
      chunkText: 'Second chunk.',
    });
    snapshot = reduceSpeech(snapshot, { type: 'fact', fact: { utteranceId: 1, chunkIndex: 1, fact: 'chunk_started' } });
    expect(snapshot.chunkText).toBe('Second chunk.');
    snapshot = reduceSpeech(snapshot, { type: 'fact', fact: { utteranceId: 1, chunkIndex: 1, fact: 'ended' } });
    expect(snapshot).toMatchObject({ state: 'idle', source: null, chunkIndex: 0, chunkCount: 0, chunkText: '' });
  });

  it('keeps the id monotonic and refuses a replayed start', () => {
    const finished = run([
      { type: 'start', utteranceId: 4, source: 'reply', chunkCount: 1 },
      { type: 'fact', fact: { utteranceId: 4, chunkIndex: 0, fact: 'chunk_started' } },
      { type: 'fact', fact: { utteranceId: 4, chunkIndex: 0, fact: 'ended' } },
    ]);
    expect(finished.state).toBe('idle');
    expect(finished.utteranceId).toBe(4);
    expect(reduceSpeech(finished, { type: 'start', utteranceId: 4, source: 'selection', chunkCount: 1 })).toBe(finished);
    expect(reduceSpeech(finished, { type: 'start', utteranceId: 5, source: 'selection', chunkCount: 1 }).state).toBe(
      'synthesizing'
    );
  });

  it('returns the same snapshot for same-source requests while active (no inference)', () => {
    const snapshot = speaking('reply');
    expect(reduceSpeech(snapshot, { type: 'start', utteranceId: 2, source: 'reply', chunkCount: 3 })).toBe(snapshot);
    expect(reduceSpeech(snapshot, { type: 'start', utteranceId: 2, source: 'replay', chunkCount: 3 })).toBe(snapshot);
  });

  it('preempts a speaking reply with a selection request', () => {
    const replaced = reduceSpeech(speaking('reply'), {
      type: 'start',
      utteranceId: 2,
      source: 'selection',
      chunkCount: 4,
    });
    expect(replaced).toMatchObject({
      state: 'synthesizing',
      source: 'selection',
      utteranceId: 2,
      chunkIndex: 0,
      chunkCount: 4,
      chunkText: '',
    });
  });

  it('refuses a reply request while a selection speaks', () => {
    const snapshot = speaking('selection');
    expect(reduceSpeech(snapshot, { type: 'start', utteranceId: 2, source: 'reply', chunkCount: 3 })).toBe(snapshot);
  });
});

describe('speech reducer — stale facts', () => {
  it('drops facts from a prior utterance', () => {
    const snapshot = speaking();
    const stale = { type: 'fact' as const, fact: { utteranceId: 0, chunkIndex: 0, fact: 'ended' as const } };
    expect(reduceSpeech(snapshot, stale)).toBe(snapshot);
  });

  it('drops facts from an earlier chunk of the current utterance', () => {
    const snapshot = run([
      { type: 'start', utteranceId: 1, source: 'reply', chunkCount: 3 },
      { type: 'fact', fact: { utteranceId: 1, chunkIndex: 1, fact: 'chunk_started' } },
    ]);
    const late = {
      type: 'fact' as const,
      fact: { utteranceId: 1, chunkIndex: 0, fact: 'ended' as const },
    };
    expect(reduceSpeech(snapshot, late)).toBe(snapshot);
  });

  it('drops chunk-ready and facts while idle', () => {
    expect(reduceSpeech(SPEECH_INITIAL, { type: 'chunk_ready', utteranceId: 1, chunkIndex: 0, chunkText: 'x' })).toBe(
      SPEECH_INITIAL
    );
    expect(
      reduceSpeech(SPEECH_INITIAL, { type: 'fact', fact: { utteranceId: 0, chunkIndex: 0, fact: 'ended' } })
    ).toBe(SPEECH_INITIAL);
  });
});

describe('speech reducer — pause latch (plan 58 §4.4 / race 11)', () => {
  it('pauses during synthesizing and does not start when a chunk arrives', () => {
    let snapshot = reduceSpeech(utterance('selection'), { type: 'pause' });
    expect(snapshot).toMatchObject({ state: 'paused', resumeTo: 'synthesizing' });
    snapshot = reduceSpeech(snapshot, { type: 'chunk_ready', utteranceId: 1, chunkIndex: 0, chunkText: 'Hello.' });
    expect(snapshot.state).toBe('paused');
    snapshot = reduceSpeech(snapshot, {
      type: 'fact',
      fact: { utteranceId: 1, chunkIndex: 0, fact: 'chunk_started' },
    });
    expect(snapshot.state).toBe('paused');
    expect(snapshot.chunkText).toBe('Hello.');
  });

  it('resumes a latched synthesis back into synthesizing', () => {
    const latched = run([{ type: 'start', utteranceId: 1, source: 'selection', chunkCount: 2 }, { type: 'pause' }]);
    const resumed = reduceSpeech(latched, { type: 'resume' });
    expect(resumed).toMatchObject({ state: 'synthesizing', resumeTo: null });
    expect(
      reduceSpeech(resumed, { type: 'fact', fact: { utteranceId: 1, chunkIndex: 0, fact: 'chunk_started' } }).state
    ).toBe('speaking');
  });

  it('pauses and resumes while speaking', () => {
    const paused = reduceSpeech(speaking(), { type: 'pause' });
    expect(paused).toMatchObject({ state: 'paused', resumeTo: 'speaking' });
    expect(reduceSpeech(paused, { type: 'resume' })).toMatchObject({ state: 'speaking', resumeTo: null });
  });

  it('ignores ended facts while paused and keeps pause idempotent', () => {
    const paused = reduceSpeech(speaking(), { type: 'pause' });
    const late = reduceSpeech(paused, {
      type: 'fact',
      fact: { utteranceId: 1, chunkIndex: 0, fact: 'ended' },
    });
    expect(late).toBe(paused);
    expect(reduceSpeech(paused, { type: 'pause' })).toBe(paused);
    expect(reduceSpeech(SPEECH_INITIAL, { type: 'pause' })).toBe(SPEECH_INITIAL);
    expect(reduceSpeech(speaking(), { type: 'resume' }).state).toBe('speaking');
  });
});

describe('speech reducer — stop, dismiss, errors', () => {
  it('stops from any active state and is a no-op when idle', () => {
    expect(reduceSpeech(speaking(), { type: 'stop' })).toMatchObject({
      state: 'idle',
      source: null,
      utteranceId: 1,
      chunkIndex: 0,
    });
    expect(reduceSpeech(SPEECH_INITIAL, { type: 'stop' })).toBe(SPEECH_INITIAL);
  });

  it('dismisses the HUD for the utterance and re-arms on the next start', () => {
    const dismissed = reduceSpeech(speaking(), { type: 'dismiss' });
    expect(dismissed.dismissed).toBe(true);
    expect(reduceSpeech(dismissed, { type: 'dismiss' })).toBe(dismissed);
    const restarted = reduceSpeech(dismissed, {
      type: 'start',
      utteranceId: 2,
      source: 'selection',
      chunkCount: 1,
    });
    expect(restarted.dismissed).toBe(false);
  });

  it('turns a playback error into an idle flash, not a state', () => {
    const failed = reduceSpeech(speaking(), {
      type: 'fact',
      fact: { utteranceId: 1, chunkIndex: 0, fact: 'error', detail: 'playback_device_lost' },
    });
    expect(failed).toMatchObject({ state: 'idle', source: null, lastError: 'playback_device_lost' });
    const next = reduceSpeech(failed, { type: 'start', utteranceId: 2, source: 'reply', chunkCount: 1 });
    expect(next.lastError).toBeNull();
  });
});
