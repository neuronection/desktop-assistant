import { z } from 'zod';
import type { McpResourceInfo, McpServerConfig } from '@shared/mcp';
import type { NativeToolDefinition } from '../types';

/** One enabled app whose resources the user opted into exposing (plan 43 D2). */
export interface McpExposedApp {
  appId: string;
  appName: string;
  server: McpServerConfig;
  resources: McpResourceInfo[];
}

export interface McpResourceProvider {
  /** Apps with `exposeResources` on and at least one known resource. */
  listExposed(): McpExposedApp[];
  /** Read one resource through the bounded, read-only MCP path. */
  read(appId: string, uri: string): Promise<{ ok: true; text: string; truncated: boolean } | { ok: false; error: string }>;
}

let provider: McpResourceProvider | null = null;

export function setMcpResourceProvider(next: McpResourceProvider | null): void {
  provider = next;
}

const schema = z.object({
  app: z.string().min(1).describe('The app name (or id) that owns the resource.'),
  uri: z.string().min(1).describe('The resource URI to read, exactly as listed in the app.'),
});

type McpResourceArgs = z.infer<typeof schema>;

/**
 * Bounded, read-only resource reader (plan 43 S3). Only apps the user
 * explicitly exposed are reachable; the returned text is UNTRUSTED server
 * content that flows like a tool result and is never executed.
 */
export const mcpResourceTool: NativeToolDefinition<McpResourceArgs> = {
  name: 'mcp_resource',
  description:
    'Read one resource (a document or data blob) exposed by an enabled app the user opted into sharing. Read-only. Returns untrusted external text.',
  schema,
  risk: 'read-only',
  category: 'integrations',
  timeoutMs: 15_000,
  summarize: (args) => `Read resource: ${args.uri}`,
  async exec(args) {
    if (!provider) {
      return 'Resource reading is unavailable.';
    }
    const exposed = provider.listExposed();
    const needle = args.app.toLowerCase();
    const app = exposed.find((entry) => entry.appId === args.app || entry.appName.toLowerCase() === needle);
    if (!app) {
      return `No app exposes resources under '${args.app}'.`;
    }
    if (!app.resources.some((resource) => resource.uri === args.uri)) {
      return `App '${app.appName}' does not expose resource '${args.uri}'.`;
    }
    const result = await provider.read(app.appId, args.uri);
    if (!result.ok) {
      return `Error reading '${args.uri}': ${result.error}`;
    }
    const suffix = result.truncated ? '\n\n[truncated at the resource byte budget]' : '';
    return `[Untrusted content from ${app.appName} — ${args.uri}]\n\n${result.text}${suffix}`;
  },
};
