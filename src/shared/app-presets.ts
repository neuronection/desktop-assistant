import { z } from 'zod';
import type { ToolRiskClass } from './turns';

/** Hard length cap for `promptNotes` — enforced at validation (plan 15 §4). */
export const PROMPT_NOTES_CAP = 500;
/** Hard length cap for the authored app skill (plan 23 S5). */
export const SKILL_PROMPT_MAX_CHARS = 2000;

/**
 * Per-tool authored defaults a preset carries. `entityRole`/`entityArg`
 * drive D18 scope enforcement: `action` tools validate the entity argument
 * against the app's scope before dispatch; `discovery` tools have their
 * entity-bearing results filtered.
 */
export interface PresetAuth {
  /** `bearer` writes Authorization on HTTP; `env` writes one stdio env var. */
  kind: 'bearer' | 'env';
  /** Env var name for `env` auth. */
  key?: string;
  /** Token input label shown in the add flow. */
  label: string;
}

export interface PresetToolDomain {
  /** Raw server-side tool name (exact match) — HA presets ship exact HA names. */
  tool: string;
  baseRisk: ToolRiskClass;
  keywordTags: string[];
  entityRole?: 'action' | 'discovery';
  entityArg?: string;
}

export interface ToolAppPreset {
  manifestVersion: 1;
  /** Preset id — referenced by `ToolAppSpec.presetId`; content is main-owned. */
  id: string;
  name: string;
  icon?: string;
  description: string;
  /** Default MCP endpoint prefilled into the add flow (user editable). */
  defaultEndpoint: string;
  transport: 'http' | 'sse' | 'stdio';
  /** Renderer-facing help copy (add-flow + detail modal). */
  helpCopy: string[];
  /** Token destination for the preset's add flow (keyring only). */
  auth?: PresetAuth;
  /** Main-owned standing prompt notes seeded into `ToolAppSpec.directives` (≤500). */
  promptNotes?: string;
  /**
   * Authored app skill (plan 23 S5, D3) — the trusted instruction channel
   * seeded into `ToolAppSpec.skill`.
   */
  skill?: string;
  /**
   * Fast-path posture (plan 20 S7 scope eligibility): presets whose tools
   * match devices by NAME (Assist-style intent bridges) set `'never'` —
   * a guessed area/device string fails the registry match, so their tools
   * stay out of the decision surface and the scope checkbox renders
   * disabled with that reason. Default `'eligible'`.
   */
  fastPath?: 'eligible' | 'never';
  toolDomains: PresetToolDomain[];
}

const riskSchema = z.enum(['read-only', 'state-changing', 'destructive']);

export const presetToolDomainSchema = z.object({
  tool: z.string().min(1).max(64),
  baseRisk: riskSchema,
  keywordTags: z.array(z.string().min(1).max(64)).max(20),
  entityRole: z.enum(['action', 'discovery']).optional(),
  entityArg: z.string().min(1).max(64).optional(),
});

export const toolAppPresetSchema = z
  .object({
    manifestVersion: z.literal(1),
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(64),
    icon: z.string().max(64).optional(),
    description: z.string().min(1).max(500),
    defaultEndpoint: z.string().min(1).max(300),
    transport: z.enum(['http', 'sse', 'stdio']),
    helpCopy: z.array(z.string().min(1).max(300)).max(8),
    auth: z
      .object({
        kind: z.enum(['bearer', 'env']),
        key: z.string().min(1).max(64).optional(),
        label: z.string().min(1).max(100),
      })
      .superRefine((auth, ctx) => {
        if (auth.kind === 'env' && !auth.key) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['key'], message: 'env auth needs a key' });
        }
      })
      .optional(),
    promptNotes: z.string().min(1).max(PROMPT_NOTES_CAP).optional(),
    skill: z.string().min(1).max(SKILL_PROMPT_MAX_CHARS).optional(),
    fastPath: z.enum(['eligible', 'never']).optional(),
    toolDomains: z.array(presetToolDomainSchema).min(1).max(64),
  })
  .superRefine((preset, ctx) => {
    const seen = new Set<string>();
    for (const domain of preset.toolDomains) {
      if (seen.has(domain.tool)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['toolDomains'],
          message: `duplicate tool domain '${domain.tool}'`,
        });
      }
      seen.add(domain.tool);
      if (domain.entityRole === 'action' && !domain.entityArg) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['toolDomains'],
          message: `action tool '${domain.tool}' must declare entityArg`,
        });
      }
    }
  });

