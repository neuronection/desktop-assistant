import { z } from 'zod';

export const connectorScopesSchema = z.array(z.string());

export function parseConnectorScopes(value: unknown): string[] {
  const parsed = connectorScopesSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function validateConnectorScopes(value: unknown): string[] {
  const parsed = connectorScopesSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error('Invalid connector scopes');
  }
  return parsed.data;
}
