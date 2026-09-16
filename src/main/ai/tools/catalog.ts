import { z } from 'zod';
import type { ToolCatalogEntry, ToolParameterInfo } from '@shared/turns';
import type { NativeToolDefinition } from './types';
import { resolveVerification, type ToolPolicySnapshot } from './policy';

type ZodAny = z.ZodTypeAny;

interface ParamShape {
  type: string;
  optional: boolean;
  enumValues?: string[];
  defaultValue?: string;
}

function intCheck(schema: z.ZodNumber): boolean {
  const checks =
    (schema.def as { checks?: Array<{ def?: { check?: string; format?: string } }> }).checks ?? [];
  return checks.some(
    (check) => check.def?.check === 'number_format' && (check.def.format === 'int' || check.def.format === 'safeint')
  );
}

function describeInner(schema: ZodAny): ParamShape {
  const def = schema.def as {
    type: string;
    entries?: Record<string, unknown>;
    values?: unknown[];
    innerType?: ZodAny;
    element?: ZodAny;
    options?: ZodAny[];
    format?: string;
    defaultValue?: unknown;
  };
  switch (def.type) {
    case 'string':
      return { type: 'string', optional: false };
    case 'number':
      return { type: intCheck(schema as z.ZodNumber) ? 'integer' : 'number', optional: false };
    case 'boolean':
      return { type: 'boolean', optional: false };
    case 'enum':
      return {
        type: 'enum',
        optional: false,
        enumValues: Object.values(def.entries ?? {}).map((value) => String(value)),
      };
    case 'literal':
      return { type: 'enum', optional: false, enumValues: (def.values ?? []).map((value) => String(value)) };
    case 'array': {
      const element = describeInner(def.element as ZodAny);
      return { type: `array<${element.type}>`, optional: false };
    }
    case 'object':
    case 'record':
      return { type: 'object', optional: false };
    case 'union':
    case 'discriminated_union': {
      const parts = (def.options ?? []).map((option) => describeInner(option).type);
      return { type: [...new Set(parts)].join(' | '), optional: false };
    }
    case 'optional':
      return { ...describeInner(def.innerType as ZodAny), optional: true };
    case 'default': {
      const inner = describeInner(def.innerType as ZodAny);
      let defaultValue = '';
      try {
        const value = typeof def.defaultValue === 'function' ? (def.defaultValue as () => unknown)() : def.defaultValue;
        defaultValue = value === undefined || value === null ? '' : JSON.stringify(value) ?? '';
      } catch {
        defaultValue = '';
      }
      return { ...inner, optional: true, defaultValue: defaultValue.slice(0, 120) };
    }
    case 'nullable':
      return { ...describeInner(def.innerType as ZodAny), type: `${describeInner(def.innerType as ZodAny).type} | null` };
    case 'readonly':
      return describeInner(def.innerType as ZodAny);
    default:
      return { type: 'unknown', optional: false };
  }
}

/** Flattens a zod object schema into parameter rows for the settings UI. */
export function describeParameters(schema: ZodAny): ToolParameterInfo[] {
  if (!schema || (schema.def as { type?: string }).type !== 'object') {
    return [];
  }
  const shape = (schema as unknown as { shape: Record<string, ZodAny> }).shape;
  return Object.entries(shape).map(([name, field]) => {
    const described = describeInner(field);
    return {
      name,
      type: described.type,
      required: !described.optional,
      description: field.description,
      ...(described.enumValues ? { enumValues: described.enumValues } : {}),
      ...(described.defaultValue ? { defaultValue: described.defaultValue } : {}),
    };
  });
}

/** Catalog rows for the native registry against the current policy snapshot. */
export function nativeCatalogEntries(
  definitions: NativeToolDefinition[],
  snapshot: ToolPolicySnapshot
): ToolCatalogEntry[] {
  return definitions.map((def) => {
    const effective = resolveVerification(def.name, def.risk, snapshot);
    return {
      name: def.name,
      description: def.description,
      risk: def.risk,
      category: def.category,
      editableArgs: def.editableArgs ?? false,
      enabled: !snapshot.disabledTools.includes(def.name),
      granted: snapshot.toolGrants[def.name] === 'always',
      source: 'native' as const,
      parameters: describeParameters(def.schema),
      verification: effective.settings,
      verificationCustom: effective.custom,
    };
  });
}
