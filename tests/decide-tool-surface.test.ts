import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { decisionToolSurface, mcpParameterSchema, DECISION_TOOL_CAP } from '@main/ai/decide/tool-surface';
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
  it('projects native zod schemas to JSON schema', () => {
    const [tool] = decisionToolSurface({
      native: [
        nativeDef(
          'light_turn_on',
          'Turn on a light.',
          z.object({ entity_id: z.string().describe('Light entity id'), brightness_pct: z.number().optional() })
        ),
      ],
    });
    expect(tool?.name).toBe('light_turn_on');
    expect(tool?.description).toBe('Turn on a light.');
    expect(tool?.parameters).toMatchObject({
      type: 'object',
      properties: { entity_id: { type: 'string', description: 'Light entity id' } },
      required: ['entity_id'],
    });
  });

  it('caps descriptions and the surface size', () => {
    const longDescription = 'x'.repeat(400);
    const native = Array.from({ length: DECISION_TOOL_CAP + 10 }, (_, i) =>
      nativeDef(`tool_${i}`, longDescription, z.object({}))
    );
    const surface = decisionToolSurface({ native });
    expect(surface).toHaveLength(DECISION_TOOL_CAP);
    expect(surface[0]?.description.length).toBeLessThanOrEqual(240);
    expect(surface[0]?.description.endsWith('…')).toBe(true);
  });

  it('appends MCP tools after native ones and converts their parameters', () => {
    const surface = decisionToolSurface({
      native: [nativeDef('native_one', 'Native tool.', z.object({}))],
      mcp: [
        {
          name: 'mcp__homeassistant__light_turn_on',
          description: 'HA light on',
          parameterList: [{ name: 'entity_id', type: 'string', required: true }],
        },
      ],
    });
    expect(surface.map((tool) => tool.name)).toEqual(['native_one', 'mcp__homeassistant__light_turn_on']);
    expect(surface[1]?.parameters).toMatchObject({ type: 'object', properties: { entity_id: { type: 'string' } } });
  });
});
