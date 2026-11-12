import { z } from 'zod';
import type { CaptureOutcome } from '@shared/capture';
import type { NativeToolDefinition, ToolResult } from '../types';
import { getCaptureService } from '../capture-bridge';

/** The overlay waits up to 120 s on the user; the tool keeps a little slack. */
const INTERACTIVE_TIMEOUT_MS = 135_000;
const PLAIN_TIMEOUT_MS = 20_000;

const schema = z
  .object({
    interactive: z
      .boolean()
      .optional()
      .describe(
        'Open the capture overlay so the user can click a window or drag a region. Use it when you need a specific part of the screen and the user is present; it waits up to two minutes.'
      ),
    windowName: z
      .string()
      .min(1)
      .optional()
      .describe('Capture the window whose title contains this text (best-effort; window_list lists titles).'),
  })
  .strict()
  .refine((args) => !(args.interactive === true && args.windowName !== undefined), {
    message: 'Use either interactive or windowName, not both.',
  });

type CaptureArgs = z.infer<typeof schema>;

function blocksFor(outcome: CaptureOutcome, intro: string): ToolResult {
  if (!outcome.ok) {
    if (outcome.reason === 'cancelled') {
      return 'The user cancelled the screen capture request.';
    }
    if (outcome.reason === 'unavailable') {
      return `Error: ${outcome.message ?? 'screen capture is not available on this system.'}`;
    }
    return `Error: screen capture failed (${outcome.message ?? 'unknown error'}).`;
  }
  const { meta } = outcome;
  return [
    {
      type: 'text',
      text: `${intro} (${meta.width}x${meta.height}). The image is attached below.`,
    },
    { type: 'image', url: outcome.dataUrl, mimeType: 'image/jpeg' },
  ];
}

/**
 * The agent's screen access (plan 80 S9): no pixel coordinates, ever.
 *
 * - default → the display under the pointer (what "a screenshot" means)
 * - `windowName` → that window's own pixels
 * - `interactive` → the frozen-frame overlay: the user points, the model gets
 *   exactly that window or region. The overlay *is* the question.
 */
export const screenCaptureTool: NativeToolDefinition<CaptureArgs> = {
  name: 'screen_capture',
  description:
    'Capture what is on the screen: the whole display under the pointer by default, a named window, or a user-picked window/region when `interactive` is set. Use it when the user asks what is on their screen or asks you to look at something. Prefer `interactive` when you need a specific window or area and the user is present — never guess coordinates. The image is returned so you can inspect and describe it.',
  schema,
  risk: 'read-only',
  category: 'desktop',
  timeoutMs: PLAIN_TIMEOUT_MS,
  timeoutFor: (args) => (args.interactive === true ? INTERACTIVE_TIMEOUT_MS : PLAIN_TIMEOUT_MS),
  summarize: (args) =>
    args.interactive === true
      ? 'Ask the user what to capture'
      : args.windowName
        ? `Capture window '${args.windowName}'`
        : 'Captured the screen',
  async exec(args, ctx) {
    const service = getCaptureService();
    if (!service) {
      return 'Error: screen capture is not available right now.';
    }
    const onAbort = (): void => service.cancel();
    ctx.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      if (args.windowName) {
        return blocksFor(
          await service.captureNamedWindow(args.windowName),
          `Screenshot captured of window '${args.windowName}'`
        );
      }
      if (args.interactive === true) {
        const outcome = await service.begin({ intent: 'overlay' });
        return blocksFor(outcome, `Screenshot captured of ${outcome.ok ? outcome.meta.label : 'the selection'}`);
      }
      return blocksFor(await service.begin({ intent: 'display' }), 'Screenshot captured of the display under the pointer');
    } finally {
      ctx.signal?.removeEventListener('abort', onAbort);
    }
  },
};

export const screenCaptureSchema = schema;
