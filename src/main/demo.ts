import { app } from 'electron';
import { join } from 'path';
import { PrismaClient } from 'generated/prisma/client';
import { MessageRole } from '@shared/database-types';
import type { Attachment } from '@shared/types';
import type { TurnMetadata } from '@shared/turns';

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
  attachments?: Attachment[];
  metadata?: TurnMetadata;
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
        metadata: {
          outcome: 'ok',
          model: 'demo-reasoning',
          durationMs: 1240,
        },
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
        content: 'Summarize the meeting notes in my notes folder.',
        minutesAgo: 30,
      },
      {
        id: 'demo-msg-tools-2',
        role: MessageRole.ASSISTANT,
        content:
          'I read **meeting-notes.md** and drafted a summary of the three decisions ' +
          'and the two open questions. The full draft is in the notes folder.\n\n' +
          'How tools stay safe: every call goes through the policy engine — risk ' +
          'class, granted roots and a kill switch decide whether I run, ask you ' +
          'first, or get denied. State-changing tools show an approval card by ' +
          'default, and approvals time out to a denial — never to a silent yes.',
        minutesAgo: 29,
        metadata: {
          outcome: 'ok',
          model: 'demo-reasoning',
          durationMs: 2140,
          toolCount: 2,
          steps: [
            {
              id: 'demo-step-plan',
              phase: 'thinking',
              label: 'Planning the summary',
              startedAt: 0,
              endedAt: 380,
            },
            {
              id: 'demo-step-read',
              phase: 'tool_call',
              label: 'Read meeting notes',
              toolName: 'read_file',
              startedAt: 380,
              endedAt: 820,
              summary: 'notes/meeting-notes.md',
              detail: { path: '/home/demo/notes/meeting-notes.md' },
            },
            {
              id: 'demo-step-read-result',
              phase: 'tool_result',
              label: 'read_file',
              toolName: 'read_file',
              startedAt: 820,
              endedAt: 1100,
              status: 'ok',
              response:
                '# Meeting notes — weekly sync\n\n' +
                'Decisions: (1) ship the beta on the 14th, (2) freeze the schema, ' +
                '(3) drop the legacy import. Open: pricing tier, docs owner.',
            },
            {
              id: 'demo-step-write',
              phase: 'tool_call',
              label: 'Write summary draft',
              toolName: 'write_file',
              startedAt: 1100,
              endedAt: 1600,
              summary: 'notes/meeting-summary.md',
              detail: { path: '/home/demo/notes/meeting-summary.md' },
            },
            {
              id: 'demo-step-write-result',
              phase: 'tool_result',
              label: 'write_file',
              toolName: 'write_file',
              startedAt: 1600,
              endedAt: 1900,
              status: 'ok',
              response: 'Wrote 1 file (2.1 KB).',
            },
          ],
          artifacts: [
            {
              kind: 'file',
              path: '/home/demo/notes/meeting-summary.md',
              name: 'meeting-summary.md',
              sizeBytes: 2140,
            },
          ],
        },
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
        metadata: {
          outcome: 'ok',
          model: 'demo-reasoning',
          durationMs: 980,
        },
      },
    ],
  },
];

type DemoPrisma = Pick<PrismaClient, 'conversation' | 'message'>;

interface DemoConfigService {
  getConfig(): { translation?: { providers?: unknown[] } };
  updateConfig(updates: Record<string, unknown>): Promise<void>;
}

/**
 * Demo translation provisioning (family demo-tour standard): point the
 * translate pad at the local demo service (scripts/ui-capture/
 * mock-translate.mjs) so the mini tool shows deterministic output with
 * no external service or key. Demo-only, never touches real config —
 * existing provider settings always win.
 */
export async function applyDemoConfig(config: DemoConfigService): Promise<void> {
  const existing = config.getConfig().translation?.providers ?? [];
  if (existing.length > 0) {
    return;
  }
  await config.updateConfig({
    translation: {
      mode: 'service',
      defaultTarget: 'es',
      providers: [
        {
          id: 'demo-translate',
          name: 'Demo translate (local mock)',
          type: 'libretranslate',
          apiBase: 'http://127.0.0.1:8333',
          enabled: true,
        },
      ],
    },
  });
  console.log('Demo config: local translate provider provisioned (:8333)');
}

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
      const turnAt = now - turn.minutesAgo * 60_000;
      // Turn trace steps carry absolute timestamps; the fixture defines them
      // as offsets from the turn for readability.
      const metadata = turn.metadata
        ? {
            ...turn.metadata,
            steps: turn.metadata.steps?.map((step) => ({
              ...step,
              startedAt: turnAt + step.startedAt,
              endedAt: step.endedAt == null ? undefined : turnAt + step.endedAt,
            })),
          }
        : null;
      await db.message.create({
        data: {
          id: turn.id,
          content: turn.content,
          role: turn.role,
          conversationId: conv.id,
          createdAt: new Date(turnAt),
          metadata: metadata as never,
          attachments: (turn.attachments ?? []) as never,
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
