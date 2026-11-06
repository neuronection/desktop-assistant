import { describe, it, expect } from 'vitest';
import { StreamPacer } from '@renderer/chat-react/streamDisplay/pacer';
import { completeWordUnits } from '@shared/text/segment';

function makeClock(): { now: () => number; advance: (ms: number) => void } {
  let current = 0;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

const SOURCE = 'Καλημέρα σε όλους!';
const TOKENS = ['Καλη', 'μέρα', ' σε', ' όλ', 'ους', '!'];

describe('StreamPacer', () => {
  it('never commits partial words and stays lossless on a sub-token stream', () => {
    const clock = makeClock();
    const pacer = new StreamPacer({ now: clock.now });
    let received = '';
    for (const token of TOKENS) {
      received += token;
      pacer.push(received);
      clock.advance(20);
      pacer.tick();
      expect(pacer.committed + pacer.pending).toBe(pacer.received);
      expect(pacer.committed).toBe(SOURCE.slice(0, pacer.committed.length));
      expect(completeWordUnits(pacer.committed).rest).toBe('');
    }
    expect(pacer.committed).toBe('Καλημέρα σε ');
    expect(pacer.pending).toBe('όλους!');
  });

  it('flush releases the remainder including a partial trailing word', () => {
    const clock = makeClock();
    const pacer = new StreamPacer({ now: clock.now });
    pacer.push(SOURCE);
    clock.advance(50);
    const segments = pacer.flush();
    expect(pacer.committed).toBe(SOURCE);
    expect(pacer.pending).toBe('');
    expect(segments.map((segment) => segment.text).join('')).toBe(SOURCE);
  });

  it('bounds the commit cadence and grows units into phrases on a fast stream', () => {
    const clock = makeClock();
    const pacer = new StreamPacer({ now: clock.now });
    const words = Array.from({ length: 60 }, (_, index) => `λεξ${index} `).join('');
    for (let index = 0; index < words.length; index += 15) {
      pacer.push(words.slice(0, index + 15));
      clock.advance(5);
    }
    const segments: string[] = [];
    for (let tick = 0; tick < 10; tick += 1) {
      clock.advance(100);
      for (const segment of pacer.tick()) {
        segments.push(segment.text);
      }
    }
    expect(segments.length).toBeLessThanOrEqual(10);
    expect(segments.length).toBeGreaterThanOrEqual(2);
    const wordsPerSegment = segments.map((text) => text.trim().split(/\s+/).length);
    expect(Math.max(...wordsPerSegment)).toBeGreaterThan(1);
    pacer.flush();
    expect(pacer.committed).toBe(words);
  });

  it('commits single words promptly on a slow stream', () => {
    const clock = makeClock();
    const pacer = new StreamPacer({ now: clock.now });
    pacer.push('Καλημέρα ');
    clock.advance(600);
    expect(pacer.tick().map((segment) => segment.text)).toEqual(['Καλημέρα ']);
    pacer.push('φίλοι ');
    clock.advance(600);
    expect(pacer.tick().map((segment) => segment.text)).toEqual(['φίλοι ']);
  });

  it('stays lossless when the stream starts with blank lines', () => {
    const clock = makeClock();
    const pacer = new StreamPacer({ now: clock.now });
    const source = '\n\nΚαλημέρα σε όλους! ';
    pacer.push(source);
    for (let tick = 0; tick < 10; tick += 1) {
      clock.advance(100);
      pacer.tick();
      expect(pacer.committed + pacer.pending).toBe(pacer.received);
      expect(source.startsWith(pacer.committed)).toBe(true);
    }
    pacer.flush();
    expect(pacer.committed).toBe(source);
  });

  it('resets when the stream text is rewritten (regenerate path)', () => {
    const clock = makeClock();
    const pacer = new StreamPacer({ now: clock.now });
    pacer.push('Καλημέρα σε ');
    pacer.tick();
    clock.advance(20);
    pacer.push('Αντίο!');
    expect(pacer.received).toBe('Αντίο!');
    expect(pacer.committed).toBe('');
    expect(pacer.pending).toBe('Αντίο!');
  });
});
