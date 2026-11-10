import { buildChatMarkdown, chatExportFileName } from '@neuronection/assistant-ui/chat-export';
import { buildBranchJson, buildBranchMarkdown } from './branchExport';
import { beginDialog, endDialog } from './dialogGuard';
import { TEXT } from '@shared/constants/text';

export interface TranscriptMessage {
  role: string;
  content: string;
  createdAt?: unknown;
}

/**
 * The ONE transcript export path (plan 74): the inspector's Export buttons,
 * the history rail's per-row Export action and the `/export` command all land
 * here. Branch trees win over a flat transcript when the conversation has one;
 * a temp/unsaved conversation exports its in-memory messages.
 */
export async function exportConversationTranscript(options: {
  id: string | null;
  title: string;
  /** In-memory messages for the active conversation (used when the tree is unavailable). */
  messages?: TranscriptMessage[];
  format?: 'md' | 'json';
}): Promise<void> {
  const format = options.format ?? 'md';
  const saved = options.id !== null && options.id.length > 0 && !options.id.startsWith('temp-');
  const tree =
    saved && typeof window.electronAPI.getConversationTree === 'function'
      ? await window.electronAPI.getConversationTree(options.id as string).catch(() => null)
      : null;
  const rows: TranscriptMessage[] =
    options.messages !== undefined
      ? options.messages
      : saved && typeof window.electronAPI.getMessagesByConversation === 'function'
        ? ((await window.electronAPI.getMessagesByConversation(options.id as string).catch(() => [])) as TranscriptMessage[])
        : [];
  const content =
    tree !== null
      ? format === 'md'
        ? buildBranchMarkdown(options.title, tree.nodes, tree.activeRootId)
        : buildBranchJson(options.title, tree.nodes, tree.activeRootId)
      : format === 'md'
        ? buildChatMarkdown(options.title, rows.map((message) => ({ role: message.role, content: message.content })))
        : JSON.stringify(
            { title: options.title, messages: rows.map(({ role, content: text, createdAt }) => ({ role, content: text, createdAt })) },
            null,
            2
          );
  const ext = format === 'md' ? 'md' : 'json';
  const fallbackName =
    format === 'md' ? chatExportFileName(options.title) : `${options.title.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()}.json`;
  beginDialog();
  try {
    await window.electronAPI.saveFile({
      title: TEXT.DESKTOP_EXPORT_DIALOG_TITLE,
      defaultPath: fallbackName,
      filters: [{ name: format === 'md' ? TEXT.EXPORT_FORMAT_MARKDOWN : TEXT.EXPORT_FORMAT_JSON, extensions: [ext] }],
      content,
    });
  } finally {
    endDialog();
  }
}
