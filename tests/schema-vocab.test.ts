import { describe, expect, it } from 'vitest';
import {
  APP_INSTANCE_KINDS,
  APP_INSTANCE_STATUSES,
  AUTOMATION_OUTCOMES,
  CONNECTOR_AUTH_KINDS,
  CONNECTOR_KINDS,
  EMBEDDING_KINDS,
  NOTIFICATION_CLICK_ACTIONS,
  NOTIFICATION_KINDS,
  NOTIFICATION_SEVERITIES,
  appInstanceKindSchema,
  appInstanceStatusSchema,
  automationOutcomeSchema,
  connectorAuthKindSchema,
  connectorKindSchema,
  embeddingKindSchema,
  notificationClickActionSchema,
  notificationKindSchema,
  notificationSeveritySchema,
} from '@shared/schema/vocab';

describe('closed vocabularies for plan 36 status/kind columns (D2)', () => {
  const cases = [
    [embeddingKindSchema, EMBEDDING_KINDS],
    [notificationKindSchema, NOTIFICATION_KINDS],
    [notificationSeveritySchema, NOTIFICATION_SEVERITIES],
    [notificationClickActionSchema, NOTIFICATION_CLICK_ACTIONS],
    [appInstanceKindSchema, APP_INSTANCE_KINDS],
    [appInstanceStatusSchema, APP_INSTANCE_STATUSES],
    [automationOutcomeSchema, AUTOMATION_OUTCOMES],
    [connectorKindSchema, CONNECTOR_KINDS],
    [connectorAuthKindSchema, CONNECTOR_AUTH_KINDS],
  ] as const;

  it('every value in every vocabulary parses', () => {
    for (const [schema, values] of cases) {
      for (const value of values) {
        expect(schema.safeParse(value).success, `${schema.description}: ${value}`).toBe(true);
      }
    }
  });

  it('every vocabulary rejects an unknown value', () => {
    for (const [schema] of cases) {
      expect(schema.safeParse('not-a-real-value').success).toBe(false);
    }
  });

  it('the notification vocabulary matches the plan-42 contract', () => {
    expect(NOTIFICATION_SEVERITIES).toEqual(['info', 'success', 'warn', 'error']);
    expect(NOTIFICATION_CLICK_ACTIONS).toEqual([
      'none',
      'open-conversation',
      'open-settings',
      'open-pack-report',
      'open-path',
    ]);
  });

  it('the instance status vocabulary matches the family status states', () => {
    expect(APP_INSTANCE_STATUSES).toEqual(['ok', 'degraded', 'failing', 'stale']);
  });
});
