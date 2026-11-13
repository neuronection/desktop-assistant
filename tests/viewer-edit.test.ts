import { describe, expect, it } from 'vitest';
import {
  VIEWER_MIN_CROP_PX,
  editHint,
  effectiveCrop,
  imagePoint,
  imageRectBetween,
  redactWithinCrop,
  replaceEditedAttachment,
  visibleRedacts,
} from '@shared/viewer';

const natural = { width: 800, height: 400 };
const box = { left: 100, top: 50, width: 400, height: 200 };

describe('viewer image math', () => {
  it('maps a screen point onto image pixels (fit-scaled)', () => {
    expect(imagePoint({ x: 100, y: 50 }, box, natural)).toEqual({ x: 0, y: 0 });
    expect(imagePoint({ x: 500, y: 250 }, box, natural)).toEqual({ x: 800, y: 400 });
    expect(imagePoint({ x: 300, y: 150 }, box, natural)).toEqual({ x: 400, y: 200 });
  });

  it('never divides by a zero-sized box', () => {
    expect(imagePoint({ x: 10, y: 10 }, { left: 0, top: 0, width: 0, height: 0 }, natural)).toEqual({
      x: 0,
      y: 0,
    });
  });

  it('clamps a drag into the image, including a reversed drag', () => {
    expect(
      imageRectBetween({ x: 700, y: 350 }, { x: 900, y: 500 }, natural)
    ).toEqual({ x: 700, y: 350, width: 100, height: 50 });
    expect(imageRectBetween({ x: 400, y: 200 }, { x: 200, y: 100 }, natural)).toEqual({
      x: 200,
      y: 100,
      width: 200,
      height: 100,
    });
  });
});

describe('viewer crop and redact', () => {
  it('falls back to the whole image when the crop is tiny or absent', () => {
    expect(effectiveCrop(null, natural)).toEqual({ x: 0, y: 0, width: 800, height: 400 });
    expect(effectiveCrop({ x: 1, y: 1, width: 2, height: VIEWER_MIN_CROP_PX - 1 }, natural)).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 400,
    });
    expect(effectiveCrop({ x: 10, y: 10, width: 100, height: 50 }, natural)).toEqual({
      x: 10,
      y: 10,
      width: 100,
      height: 50,
    });
  });

  it('moves redact rects into crop space and drops what the crop excludes', () => {
    const crop = { x: 100, y: 100, width: 300, height: 200 };
    expect(redactWithinCrop({ x: 150, y: 140, width: 40, height: 20 }, crop)).toEqual({
      x: 50,
      y: 40,
      width: 40,
      height: 20,
    });
    const visible = visibleRedacts(
      [
        { x: 150, y: 140, width: 40, height: 20 },
        { x: 700, y: 350, width: 50, height: 40 },
      ],
      crop
    );
    expect(visible).toHaveLength(1);
  });

  it('explains the current gesture in one line', () => {
    expect(editHint('crop', null)).toContain('keep');
    expect(editHint('crop', { x: 0, y: 0, width: 10, height: 10 })).toContain('Apply');
    expect(editHint('redact', null)).toContain('private');
  });
});

describe('applying an edit back to the draft', () => {
  const attachments = [
    { type: 'image', data: 'data:image/png;base64,OLD' },
    { type: 'screen-capture', data: 'data:image/jpeg;base64,OLD', capture: { kind: 'window', label: 'Firefox', width: 900, height: 600 } },
    { type: 'pdf', data: 'data:application/pdf;base64,PDF' },
  ];

  it('replaces only the attachment the viewer opened and refreshes its size', () => {
    const next = replaceEditedAttachment(attachments, 1, {
      dataUrl: 'data:image/jpeg;base64,NEW',
      width: 500,
      height: 300,
    });
    expect(next[1]).toMatchObject({
      data: 'data:image/jpeg;base64,NEW',
      capture: { label: 'Firefox', width: 500, height: 300 },
    });
    expect(next[0].data).toBe('data:image/png;base64,OLD');
    expect(next[2].data).toBe('data:application/pdf;base64,PDF');
  });

  it('follows the image the viewer opened even when chips shifted', () => {
    // The first chip was removed while the viewer was open: the remembered
    // index now points at a different image, so identity decides.
    const shifted = attachments.slice(1);
    const next = replaceEditedAttachment(shifted, 1, {
      dataUrl: 'data:image/jpeg;base64,NEW',
      width: 500,
      height: 300,
      previousData: 'data:image/jpeg;base64,OLD',
    });
    expect(next[0].data).toBe('data:image/jpeg;base64,NEW');
    expect(next[1].data).toBe('data:application/pdf;base64,PDF');
  });

  it('drops an edit whose image is no longer attached', () => {
    const next = replaceEditedAttachment(attachments, 1, {
      dataUrl: 'data:image/jpeg;base64,NEW',
      width: 500,
      height: 300,
      previousData: 'data:image/png;base64,GONE',
    });
    expect(next.map((attachment) => attachment.data)).toEqual(
      attachments.map((attachment) => attachment.data)
    );
  });

  it('never overwrites a different slot or a PDF', () => {
    const next = replaceEditedAttachment(attachments, 2, {
      dataUrl: 'data:image/jpeg;base64,NEW',
      width: 10,
      height: 10,
    });
    expect(next[2].data).toBe('data:application/pdf;base64,PDF');
  });
});
