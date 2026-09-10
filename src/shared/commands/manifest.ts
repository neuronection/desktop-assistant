import { z } from 'zod';
import { templateArity } from './template';

export const SECRET_REF_PATTERN = /^\$\{secret:([a-zA-Z0-9_.:-]+)\}$/;

export function isSecretRef(value: string): boolean {
  return SECRET_REF_PATTERN.test(value);
}

export function secretRefKey(value: string): string {
  const match = SECRET_REF_PATTERN.exec(value);
  return match?.[1] ?? '';
}

const aliasSchema = z
  .string()
  .min(1)
  .max(30)
  .regex(/^\/?[a-zA-Z0-9_-]+$/, 'aliases may contain letters, digits, - and _ only');

const manifestArgSchema = z.object({
  name: z.string().min(1).max(40).regex(/^[a-zA-Z0-9_-]+$/),
  description: z.string().max(200).optional(),
  required: z.boolean().optional(),
  type: z.enum(['string', 'number', 'boolean']).optional(),
});

const manifestCommandSchema = z
  .object({
    kind: z.enum(['http', 'tool', 'prompt']),
    name: z
      .string()
      .min(1)
      .max(40)
      .regex(/^[a-z0-9-]+$/, 'command names are lowercase letters, digits and dashes'),
    title: z.string().min(1).max(80),
    description: z.string().max(200).optional(),
    aliases: z.array(aliasSchema).max(8).optional(),
    icon: z.string().max(40).optional(),
    args: z.array(manifestArgSchema).max(8).optional(),
    toolName: z.string().max(64).optional(),
    argTemplate: z.record(z.string().max(4000)).optional(),
    promptTemplate: z.string().max(8000).optional(),
    method: z.enum(['GET', 'POST']).optional(),
    urlTemplate: z.string().max(2000).optional(),
    headers: z.record(z.string().max(1000)).optional(),
    bodyTemplate: z.string().max(10_000).optional(),
  })
  .superRefine((command, ctx) => {
    if (command.kind === 'tool' && !command.toolName) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['toolName'], message: 'tool commands require toolName' });
    }
    if (command.kind === 'tool' && !command.argTemplate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['argTemplate'], message: 'tool commands require argTemplate' });
    }
    if (command.kind === 'prompt' && !command.promptTemplate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['promptTemplate'], message: 'prompt commands require promptTemplate' });
    }
    if (command.kind === 'http') {
      if (!command.urlTemplate) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['urlTemplate'], message: 'http commands require urlTemplate' });
      }
      if (command.method === 'POST' && !command.bodyTemplate) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['bodyTemplate'], message: 'POST commands require bodyTemplate' });
      }
    }
  });

export const integrationManifestSchema = z.object({
  manifestVersion: z.literal(1),
  id: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9-]+$/, 'pack ids are lowercase letters, digits and dashes'),
  name: z.string().min(1).max(80),
  icon: z.string().max(40).optional(),
  commands: z.array(manifestCommandSchema).min(1).max(50),
});

export type IntegrationManifest = z.infer<typeof integrationManifestSchema>;
export type IntegrationManifestCommand = z.infer<typeof manifestCommandSchema>;

export function parseIntegrationManifest(json: string): { ok: true; manifest: IntegrationManifest } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'Manifest is not valid JSON.' };
  }
  const result = integrationManifestSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue.path.length > 0 ? ` (${issue.path.join('.')})` : '';
    return { ok: false, error: `${issue.message}${where}` };
  }
  return { ok: true, manifest: result.data };
}

/** Secret names referenced by a command's headers — values never leave the keyring. */
export function manifestSecretRefs(command: IntegrationManifestCommand): string[] {
  const names = new Set<string>();
  for (const value of Object.values(command.headers ?? {})) {
    const match = SECRET_REF_PATTERN.exec(value);
    if (match?.[1]) {
      names.add(match[1]);
    }
  }
  return [...names];
}

/** Arity a templated command's argv must satisfy (highest placeholder index across templates). */
export function manifestCommandArity(command: {
  urlTemplate?: string;
  bodyTemplate?: string;
  promptTemplate?: string;
  argTemplate?: Record<string, string>;
}): number {
  const templates = [command.urlTemplate ?? '', command.bodyTemplate ?? '', command.promptTemplate ?? '', ...Object.values(command.argTemplate ?? {})];
  return templates.reduce((max, template) => Math.max(max, templateArity(template)), 0);
}
