import { z } from 'zod';
import type { Attachment } from '../types';

const imageAttachmentSchema = z
  .object({ type: z.literal('image'), data: z.string() })
  .passthrough();
/**
 * What a capture carries (plan 82): the label/kind/dimensions the composer chip
 * and the viewer need. `sourceId` is optional — the native capture engine reads
 * its own sources and no longer stamps one.
 */
const captureMetaSchema = z
  .object({
    kind: z.enum(['window', 'region', 'display']),
    label: z.string(),
    width: z.number(),
    height: z.number(),
    displayId: z.number().optional(),
    rect: z
      .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
      .optional(),
  })
  .passthrough();

const screenCaptureAttachmentSchema = z
  .object({
    type: z.literal('screen-capture'),
    data: z.string(),
    /** Older rows carry a `desktopCapturer` id; new captures leave it out. */
    sourceId: z.string().optional(),
    capture: captureMetaSchema.optional(),
  })
  .passthrough();
const pdfAttachmentSchema = z
  .object({ type: z.literal('pdf'), data: z.string(), filename: z.string(), extractedText: z.string().optional() })
  .passthrough();

export const attachmentSchema: z.ZodType<Attachment> = z.union([
  imageAttachmentSchema,
  screenCaptureAttachmentSchema,
  pdfAttachmentSchema,
]);

export const attachmentListSchema: z.ZodType<Attachment[]> = z.array(attachmentSchema);

export function parseAttachmentList(value: unknown): Attachment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const parsed = attachmentListSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function validateAttachmentList(value: unknown): Attachment[] {
  const parsed = attachmentListSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Invalid attachment list${issue ? ` at ${issue.path.join('.')}: ${issue.message}` : ''}`);
  }
  return parsed.data;
}
