import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  fitHistory,
  messageTokenCost,
  toAiMessages,
  IMAGE_TOKEN_ESTIMATE,
  MAX_HISTORY_IMAGES,
  MESSAGE_OVERHEAD_TOKENS,
  PDF_HISTORY_CHAR_CAP,
} from '@main/turns/history';
import { MessageRole, type Message } from '@shared/database-types';
import type { AIMessage, Attachment } from '@shared/types';

function dbMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm',
    role: MessageRole.USER,
    content: 'hello',
    conversationId: 'conv',
    createdAt: new Date(),
    attachments: [],
    ...overrides,
  } as Message;
}

function imageAttachment(name: string): Attachment {
  return { type: 'image', data: `data:image/png;base64,${name}`, filename: name } as Attachment;
}

function userMsg(text: string, images = 0): AIMessage {
  const content: AIMessage['content'] =
    images > 0
      ? [{ type: 'text', text }, ...Array.from({ length: images }, (_, index) => ({ type: 'image_url' as const, image_url: { url: `img://${index}` } }))]
      : text;
  return { role: 'user', content };
}

function assistantMsg(text: string): AIMessage {
  return { role: 'assistant', content: text };
}

describe('estimateTokens (plan 17 D10 heuristic)', () => {
  it('weights latin text at ~4 chars per token', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a'.repeat(400))).toBe(100);
    expect(estimateTokens('a'.repeat(401))).toBe(101);
  });

  it('weights CJK glyphs at ~1 token per character', () => {
    expect(estimateTokens('確認確認確認')).toBe(6);
    expect(estimateTokens('確認確認確認')).toBeGreaterThan(estimateTokens('abcdefabcdef'));
  });

  it('counts message cost with overhead and image estimates', () => {
    expect(messageTokenCost({ role: 'user', content: 'a'.repeat(40) })).toBe(MESSAGE_OVERHEAD_TOKENS + 10);
    expect(messageTokenCost(userMsg('hi', 2))).toBe(MESSAGE_OVERHEAD_TOKENS + estimateTokens('hi') + 2 * IMAGE_TOKEN_ESTIMATE);
  });
});

describe('toAiMessages attachment clamps (plan 17 S2)', () => {
  it('clamps PDF extracted text on the history path with a truncation marker', () => {
    const messages = [
      dbMessage({
        attachments: [
          { type: 'pdf', filename: 'big.pdf', extractedText: 'x'.repeat(PDF_HISTORY_CHAR_CAP + 500) } as Attachment,
        ],
      }),
    ];

    const shaped = toAiMessages(messages)[0];
    const text = (shaped.content as { type: 'text'; text: string }[])[0].text;
    expect(text).toContain('[truncated 500 chars]');
    expect(text.length).toBeLessThan(PDF_HISTORY_CHAR_CAP + 500);
  });

  it('caps the per-message image count', () => {
    const messages = [
      dbMessage({ attachments: Array.from({ length: 6 }, (_, index) => imageAttachment(`img${index}`)) }),
    ];

    const shaped = toAiMessages(messages)[0];
    const parts = shaped.content as { type: string }[];
    expect(parts.filter((part) => part.type === 'image_url')).toHaveLength(MAX_HISTORY_IMAGES);
  });

  it('leaves plain messages untouched', () => {
    const shaped = toAiMessages([dbMessage({ role: MessageRole.ASSISTANT, content: 'plain answer' })])[0];
    expect(shaped).toEqual({ role: 'assistant', content: 'plain answer' });
  });
});

describe('fitHistory (plan 17 S2)', () => {
  it('is byte-identical when the conversation is under budget', () => {
    const messages = [userMsg('one'), assistantMsg('answer one'), userMsg('two'), assistantMsg('answer two')];
    const fitted = fitHistory(messages, 10_000);

    expect(fitted.messages).toEqual(messages);
    expect(fitted.report).toMatchObject({ droppedMessages: 0, droppedTurns: 0 });
  });

  it('drops whole oldest turns until the budget fits, keeping the suffix', () => {
    const messages = [
      userMsg('a'.repeat(400)), // ~100 tokens
      assistantMsg('a'.repeat(400)),
      userMsg('b'.repeat(400)),
      assistantMsg('b'.repeat(400)),
      userMsg('newest question'),
    ];
    const fitted = fitHistory(messages, 300);

    const contents = fitted.messages.map((message) => message.content);
    expect(contents).toContain('newest question');
    expect(contents).toContain('b'.repeat(400));
    expect(contents).not.toContain('a'.repeat(400));
    expect(fitted.messages).toHaveLength(3);
    expect(fitted.report.droppedMessages).toBe(2);
    expect(fitted.report.droppedTurns).toBe(1);
    expect(fitted.report.estimatedTokensAfter).toBeLessThanOrEqual(300);
  });

  it('never drops the final group even when it alone exceeds the budget', () => {
    const big = userMsg('x'.repeat(4_000));
    const fitted = fitHistory([big], 50);

    expect(fitted.messages).toEqual([big]);
    expect(fitted.report.droppedMessages).toBe(0);
  });

  it('handles an empty history', () => {
    expect(fitHistory([], 100)).toEqual({
      messages: [],
      report: { droppedMessages: 0, droppedTurns: 0, estimatedTokensBefore: 0, estimatedTokensAfter: 0 },
    });
  });

  it('suffix semantics: dropping an oversized middle turn drops everything before it', () => {
    const messages = [
      userMsg('keep me one'),
      assistantMsg('answer one'),
      userMsg('x'.repeat(4_000)), // giant turn, ~1000 tokens
      assistantMsg('huge answer'),
      userMsg('newest'),
    ];
    const fitted = fitHistory(messages, 120);

    const contents = fitted.messages.map((message) => message.content);
    expect(contents).toContain('newest');
    expect(contents).not.toContain('x'.repeat(4_000));
    expect(contents).not.toContain('keep me one');
    expect(fitted.report.droppedTurns).toBe(2);
  });
});