export function parseToolAppPreset(value: unknown): { ok: true; preset: ToolAppPreset } | { ok: false; error: string } {
  const result = toolAppPresetSchema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue.path.length > 0 ? ` (${issue.path.join('.')})` : '';
    return { ok: false, error: `${issue.message}${where}` };
  }
  return { ok: true, preset: result.data };
}

/**
 * Bundled, reviewed presets (plan 15 D10/§4): the only sources of
 * `promptNotes` and authored tool metadata in v1. Third-party preset
 * import is a non-goal until a review policy exists.
 */
export const APP_PRESETS: ToolAppPreset[] = [
  {
    manifestVersion: 1,
    id: 'home-assistant',
    name: 'Home Assistant',
    icon: 'home',
    description: 'Control and inspect your smart home: lights, switches, climate, automations.',
    defaultEndpoint: 'http://homeassistant.local:8124/api/mcp',
    transport: 'http',
    helpCopy: [
      'Create a long-lived access token in Home Assistant (Profile → Security) and paste it on save — it is stored in your OS keyring, never in config.',
      'Strongest scoping: connect a restricted Home Assistant user that can only see the devices this app should control. Server-side scope beats per-app filters.',
    ],
    toolDomains: [
      { tool: 'get_status', baseRisk: 'read-only', keywordTags: ['status', 'state', 'lights', 'climate'], entityRole: 'action', entityArg: 'entity_id' },
      { tool: 'list_devices', baseRisk: 'read-only', keywordTags: ['devices', 'list', 'lights', 'climate', 'switches'], entityRole: 'discovery' },
      { tool: 'get_available_devices', baseRisk: 'read-only', keywordTags: ['devices', 'available', 'lights', 'switches'], entityRole: 'discovery' },
      { tool: 'filter_devices', baseRisk: 'read-only', keywordTags: ['filter', 'devices', 'lights', 'climate'], entityRole: 'discovery' },
      { tool: 'control', baseRisk: 'state-changing', keywordTags: ['turn on', 'turn off', 'toggle', 'control', 'lights', 'climate', 'dim'], entityRole: 'action', entityArg: 'entity_id' },
    ],
    skill:
      'You control the user\'s smart home via the Home Assistant tools. Entity ids look like light.kitchen or climate.living_room. ' +
      "The prompt context carries the device list — resolve rooms, people's office/bedroom names and device mentions to entity_id values directly from it, and pass them to the action tools. " +
      'Area, device and name arguments must be copied VERBATIM from the device list (their area/device wording in the list, never rephrased or translated) — the tools match names against the registry, and approximate guesses fail. ' +
      'Do not call discovery tools (list_devices/filter_devices) or status checks before acting when the device list already has the entity; the list may be a few minutes old, which is acceptable. ' +
      'Never look up device names in memory tools or probe system/date-time tools for the current time. ' +
      'If a device is genuinely missing from the device list, discover once with list_devices/filter_devices, then act; prefer the narrow intent tools (control) over generic commands. ' +
      'Compound requests (several devices) may need several calls; state-check requests may answer with plain text from the device list without any tool call.',
    fastPath: 'never',
  },
  {
    manifestVersion: 1,
    id: 'github',
    name: 'GitHub',
    icon: 'github',
    description: 'Search repos, issues and PRs; read files and diffs; open issues and comments.',
    defaultEndpoint: 'npx -y @modelcontextprotocol/server-github',
    transport: 'stdio',
    helpCopy: [
      'Create a GitHub personal access token (Settings → Developer settings → Tokens) with repo and read:org scopes; paste it on save — it is stored in your OS keyring.',
      'The token reaches the MCP server as GITHUB_PERSONAL_ACCESS_TOKEN; config.json never holds it.',
      'Search, files, commits, PRs and issues are read-only; create issue/comment/PR ask for approval every time.',
    ],
    auth: { kind: 'env', key: 'GITHUB_PERSONAL_ACCESS_TOKEN', label: 'GitHub personal access token' },
    promptNotes:
      'Use GitHub for repository, issue, PR, commit and code questions. Prefer search over guessing; cite repository and file paths. Writes (create issue/comment/PR) are approval-gated; never claim one happened before the tool confirms.',
    toolDomains: [
      { tool: 'search_repositories', baseRisk: 'read-only', keywordTags: ['search', 'repo', 'github'] },
      { tool: 'search_issues', baseRisk: 'read-only', keywordTags: ['issue', 'pr', 'search'] },
      { tool: 'get_file_contents', baseRisk: 'read-only', keywordTags: ['file', 'read', 'diff'] },
      { tool: 'list_commits', baseRisk: 'read-only', keywordTags: ['log', 'history', 'commit'] },
      { tool: 'get_issue', baseRisk: 'read-only', keywordTags: ['issue', 'detail'] },
      { tool: 'get_pull_request', baseRisk: 'read-only', keywordTags: ['pr', 'detail'] },
      { tool: 'create_issue', baseRisk: 'state-changing', keywordTags: ['issue', 'create', 'report'] },
      { tool: 'add_issue_comment', baseRisk: 'state-changing', keywordTags: ['comment'] },
      { tool: 'create_pull_request', baseRisk: 'state-changing', keywordTags: ['pr', 'merge request'] },
      { tool: 'list_notifications', baseRisk: 'read-only', keywordTags: ['inbox', 'notification'] },
    ],
  },
  {
    manifestVersion: 1,
    id: 'google-calendar',
    name: 'Google Calendar',
    icon: 'calendar',
    description: 'Read upcoming events and schedules; create or move events with approval.',
    defaultEndpoint: 'npx -y @modelcontextprotocol/server-google-calendar',
    transport: 'stdio',
    helpCopy: [
      'Create an OAuth client and refresh token for the Google Calendar MCP server; paste the refresh token on save — it stays in your OS keyring.',
      'The server receives it as GOOGLE_OAUTH_REFRESH_TOKEN; config.json never holds it.',
      'Reads are read-only; creating or moving events asks for approval. This preset does not expose deletes.',
    ],
    auth: { kind: 'env', key: 'GOOGLE_OAUTH_REFRESH_TOKEN', label: 'Google OAuth refresh token' },
    promptNotes:
      'Use Google Calendar for upcoming events, schedule questions and meeting lookup. Confirm time zone and attendees before creating or moving an event; writes are approval-gated. Deletes are not exposed.',
    toolDomains: [
      { tool: 'list_upcoming', baseRisk: 'read-only', keywordTags: ['calendar', 'upcoming', 'schedule'] },
      { tool: 'search_events', baseRisk: 'read-only', keywordTags: ['event', 'search', 'calendar'] },
      { tool: 'create_event', baseRisk: 'state-changing', keywordTags: ['create', 'event', 'meeting'], entityRole: 'action', entityArg: 'event_id' },
      { tool: 'move_event', baseRisk: 'state-changing', keywordTags: ['move', 'event', 'reschedule'], entityRole: 'action', entityArg: 'event_id' },
    ],
  },
  {
    manifestVersion: 1,
    id: 'obsidian',
    name: 'Obsidian',
    icon: 'notebook',
    description: 'Search, read and write notes in a local Obsidian vault through the Local REST API plugin.',
    defaultEndpoint: 'https://127.0.0.1:27124/mcp/',
    transport: 'http',
    helpCopy: [
      'Install the Obsidian Local REST API community plugin and create an API key; paste it on save — it is stored in your OS keyring.',
      'The endpoint defaults to https://127.0.0.1:27124/mcp/; adjust it if the plugin listens elsewhere.',
      'Scope note paths (for example allow journal/*) in the app Scope tab; create/append still ask for approval.',
    ],
    auth: { kind: 'bearer', label: 'Obsidian Local REST API key' },
    promptNotes:
      'Use Obsidian for notes, vault search and journal lookups. Treat note paths as entities; keep writes to the scoped paths and ask before creating or appending.',
    toolDomains: [
      { tool: 'list_notes', baseRisk: 'read-only', keywordTags: ['note', 'vault', 'list'] },
      { tool: 'search_notes', baseRisk: 'read-only', keywordTags: ['search', 'note', 'vault'] },
      { tool: 'read_note', baseRisk: 'read-only', keywordTags: ['read', 'note', 'path'], entityRole: 'discovery', entityArg: 'path' },
      { tool: 'create_note', baseRisk: 'state-changing', keywordTags: ['create', 'note', 'journal'], entityRole: 'action', entityArg: 'path' },
      { tool: 'append_to_note', baseRisk: 'state-changing', keywordTags: ['append', 'note', 'journal'], entityRole: 'action', entityArg: 'path' },
    ],
  },
  {
    manifestVersion: 1,
    id: 'notion',
    name: 'Notion',
    icon: 'file-text',
    description: 'Search pages and databases; create pages and append blocks with approval.',
    defaultEndpoint: 'npx -y @notionhq/notion-mcp-server',
    transport: 'stdio',
    helpCopy: [
      'Create a Notion internal integration, share only the pages/databases it should see, and paste its token on save — it stays in your OS keyring.',
      'The server receives it as NOTION_API_TOKEN; config.json never holds it.',
      'Sharing pages with the integration is the scoping surface; create/update asks for approval and updates append blocks rather than rewriting pages.',
    ],
    auth: { kind: 'env', key: 'NOTION_API_TOKEN', label: 'Notion integration token' },
    promptNotes:
      'Use Notion for pages, databases and wiki questions. The integration only sees explicitly shared pages; prefer read/search before create or block updates, which are approval-gated.',
    toolDomains: [
      { tool: 'search_pages', baseRisk: 'read-only', keywordTags: ['search', 'page', 'notion'] },
      { tool: 'read_page', baseRisk: 'read-only', keywordTags: ['read', 'page', 'notion'] },
      { tool: 'read_database', baseRisk: 'read-only', keywordTags: ['database', 'read', 'notion'] },
      { tool: 'create_page', baseRisk: 'state-changing', keywordTags: ['create', 'page'] },
      { tool: 'update_page_blocks', baseRisk: 'state-changing', keywordTags: ['update', 'blocks', 'page'] },
    ],
  },
  {
    manifestVersion: 1,
    id: 'spotify',
    name: 'Spotify',
    icon: 'music',
    description: 'Search the Spotify catalog, inspect playlists and queue or play tracks with approval.',
    defaultEndpoint: 'npx -y @modelcontextprotocol/server-spotify',
    transport: 'stdio',
    helpCopy: [
      'Authorize the Spotify MCP server and paste its refresh token on save — it stays in your OS keyring.',
      'The server receives it as SPOTIFY_REFRESH_TOKEN; config.json never holds it.',
      'Playback actions ask for approval; native media controls already handle this machine play/pause — use Spotify for catalog search and queueing.',
    ],
    auth: { kind: 'env', key: 'SPOTIFY_REFRESH_TOKEN', label: 'Spotify refresh token' },
    promptNotes:
      'Use Spotify for music search, playlists and queueing. Play/pause on this machine may be handled natively; prefer Spotify for cloud catalog actions. Writes are approval-gated.',
    toolDomains: [
      { tool: 'get_now_playing', baseRisk: 'read-only', keywordTags: ['now playing', 'music', 'spotify'] },
      { tool: 'search_tracks', baseRisk: 'read-only', keywordTags: ['search', 'track', 'music'] },
      { tool: 'list_playlists', baseRisk: 'read-only', keywordTags: ['playlist', 'music'] },
      { tool: 'play_track', baseRisk: 'state-changing', keywordTags: ['play', 'track'], entityRole: 'action', entityArg: 'track_id' },
      { tool: 'pause', baseRisk: 'state-changing', keywordTags: ['pause', 'music'] },
      { tool: 'resume', baseRisk: 'state-changing', keywordTags: ['resume', 'music'] },
      { tool: 'add_to_queue', baseRisk: 'state-changing', keywordTags: ['queue', 'track'], entityRole: 'action', entityArg: 'track_id' },
    ],
  },
];
export function bundledPresetById(presetId: string): ToolAppPreset | undefined {
  return APP_PRESETS.find((preset) => preset.id === presetId);
}

