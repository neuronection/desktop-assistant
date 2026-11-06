// @vitest-environment jsdom
import { describe, expect, it, afterEach, vi } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PackPolicyEditor } from '@renderer/settings-react/apps/PackPolicyEditor';

afterEach(cleanup);

const SHIPPED = [
  'ALWAYS KEEP:',
  '- Anything user-created: documents, notes, photos, exports',
  '- Anything personal or hard to replace',
  '',
  'ALWAYS REVIEW:',
  '- Files that look personal or rare',
  '- Anything you would hesitate to delete yourself',
  '',
  'NEVER DELETE:',
  '- Version-control metadata and anything referenced by source control',
  'SCORING HINTS — safe: generated build output, dependency folders, caches, logs and temp files are safe to propose; recoverability: judge the content, not the name — source and documents are irreplaceable, caches and temp files are trivially regenerable',
].join('\n');

function Host({ initial }: { initial: string }) {
  const [guidelines, setGuidelines] = useState(initial);
  return <PackPolicyEditor guidelines={guidelines} onChange={setGuidelines} />;
}

describe('PackPolicyEditor (plan 55)', () => {
  it('decomposes a shipped policy preset into the sections, hints and preview', () => {
    render(<Host initial={SHIPPED} />);
    expect((screen.getByTestId('policy-keep') as HTMLTextAreaElement).value).toContain('Anything user-created');
    expect((screen.getByTestId('policy-review') as HTMLTextAreaElement).value).toContain('Files that look personal');
    expect((screen.getByTestId('policy-never') as HTMLTextAreaElement).value).toContain('Version-control metadata');
    expect((screen.getByTestId('policy-hint-safe') as HTMLInputElement).value).toContain('generated build output');
    expect((screen.getByTestId('policy-preview').textContent ?? '')).toContain('SCORING HINTS');
  });

  it('round-trips an edited section: compose(parse) stays in the labeled format', () => {
    render(<Host initial={SHIPPED} />);
    fireEvent.change(screen.getByTestId('policy-keep'), { target: { value: 'Anything user-created\nSource files' } });
    const composed = (screen.getByTestId('policy-preview').textContent ?? '').split('\n');
    expect(composed[0]).toBe('ALWAYS KEEP:');
    expect(composed.filter((line) => line.startsWith('- ')).length).toBe(5);
    expect(composed[composed.length - 1]).toContain('SCORING HINTS');
  });

  it('edits a hint without disturbing the sections', () => {
    render(<Host initial={SHIPPED} />);
    fireEvent.change(screen.getByTestId('policy-hint-safe'), { target: { value: 'generated output is safe' } });
    const preview = screen.getByTestId('policy-preview').textContent ?? '';
    expect(preview).toContain('safe: generated output is safe');
    expect(preview).toContain('ALWAYS REVIEW:');
  });
});
