import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp', getAppPath: () => process.cwd() },
}));

const { AttachmentService } = await import('@main/services/AttachmentService');
const { DEFAULT_CONFIG } = await import('@shared/config/AppConfig');

type AppConfigLike = typeof DEFAULT_CONFIG;

const freshService = (overrides: Partial<AppConfigLike['conversation']> = {}) => {
  (AttachmentService as { instance?: unknown }).instance = undefined;
  return AttachmentService.getInstance({
    ...DEFAULT_CONFIG,
    conversation: { ...DEFAULT_CONFIG.conversation, ...overrides },
  } as AppConfigLike);
};

/** Minimal single-page PDF with one text run ("Hello"), built with real
 * xref offsets so pdf-parse accepts it. */
function tinyPdf(text: string): string {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${0} >>\nstream\nBT /F1 12 Tf 10 50 Td (${text}) Tj ET\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(body.length);
    body += object;
  }
  const streamStart = body.indexOf('stream\n') + 'stream\n'.length;
  const streamEnd = body.indexOf('endstream');
  const length = streamEnd - streamStart;
  body = body.replace('<< /Length 0 >>', `<< /Length ${length} >>`);
  const xrefStart = body.length;
  let xref = 'xref\n0 6\n0000000000 65535 f \n';
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return body + xref;
}

beforeEach(() => {
  vi.resetModules();
});

describe('AttachmentService (plan 46 S2)', () => {
  it('is a per-process singleton', () => {
    const first = freshService();
    const second = AttachmentService.getInstance({ ...DEFAULT_CONFIG } as AppConfigLike);
    expect(second).toBe(first);
  });

  it('extracts text from a valid PDF data URL under extractText', async () => {
    const service = freshService({ pdfProcessingStrategy: 'extractText' });
    const pdf = Buffer.from(tinyPdf('Hello AttachmentService'), 'latin1');
    const result = await service.processPdf(`data:application/pdf;base64,${pdf.toString('base64')}`);
    expect(result.extractedText).toContain('Hello AttachmentService');
  });

  it('rejects a non-PDF data URL', async () => {
    const service = freshService();
    await expect(service.processPdf(`data:text/plain;base64,${Buffer.from('hi').toString('base64')}`)).rejects.toThrow(
      'Could not read text from the PDF file.'
    );
  });

  it('returns null text for an unknown processing strategy', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const service = freshService({ pdfProcessingStrategy: 'summarize' as never });
    const pdf = Buffer.from(tinyPdf('Hello'), 'latin1');
    const result = await service.processPdf(`data:application/pdf;base64,${pdf.toString('base64')}`);
    expect(result).toEqual({ extractedText: null });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
