import { z } from 'zod';
import type { NativeToolDefinition } from '../types';

const MAX_CAPTURE_WIDTH = 1280;

const regionSchema = z.object({
  x: z.number().int().min(0).describe('Left edge in logical pixels.'),
  y: z.number().int().min(0).describe('Top edge in logical pixels.'),
  width: z.number().int().min(1).describe('Width in logical pixels.'),
  height: z.number().int().min(1).describe('Height in logical pixels.'),
});

const schema = z
  .object({
    region: regionSchema.optional().describe('Capture only this region of the primary display.'),
    windowName: z
      .string()
      .min(1)
      .optional()
      .describe('Capture a window whose title or app name contains this text (best-effort per OS).'),
  })
  .refine((args) => !(args.region && args.windowName), {
    message: 'Use either region or windowName, not both.',
  });

type CaptureArgs = z.infer<typeof schema>;

function clampRect(
  x: number,
  y: number,
  width: number,
  height: number,
  bounds: { width: number; height: number }
): { x: number; y: number; width: number; height: number } {
  const clampedX = Math.max(0, Math.min(x, bounds.width - 1));
  const clampedY = Math.max(0, Math.min(y, bounds.height - 1));
  return {
    x: clampedX,
    y: clampedY,
    width: Math.max(1, Math.min(width, bounds.width - clampedX)),
    height: Math.max(1, Math.min(height, bounds.height - clampedY)),
  };
}

export const screenCaptureTool: NativeToolDefinition<CaptureArgs> = {
  name: 'screen_capture',
  description:
    'Capture a screenshot of the primary display, a region of it, or a specific window. Use when the user asks what is on their screen or asks you to look at something on screen. The image is returned so you can inspect and describe it. Window capture is best-effort and may be unavailable on some systems.',
  schema,
  risk: 'read-only',
  category: 'desktop',
  timeoutMs: 10_000,
  summarize: (args) =>
    args.windowName
      ? `Capture window '${args.windowName}'`
      : args.region
        ? `Capture screen region ${args.region.width}x${args.region.height}`
        : 'Captured the screen',
  async exec(args) {
    const { desktopCapturer, screen } = await import('electron');

    if (args.windowName) {
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 1280, height: 800 },
      });
      const needle = args.windowName.toLowerCase();
      const match = sources.find((source) => source.name.toLowerCase().includes(needle));
      if (!match) {
        return `Error: no window matching '${args.windowName}' was found. Available windows: ${
          sources
            .slice(0, 10)
            .map((source) => source.name)
            .join(', ') || 'none'
        }.`;
      }
      const jpeg = match.thumbnail.toJPEG(80);
      if (!jpeg || jpeg.length === 0) {
        return 'Error: window capture is not available for that window on this system.';
      }
      return [
        { type: 'text', text: `Screenshot captured of window '${match.name}'. The image is attached below.` },
        { type: 'image', url: `data:image/jpeg;base64,${jpeg.toString('base64')}`, mimeType: 'image/jpeg' },
      ];
    }

    const primary = screen.getPrimaryDisplay();
    const pixelWidth = Math.max(1, Math.round(primary.size.width * primary.scaleFactor));
    const pixelHeight = Math.max(1, Math.round(primary.size.height * primary.scaleFactor));

    let thumbnailSize: { width: number; height: number };
    if (args.region) {
      thumbnailSize = { width: pixelWidth, height: pixelHeight };
    } else {
      const scale = Math.min(1, MAX_CAPTURE_WIDTH / pixelWidth);
      thumbnailSize = {
        width: Math.max(1, Math.round(pixelWidth * scale)),
        height: Math.max(1, Math.round(pixelHeight * scale)),
      };
    }

    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize });
    const source = sources.find((s) => s.display_id === String(primary.id)) ?? sources[0];
    if (!source) {
      throw new Error('No screen source was available to capture.');
    }

    let image = source.thumbnail;
    let text = `Screenshot captured of the primary display (${primary.size.width}x${primary.size.height}). The image is attached below.`;

    if (args.region) {
      const scale = primary.scaleFactor;
      const rect = clampRect(
        Math.round(args.region.x * scale),
        Math.round(args.region.y * scale),
        Math.round(args.region.width * scale),
        Math.round(args.region.height * scale),
        { width: image.getSize().width, height: image.getSize().height }
      );
      image = image.crop(rect);
      if (rect.width > MAX_CAPTURE_WIDTH) {
        image = image.resize({ width: MAX_CAPTURE_WIDTH });
      }
      text = `Screenshot captured of the requested region (${args.region.width}x${args.region.height}) on the primary display. The image is attached below.`;
    }

    const jpeg = image.toJPEG(80);
    if (!jpeg || jpeg.length === 0) {
      throw new Error('Screen capture produced an empty image.');
    }
    return [
      { type: 'text', text },
      { type: 'image', url: `data:image/jpeg;base64,${jpeg.toString('base64')}`, mimeType: 'image/jpeg' },
    ];
  },
};

export const screenCaptureSchema = schema;
