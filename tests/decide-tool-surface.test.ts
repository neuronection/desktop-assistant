import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  decisionToolSurface,
  selectDecisionCandidates,
  mcpParameterSchema,
  DECISION_TOOL_CAP,
} from '@main/ai/decide/tool-surface';
import type { NativeToolDefinition } from '@main/ai/tools/types';
import type { ToolRiskClass } from '@shared/turns';

function nativeDef(name: string, description: string, schema: z.ZodType): NativeToolDefinition {
  return {
    name,
    description,
    schema,
    risk: 'state-changing' as ToolRiskClass,
    category: 'system',
    summarize: () => name,
    exec: async () => 'ok',
  } as unknown as NativeToolDefinition;
}

describe('mcpParameterSchema', () => {
  it('shapes a JSON schema from the flat parameter list', () => {
    const schema = mcpParameterSchema([
      { name: 'entity_id', type: 'string', required: true, description: 'Light entity id' },
      { name: 'brightness_pct', type: 'number', required: false, enumValues: ['0', '100'] },
    ]);
    expect(schema).toEqual({
      type: 'object',
      properties: {
        entity_id: { type: 'string', description: 'Light entity id' },
        brightness_pct: { type: 'number', enum: ['0', '100'] },
      },
      required: ['entity_id'],
    });
  });

  it('returns undefined for empty lists', () => {
    expect(mcpParameterSchema([])).toBeUndefined();
    expect(mcpParameterSchema(undefined)).toBeUndefined();
  });
});

describe('decisionToolSurface', () => {
  it('projects native zod schemas to JSON schema (tagged natives only)', () => {
    const [tool] = decisionToolSurface({
      native: [
        nativeDef(
          'screen_capture',
          'Capture a screenshot of the screen.',
          z.object({ monitor: z.string().describe('Monitor id').optional() })
        ),
        nativeDef('file_write', 'Write a file to disk.', z.object({})),
      ],
    });
    expect(tool?.name).toBe('screen_capture');
    expect(tool?.keywordTags).toContain('screenshot');
    expect(tool?.parameters).toMatchObject({
      type: 'object',
      properties: { monitor: { type: 'string', description: 'Monitor id' } },
    });
  });

  it('caps descriptions and the surface size', () => {
    const longDescription = 'x'.repeat(400);
    const mcp = Array.from({ length: DECISION_TOOL_CAP + 10 }, (_, i) => ({
      name: `mcp__app__tool_${i}`,
      description: longDescription,
      parameterList: [{ name: 'arg', type: 'string', required: false }],
    }));
    const surface = decisionToolSurface({ native: [], mcp });
    expect(surface).toHaveLength(DECISION_TOOL_CAP);
    expect(surface[0]?.description.length).toBeLessThanOrEqual(240);
    expect(surface[0]?.description.endsWith('…')).toBe(true);
  });

  it('appends MCP tools after native ones and converts their parameters', () => {
    const surface = decisionToolSurface({
      native: [nativeDef('screen_capture', 'Capture the screen.', z.object({}))],
      mcp: [
        {
          name: 'mcp__homeassistant__light_turn_on',
          description: 'HA light on',
          parameterList: [{ name: 'entity_id', type: 'string', required: true }],
        },
      ],
    });
    expect(surface.map((tool) => tool.name)).toEqual(['screen_capture', 'mcp__homeassistant__light_turn_on']);
    expect(surface[1]?.parameters).toMatchObject({ type: 'object', properties: { entity_id: { type: 'string' } } });
  });
});

describe('decision surface denylist', () => {
  it('excludes the power/shell/kill family from the projected surface', () => {
    const surface = decisionToolSurface({
      native: [
        nativeDef('run_shell', 'Run a shell command.', z.object({})),
        nativeDef('power_shutdown', 'Shut the machine down.', z.object({})),
        nativeDef('kill_process', 'Kill a process.', z.object({})),
        nativeDef('screen_capture', 'Capture the screen.', z.object({})),
      ],
    });
    expect(surface.map((tool) => tool.name)).toEqual(['screen_capture']);
  });
});

describe('selectDecisionCandidates', () => {
  const surface = decisionToolSurface({
    native: [
      nativeDef('screen_capture', 'Capture a screenshot of the screen.', z.object({})),
      nativeDef('brightness_set', 'Set the screen brightness level of the display.', z.object({})),
    ],
    mcp: [
      {
        name: 'mcp__homeassistant__HassLightSet',
        description: 'Sets the brightness of a light.',
        keywordTags: ['dim', 'lights', 'climate'],
        parameterList: [{ name: 'area', type: 'string', required: false }],
      },
      {
        name: 'mcp__homeassistant__HassTurnOff',
        description: 'Turns off a light or switch.',
        keywordTags: ['turn off', 'lights'],
        parameterList: [],
      },
    ],
  });

  it('prefers keyword-tagged app tools for dim commands', () => {
    const candidates = selectDecisionCandidates(surface, 'dim the living room to 30');
    expect(candidates.map((tool) => tool.name)).toEqual(['mcp__homeassistant__HassLightSet']);
  });

  it('matches native tools by their curated tags', () => {
    const candidates = selectDecisionCandidates(surface, 'take a screenshot of my screen');
    expect(candidates.map((tool) => tool.name)).toContain('screen_capture');
    expect(candidates).toHaveLength(1);
  });

  it('returns empty for off-topic queries (engine is skipped entirely)', () => {
    expect(selectDecisionCandidates(surface, 'what is the capital of France')).toEqual([]);
  });
});
