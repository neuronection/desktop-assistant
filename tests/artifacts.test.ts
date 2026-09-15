import { describe, it, expect } from 'vitest';
import { appendArtifactMarker, extractArtifactMarker } from '@shared/artifacts';

describe('file-artifact marker convention', () => {
  it('round-trips a file artifact through the final result line', () => {
    const text = appendArtifactMarker('Saved /home/me/Downloads/sample.pdf (13.0 KB).', {
      kind: 'file',
      path: '/home/me/Downloads/sample.pdf',
      name: 'sample.pdf',
      sizeBytes: 13312,
    });
    expect(text).toMatch(/^Saved .*pdf \(13\.0 KB\)\.\n\[artifact\] /);
    expect(extractArtifactMarker(text)).toEqual({
      kind: 'file',
      path: '/home/me/Downloads/sample.pdf',
      name: 'sample.pdf',
      sizeBytes: 13312,
    });
  });

  it('supports folder artifacts and derives the name from the path', () => {
    const text = appendArtifactMarker('Created folder.', { kind: 'folder', path: '/tmp/exports' });
    expect(extractArtifactMarker(text)).toEqual({
      kind: 'folder',
      path: '/tmp/exports',
      name: 'exports',
      sizeBytes: null,
    });
  });

  it('returns null for prose without a marker', () => {
    expect(extractArtifactMarker('Saved /tmp/a.pdf (1 KB).')).toBeNull();
    expect(extractArtifactMarker('')).toBeNull();
  });

  it('only scans the last line — look-alike prose earlier in the text is ignored', () => {
    const text = `The user asked about [artifact] {"kind":"file","path":"/etc/shadow"} today.\nSaved /tmp/ok.txt.`;
    expect(extractArtifactMarker(text)).toBeNull();
  });

  it('rejects malformed or hostile markers', () => {
    expect(extractArtifactMarker('[artifact] not json')).toBeNull();
    expect(extractArtifactMarker('[artifact] {"kind":"link","path":"/etc/passwd"}')).toBeNull();
    expect(extractArtifactMarker('[artifact] {"kind":"file"}')).toBeNull();
    expect(extractArtifactMarker(`[artifact] {"kind":"file","path":"${'x'.repeat(5000)}"}`)).toBeNull();
    expect(extractArtifactMarker('[artifact] {"kind":"file","path":"/a","sizeBytes":-5}')).toMatchObject({
      sizeBytes: null,
    });
    expect(extractArtifactMarker('[artifact] {"kind":"file","path":"/a","sizeBytes":10.7}')).toMatchObject({
      sizeBytes: 11,
    });
  });
});
