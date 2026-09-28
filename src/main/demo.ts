import { app } from 'electron';
import { join } from 'path';
import { PrismaClient } from 'generated/prisma/client';
import { MessageRole } from '@shared/database-types';

export const DEMO_FLAG = '--demo';

export function isDemoLaunch(argv: readonly string[]): boolean {
  return argv.includes(DEMO_FLAG);
}

export function demoDataDir(): string {
  return join(app.getPath('userData'), 'demo');
}

export function applyDemoDataDir(): string {
  const dir = demoDataDir();
  app.setPath('userData', dir);
  console.log(`Demo mode: isolated data dir ${dir} — the real workspace is never touched`);
  return dir;
}

type DemoTurn = {
  id: string;
  role: MessageRole;
  content: string;
  minutesAgo: number;
};

type DemoConversation = {
  id: string;
  title: string;
  minutesAgo: number;
  turns: DemoTurn[];
};

export const DEMO_CONVERSATIONS: DemoConversation[] = [  {
    id: 'demo-conv-welcome',
    title: 'Welcome to Desktop Assistant',
    minutesAgo: 60,
    turns: [
      {
        id: 'demo-msg-welcome-1',
        role: MessageRole.USER,
        content: 'What can you do?',
        minutesAgo: 60,
      },
      {
        id: 'demo-msg-welcome-2',
        role: MessageRole.ASSISTANT,
        content:
          'Quite a lot! I live in your system tray and come up with a global hotkey. ' +
          'I can chat about anything on your screen, answer with attachments (PDFs, ' +
          'screenshots), run tools you approve, remember things across conversations, ' +
          'and talk out loud with voice input and spoken replies.\n\n' +
          'This is a demo workspace: the conversations here are sample content, and ' +
          'nothing you do in demo mode touches your real history.',
        minutesAgo: 59,
      },
    ],
  },
  {
    id: 'demo-conv-tools',
    title: 'Tools and approvals',
    minutesAgo: 30,
    turns: [
      {
        id: 'demo-msg-tools-1',
        role: MessageRole.USER,
        content: 'How do tools stay safe?',
        minutesAgo: 30,
      },
      {
        id: 'demo-msg-tools-2',
        role: MessageRole.ASSISTANT,
        content:
          'Every tool call goes through the policy engine: risk classes, granted ' +
          'roots, and a kill switch decide whether I run, ask you first, or get ' +
          'denied. State-changing tools (file writes, shell, downloads) show an ' +
          'approval card by default, and approvals time out to a denial — never ' +
          'to a silent yes.',
        minutesAgo: 29,
      },
    ],
  },
  {
    id: 'demo-conv-voice',
    title: 'Voice demo',
    minutesAgo: 10,
    turns: [
      {
        id: 'demo-msg-voice-1',
        role: MessageRole.USER,
        content: 'Tell me about voice mode.',
        minutesAgo: 10,
      },
      {
        id: 'demo-msg-voice-2',
        role: MessageRole.ASSISTANT,
        content:
          'Hold Control to talk, and I transcribe as you speak. Replies can be ' +
          'read aloud, and Live conversation mode keeps the mic open so you can ' +
          'interrupt me mid-sentence — just start talking.',
        minutesAgo: 9,
      },
    ],
  },
];

type DemoPrisma = Pick<PrismaClient, 'conversation' | 'message'>;

export async function seedDemoWorkspace(db: DemoPrisma): Promise<number> {
  let seeded = 0;
  const now = Date.now();
  for (const conv of DEMO_CONVERSATIONS) {
    const existing = await db.conversation.findUnique({ where: { id: conv.id } });
    if (existing) {
      continue;
    }
    await db.conversation.create({
      data: {
        id: conv.id,
        title: conv.title,
        createdAt: new Date(now - conv.minutesAgo * 60_000),
        updatedAt: new Date(now - conv.turns[conv.turns.length - 1].minutesAgo * 60_000),
        isArchived: false,
      },
    });
    for (const turn of conv.turns) {
      await db.message.create({
        data: {
          id: turn.id,
          content: turn.content,
          role: turn.role,
          conversationId: conv.id,
          createdAt: new Date(now - turn.minutesAgo * 60_000),
        },
      });
    }
    seeded += 1;
  }
  if (seeded > 0) {
    console.log(`Demo workspace seeded: ${seeded} sample conversations`);
  }
  return seeded;
}
