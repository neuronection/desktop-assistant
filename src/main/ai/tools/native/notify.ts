import { z } from 'zod';
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
    const { Notification } = await import('electron');
    if (!Notification.isSupported()) {
      return 'Notifications are not supported on this system.';
    }
    new Notification({ title: args.title, body: args.body }).show();
    return 'Notification shown.';
  },
};
