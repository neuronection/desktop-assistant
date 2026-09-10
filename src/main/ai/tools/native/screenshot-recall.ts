import { z } from 'zod';
import type { NativeToolDefinition } from '../types';
import type { ToolResultBlock } from '../types';
import { getToolResultService } from '@main/services/ToolResultService';

const schema = z.object({
  stepId: z
    .string()
    .min(1)
    .describe('Trace-step id of the stored result, e.g. "tool_call_abc123" — taken from the recallable-screenshots list in your instructions.'),
});

export const screenshotRecallTool: NativeToolDefinition<{ stepId: string }> = {
  name: 'recall_screenshot',
  description:
    'Load a previously captured screenshot back into the conversation so you can inspect it again. Use when the user refers to an earlier screenshot or asks you to look again at something you captured. Ids come from the recallable-screenshots list in your instructions; recent screenshots only (older ones are pruned).',
  schema,
  risk: 'read-only',
  category: 'desktop',
  timeoutMs: 5_000,
  summarize: (args) => `Recall screenshot ${args.stepId}`,
  async exec(args) {
    const view = await getToolResultService().get(args.stepId);
    if (!view) {
      return `Error: no stored result for '${args.stepId}' (unknown or expired — check the recallable-screenshots list).`;
    }
    const blocks: ToolResultBlock[] = [];
    if (view.text) {
      blocks.push({ type: 'text', text: view.text });
    }
    for (const url of view.images) {
      blocks.push({ type: 'image', url });
    }
    if (blocks.length === 0) {
      return 'The stored result exists but carries no image.';
    }
    return blocks;
  },
};
