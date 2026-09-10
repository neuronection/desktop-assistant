import { describe, it, expect } from 'vitest';
import { hasSpeechEvidence, isRepetitionLoop, sanitizeTranscript } from '@main/ai/stt';

describe('sanitizeTranscript', () => {
  it('passes real speech through', () => {
    expect(sanitizeTranscript('  What is the capital of France? ')).toBe('What is the capital of France?');
  });

  it('rejects empty and whitespace-only transcripts', () => {
    expect(sanitizeTranscript('')).toBeNull();
    expect(sanitizeTranscript('   ')).toBeNull();
    expect(sanitizeTranscript(null)).toBeNull();
    expect(sanitizeTranscript(undefined)).toBeNull();
  });

  it('rejects no-speech service notices (the leak-from-screenshot class)', () => {
    expect(sanitizeTranscript('819. No significant text. (No text to output) [No text detected]')).toBeNull();
    expect(sanitizeTranscript('No significant text detected in the audio segment.')).toBeNull();
    expect(sanitizeTranscript('[inaudible]')).toBeNull();
    expect(sanitizeTranscript('(silence)')).toBeNull();
  });

  it('rejects classic whisper hallucinations on silence/noise', () => {
    expect(sanitizeTranscript('Thank you for watching!')).toBeNull();
    expect(sanitizeTranscript('Please subscribe to the channel')).toBeNull();
    expect(sanitizeTranscript('Subtitles by the Amara.org community')).toBeNull();
    expect(sanitizeTranscript('Thank you.')).toBeNull();
    expect(sanitizeTranscript('What is the capital of France?')).toBe('What is the capital of France?');
    expect(sanitizeTranscript('Thank you for coming to my birthday party')).toBe('Thank you for coming to my birthday party');
  });

  it('rejects repetition loops (decoding artifacts)', () => {
    expect(isRepetitionLoop('the the the the the the')).toBe(true);
    expect(isRepetitionLoop('ich ich ich ich ich ich ich')).toBe(true);
    expect(isRepetitionLoop('Please subscribe. Please subscribe. Please subscribe. Please subscribe.')).toBe(true);
    expect(isRepetitionLoop('I went to the store and the store was closed')).toBe(false);
    expect(isRepetitionLoop('hello')).toBe(false);
  });
});

describe('hasSpeechEvidence', () => {
  it('assumes speech when the model gives no segment data', () => {
    expect(hasSpeechEvidence(undefined)).toBe(true);
    expect(hasSpeechEvidence([])).toBe(true);
  });

  it('rejects when every segment looks like silence or low confidence', () => {
    expect(hasSpeechEvidence([{ no_speech_prob: 0.9, avg_logprob: -0.2 }])).toBe(false);
    expect(hasSpeechEvidence([{ no_speech_prob: 0.1, avg_logprob: -2.5 }])).toBe(false);
    expect(hasSpeechEvidence([
      { no_speech_prob: 0.9, avg_logprob: -0.2 },
      { no_speech_prob: 0.8, avg_logprob: -1.4 },
    ])).toBe(false);
  });

  it('accepts when at least one segment carries real speech', () => {
    expect(hasSpeechEvidence([
      { no_speech_prob: 0.9, avg_logprob: -0.2 },
      { no_speech_prob: 0.1, avg_logprob: -0.4 },
    ])).toBe(true);
  });
});
