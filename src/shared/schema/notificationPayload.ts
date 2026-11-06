import { z } from 'zod';

export const notificationPayloadSchema = z.record(z.string(), z.unknown());

export function parseNotificationPayload(value: unknown): Record<string, unknown> {
  const parsed = notificationPayloadSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

export function validateNotificationPayload(value: unknown): Record<string, unknown> {
  const parsed = notificationPayloadSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error('Invalid notification payload');
  }
  return parsed.data;
}
