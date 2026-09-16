import type { Attachment } from '@shared/types';
import { Message, MessageRole } from '@shared/database-types';
import type { AIMessage } from '@shared/types';
import { truncateText } from '@main/ai/tools/registry';

/**
 * History-context budget (plan 17 S2, D8): a single internal constant,
 * no settings surface. Expressed in heuristic token units — see
 * `estimateTokens` for the ratio assumptions (D10: no tokenizer
 * dependency; the safety net needs ±30 %, not exactness).
 */
export const HISTORY_TOKEN_BUDGET = 100_000;

/** PDF extracted-text cap on the history path (raw storage untouched). */
export const PDF_HISTORY_CHAR_CAP = 20_000;

/** Per-message image cap on the history path (recall_screenshot re-views the rest). */
export const MAX_HISTORY_IMAGES = 4;

/** Vision images are the fattest history items — overestimate to trim early. */
export const IMAGE_TOKEN_ESTIMATE = 1_500;

/** Role/structure overhead per message (tool-call wrappers, separators). */
export const MESSAGE_OVERHEAD_TOKENS = 8;

const CJK_PATTERN = /[\u1100-\u11ff\u3000-\u9fff\uac00-\ud7a3\uf900-\ufaff\uff00-\uffef]/g;

/**
 * Heuristic token estimate (plan 17 D10): CJK glyphs tokenize at
 * roughly one token per character across real tokenizers, while Latin
 * text averages ~4 chars/token; we weight accordingly instead of
 * shipping a per-provider tokenizer.
 */
export function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }
  const cjk = (text.match(CJK_PATTERN) ?? []).length;
  const other = text.length - cjk;
  return cjk + Math.ceil(other / 4);
}

function contentText(content: AIMessage['content']): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => (part.type === 'text' ? part.text : ''))
      .join('\n');
  }
  return '';
}

function contentImageCount(content: AIMessage['content']): number {
  if (!Array.isArray(content)) {
    return 0;
  }
  return content.filter((part) => part.type === 'image_url').length;
}

export function messageTokenCost(message: AIMessage): number {
  return (
    MESSAGE_OVERHEAD_TOKENS +
    estimateTokens(contentText(message.content)) +
    contentImageCount(message.content) * IMAGE_TOKEN_ESTIMATE
  );
}

export interface HistoryFitReport {
  /** Messages dropped from the oldest turns (whole turns only, D7). */
  droppedMessages: number;
  /** Turns (user + replies) dropped entirely. */
  droppedTurns: number;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
}

/**
 * Newest-first history windowing (plan 17 S2, D7): groups messages
 * into turns (a user message plus its replies) and keeps the largest
 * suffix that fits the budget. The final group — whose first message
 * is the current turn's user input — is never dropped; the attachment
 * clamps bound its size. Byte-identical (same array) when everything
 * fits.
 */
export function fitHistory(
  messages: AIMessage[],
  budgetTokens: number = HISTORY_TOKEN_BUDGET
): { messages: AIMessage[]; report: HistoryFitReport } {
  if (messages.length === 0) {
    return { messages, report: { droppedMessages: 0, droppedTurns: 0, estimatedTokensBefore: 0, estimatedTokensAfter: 0 } };
  }

  const groups: AIMessage[][] = [];
  for (const message of messages) {
    if (message.role === 'user' || groups.length === 0) {
      groups.push([message]);
    } else {
      groups.at(-1)!.push(message);
    }
  }

  const costs = groups.map((group) => group.reduce((sum, message) => sum + messageTokenCost(message), 0));
  const total = costs.reduce((sum, cost) => sum + cost, 0);

  let keptFrom = 0;
  let cumulative = 0;
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    cumulative += costs[index];
    if (cumulative > budgetTokens) {
      keptFrom = Math.min(index + 1, groups.length - 1);
      break;
    }
    keptFrom = index;
  }

  const keptMessages = groups.slice(keptFrom).flat();
  const after = keptMessages.reduce((sum, message) => sum + messageTokenCost(message), 0);

  return {
    messages: keptMessages,
    report: {
      droppedMessages: messages.length - keptMessages.length,
      droppedTurns: keptFrom,
      estimatedTokensBefore: total,
      estimatedTokensAfter: after,
    },
  };
}

export function toAiMessages(messages: Message[]): AIMessage[] {
  return messages.map((msg): AIMessage => {
    if (msg.role === MessageRole.USER && msg.attachments && msg.attachments.length > 0) {
      let combined = msg.content || '';
      const images: { type: 'image_url'; image_url: { url: string } }[] = [];
      msg.attachments.forEach((att: Attachment) => {
        if (att.type === 'image' || att.type === 'screen-capture') {
          images.push({ type: 'image_url', image_url: { url: att.data } });
        } else if (att.type === 'pdf' && att.extractedText) {
          combined += `\n\n--- Content from ${att.filename} ---\n${truncateText(att.extractedText, PDF_HISTORY_CHAR_CAP)}`;
        }
      });
      return {
        role: msg.role,
        content: [{ type: 'text', text: combined.trim() }, ...images.slice(0, MAX_HISTORY_IMAGES)],
      } as AIMessage;
    }
    return { role: msg.role, content: msg.content } as AIMessage;
  });
}
