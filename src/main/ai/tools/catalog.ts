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
  return (schema._def.checks ?? []).some((check) => check.kind === 'int');
}

function describeInner(schema: ZodAny): ParamShape {
  const def = schema._def as {
    typeName: string;
    values?: unknown[];
    value?: unknown;
    innerType?: ZodAny;
    type?: ZodAny;
    elementType?: ZodAny;
    options?: ZodAny[];
    defaultValue?: () => unknown;
  };
  switch (def.typeName) {
    case 'ZodString':
      return { type: 'string', optional: false };
    case 'ZodNumber':
      return { type: intCheck(schema as z.ZodNumber) ? 'integer' : 'number', optional: false };
    case 'ZodBoolean':
      return { type: 'boolean', optional: false };
    case 'ZodEnum':
      return { type: 'enum', optional: false, enumValues: (def.values ?? []).map((value) => String(value)) };
    case 'ZodNativeEnum':
      return {
        type: 'enum',
        optional: false,
        enumValues: Object.values(def.values as unknown as Record<string, unknown>).map((value) => String(value)),
      };
    case 'ZodLiteral':
      return { type: 'enum', optional: false, enumValues: [String(def.value)] };
    case 'ZodArray': {
      const element = describeInner((def.type ?? def.elementType) as ZodAny);
      return { type: `array<${element.type}>`, optional: false };
    }
    case 'ZodObject':
    case 'ZodRecord':
      return { type: 'object', optional: false };
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      const parts = (def.options ?? []).map((option) => describeInner(option).type);
      return { type: [...new Set(parts)].join(' | '), optional: false };
    }
    case 'ZodOptional':
      return { ...describeInner(def.innerType as ZodAny), optional: true };
    case 'ZodDefault': {
      const inner = describeInner(def.innerType as ZodAny);
      let defaultValue = '';
      try {
        defaultValue = JSON.stringify(def.defaultValue?.()) ?? '';
      } catch {
        defaultValue = '';
      }
      return { ...inner, optional: true, defaultValue: defaultValue.slice(0, 120) };
    }
    case 'ZodNullable':
      return { ...describeInner(def.innerType as ZodAny), type: `${describeInner(def.innerType as ZodAny).type} | null` };
    case 'ZodReadonly':
      return describeInner(def.innerType as ZodAny);
    default:
      return { type: 'unknown', optional: false };
  }
}

/** Flattens a zod object schema into parameter rows for the settings UI. */
export function describeParameters(schema: ZodAny): ToolParameterInfo[] {
  const def = schema?._def as { typeName?: string } | undefined;
  if (!schema || def?.typeName !== 'ZodObject') {
    return [];
  }
  const shape = (schema as z.ZodObject<Record<string, ZodAny>>).shape;
  return Object.entries(shape).map(([name, field]) => {
    const described = describeInner(field);
    return {
      name,
      type: described.type,
      required: !described.optional,
      description: (field._def as { description?: string }).description,
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
