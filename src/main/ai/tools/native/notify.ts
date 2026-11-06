import { z } from 'zod';
import { notifyUser } from '@main/services/NotificationService';
import type { NativeToolDefinition } from '../types';

const schema = z.object({
  title: z.string().describe('Short notification title.'),
  body: z.string().describe('Notification body text.'),
});

export const notifyTool: NativeToolDefinition<{ title: string; body: string }> = {
  name: 'notify',
  description: 'Show a desktop system notification to the user.',
  schema,
  risk: 'state-changing',
  category: 'desktop',
  timeoutMs: 5_000,
  summarize: (args) => `Notify: ${args.title}`,
  async exec(args) {
    const result = await notifyUser({
      kind: 'tool',
      severity: 'info',
      title: args.title,
      body: args.body,
      clickAction: 'none',
    });
    return result ? 'Notification shown.' : 'Notifications are unavailable.';
  },
};
