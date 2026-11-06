import type { IpcDescriptor } from './registry';
import { IPC_REGISTRY } from './registry';

const INTRO = `# IPC surface (generated)

> Generated from \`src/shared/ipc/registry.ts\`. Do not hand-edit:
> run \`node scripts/generate-ipc.mjs\` and commit the diff.

The preload bridge (\`src/preload/createPreloadApi.ts\`, exposed as
\`window.electronAPI\`) is the **only** renderer→main channel. Every
channel is a descriptor in the registry; the bridge surface, the main
registration wrapper and this document are projections of that one
source.

## One pattern

1. Add a descriptor in \`src/shared/ipc/registry.ts\` (channel, direction,
   window scope, zod request tuple, response type, preload bridge,
   summary).
2. Register the handler with \`register(IPC['channel'], handler)\` from
   the domain registrar under \`src/main/ipc/\` (mini-apps:
   \`src/main/apps/ipc.ts\`).
3. The wrapper validates args through the descriptor, enforces window
   scope at invoke time and shapes errors with the one
   \`ipc:<code>: message\` vocabulary.
4. Run \`node scripts/generate-ipc.mjs\` to regenerate this file.

\`invoke\` is \`ipcMain.handle\` (request/response); \`send\` is
\`ipcMain.on\` (fire-and-forget renderer→main); \`event\` is a
main→renderer push exposed as an \`on*\` bridge subscription.

## Registry
`;

function describeSchema(schema: unknown): string {
  const def = (schema as { _def?: { type?: string; items?: unknown[]; element?: unknown; innerType?: unknown; options?: unknown[]; keyType?: unknown; valueType?: unknown } })._def;
  const type = def?.type ?? '';
  if (type === 'tuple') {
    return `[${(def?.items ?? []).map(describeSchema).join(', ')}]`;
  }
  if (type === 'array') {
    return `${describeSchema(def?.element)}[]`;
  }
  if (type === 'optional') {
    return `${describeSchema(def?.innerType)}?`;
  }
  if (type === 'union') {
    return (def?.options ?? []).map(describeSchema).join(' | ');
  }
  if (type === 'record') {
    return `Record<${describeSchema(def?.keyType)}, ${describeSchema(def?.valueType)}>`;
  }
  const names: Record<string, string> = {
    string: 'string',
    number: 'number',
    boolean: 'boolean',
    unknown: 'unknown',
    null: 'null',
    literal: 'literal',
    object: 'object',
    any: 'any',
  };
  return names[type] ?? (type || 'unknown');
}

export function renderIpcDocs(registry: readonly IpcDescriptor[] = IPC_REGISTRY): string {
  const groups = new Map<string, IpcDescriptor[]>();
  for (const entry of registry) {
    const group = groups.get(entry.group) ?? [];
    group.push(entry);
    groups.set(entry.group, group);
  }
  const lines = [INTRO.trimEnd(), ''];
  for (const [group, entries] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`### ${group}`, '');
    lines.push('| Channel | Direction | Scope | Request | Response | Bridge | Summary |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const entry of [...entries].sort((a, b) => a.channel.localeCompare(b.channel))) {
      const scope = entry.scope.join(', ');
      const request = describeSchema(entry.request);
      const response = describeSchema(entry.response);
      const bridge = entry.bridge ? `${entry.bridge.method} (${entry.bridge.kind})` : '—';
      lines.push(`| \`${entry.channel}\` | ${entry.direction} | ${scope} | \`${request}\` | \`${response}\` | ${bridge} | ${entry.summary} |`);
    }
    lines.push('');
  }
  lines.push(`**Channels:** ${registry.length} (${registry.filter((entry) => entry.direction === 'invoke').length} invoke, ${registry.filter((entry) => entry.direction === 'send').length} send, ${registry.filter((entry) => entry.direction === 'event').length} event).`);
  lines.push('');
  return lines.join('\n');
}
