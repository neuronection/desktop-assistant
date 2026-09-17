import { z } from 'zod';
import type { ToolRiskClass } from './turns';

/** Hard length cap for `promptNotes` — enforced at validation (plan 15 §4). */
export const PROMPT_NOTES_CAP = 500;

/**
 * Per-tool authored defaults a preset carries. `entityRole`/`entityArg`
 * drive D18 scope enforcement: `action` tools validate the entity argument
 * against the app's scope before dispatch; `discovery` tools have their
 * entity-bearing results filtered.
 */
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
  /** Capability guidance injected into the system prompt while bound — fenced reference data. */
  promptNotes: string;
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
    promptNotes: z.string().max(PROMPT_NOTES_CAP),
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
    defaultEndpoint: 'http://homeassistant.local:8124/mcp',
    transport: 'http',
    helpCopy: [
      'Create a long-lived access token in Home Assistant (Profile → Security) and paste it on save — it is stored in your OS keyring, never in config.',
      'Strongest scoping: connect a restricted Home Assistant user that can only see the devices this app should control. Server-side scope beats per-app filters.',
    ],
    promptNotes:
      'Home Assistant controls the user\'s smart home (lights, switches, climate, covers, automations). Entity ids look like light.kitchen or climate.living_room. Discover devices with list_devices or filter_devices before controlling them, and prefer get_status to check current state.',
    toolDomains: [
      { tool: 'get_status', baseRisk: 'read-only', keywordTags: ['status', 'state', 'lights', 'climate'], entityRole: 'action', entityArg: 'entity_id' },
      { tool: 'list_devices', baseRisk: 'read-only', keywordTags: ['devices', 'list', 'lights', 'climate', 'switches'], entityRole: 'discovery' },
      { tool: 'get_available_devices', baseRisk: 'read-only', keywordTags: ['devices', 'available', 'lights', 'switches'], entityRole: 'discovery' },
      { tool: 'filter_devices', baseRisk: 'read-only', keywordTags: ['filter', 'devices', 'lights', 'climate'], entityRole: 'discovery' },
      { tool: 'control', baseRisk: 'state-changing', keywordTags: ['turn on', 'turn off', 'toggle', 'control', 'lights', 'climate', 'dim'], entityRole: 'action', entityArg: 'entity_id' },
    ],
  },
];

export function bundledPresetById(presetId: string): ToolAppPreset | undefined {
  return APP_PRESETS.find((preset) => preset.id === presetId);
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