/** Plan 20 S7 scope eligibility: a preset can declare its tools unfit for the decision fast path (name-matched dispatch). */
export function fastPathEligible(presetId: string | undefined): boolean {
  return presetId === undefined || bundledPresetById(presetId)?.fastPath !== 'never';
}

/** Authored `toolState` entries for the given tool names (template for tests + main-side flows). */
export function presetToolStateFor(
  preset: ToolAppPreset,
  toolNames: string[]
): Record<string, { enabled: boolean; keywordTags: string[]; baseRisk?: ToolRiskClass; entityRole?: 'action' | 'discovery'; entityArg?: string }> {
  const next: Record<string, { enabled: boolean; keywordTags: string[]; baseRisk?: ToolRiskClass; entityRole?: 'action' | 'discovery'; entityArg?: string }> = {};
  for (const name of toolNames) {
    const domain = preset.toolDomains.find((candidate) => candidate.tool === name);
    if (!domain) {
      continue;
    }
    next[name] = {
      enabled: true,
      keywordTags: domain.keywordTags,
      ...(domain.baseRisk ? { baseRisk: domain.baseRisk } : {}),
      ...(domain.entityRole ? { entityRole: domain.entityRole } : {}),
      ...(domain.entityArg ? { entityArg: domain.entityArg } : {}),
    };
  }
  return next;
}
