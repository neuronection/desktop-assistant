import { z } from 'zod';

export const EMBEDDING_KINDS = ['message', 'memory', 'doc-chunk'] as const;
export const embeddingKindSchema = z.enum(EMBEDDING_KINDS);
export type EmbeddingKind = z.infer<typeof embeddingKindSchema>;

export const NOTIFICATION_KINDS = ['system', 'schedule', 'pack-run', 'download', 'memory', 'tool'] as const;
export const notificationKindSchema = z.enum(NOTIFICATION_KINDS);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

export const NOTIFICATION_SEVERITIES = ['info', 'success', 'warn', 'error'] as const;
export const notificationSeveritySchema = z.enum(NOTIFICATION_SEVERITIES);
export type NotificationSeverity = z.infer<typeof notificationSeveritySchema>;

export const NOTIFICATION_CLICK_ACTIONS = [
  'none',
  'open-conversation',
  'open-settings',
  'open-pack-report',
  'open-path',
] as const;
export const notificationClickActionSchema = z.enum(NOTIFICATION_CLICK_ACTIONS);
export type NotificationClickAction = z.infer<typeof notificationClickActionSchema>;

export const APP_INSTANCE_KINDS = ['tool', 'mcp', 'pack'] as const;
export const appInstanceKindSchema = z.enum(APP_INSTANCE_KINDS);
export type AppInstanceKind = z.infer<typeof appInstanceKindSchema>;

export const APP_INSTANCE_STATUSES = ['ok', 'degraded', 'failing', 'stale'] as const;
export const appInstanceStatusSchema = z.enum(APP_INSTANCE_STATUSES);
export type AppInstanceStatus = z.infer<typeof appInstanceStatusSchema>;

export const AUTOMATION_OUTCOMES = ['ok', 'failed', 'skipped'] as const;
export const automationOutcomeSchema = z.enum(AUTOMATION_OUTCOMES);
export type AutomationOutcome = z.infer<typeof automationOutcomeSchema>;

export const CONNECTOR_KINDS = ['google-calendar', 'nextcloud', 'email', 'generic'] as const;
export const connectorKindSchema = z.enum(CONNECTOR_KINDS);
export type ConnectorKind = z.infer<typeof connectorKindSchema>;

export const CONNECTOR_AUTH_KINDS = ['oauth2', 'app-password', 'token'] as const;
export const connectorAuthKindSchema = z.enum(CONNECTOR_AUTH_KINDS);
export type ConnectorAuthKind = z.infer<typeof connectorAuthKindSchema>;
