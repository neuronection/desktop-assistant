// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { ExpandableTraceMeta } from '@renderer/chat-react/TraceTimeline';
import { TEXT } from '@shared/constants/text';
import type { TurnMetadata } from '@shared/turns';

afterEach(cleanup);

const META: TurnMetadata = {
  outcome: 'ok',
  model: 'mini',
  durationMs: 1900,
  steps: [{ id: 's1', phase: 'tool_call', label: 'web_search', toolName: 'web_search', startedAt: 1000, endedAt: 1400 }],
} as unknown as TurnMetadata;

describe('ExpandableTraceMeta', () => {
  it('unfolds the trace timeline on click and folds it back', () => {
    render(<ExpandableTraceMeta meta={META} />);
    const toggle = screen.getByTitle(TEXT.TRACE_META_SHOW);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector("[data-as='chat-trace-timeline']")).toBeNull();

    fireEvent.click(toggle);
    const open = screen.getByTitle(TEXT.TRACE_META_HIDE);
    expect(open.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector("[data-as='chat-trace-timeline']")).toBeTruthy();
    expect(screen.getByText('web_search')).toBeTruthy();

    fireEvent.click(open);
    expect(screen.getByTitle(TEXT.TRACE_META_SHOW)).toBeTruthy();
    expect(document.querySelector("[data-as='chat-trace-timeline']")).toBeNull();
  });

  it('pins the single-toggle rule: the library summary button stays hidden inside the disclosure', () => {
    const css = readFileSync(resolve(__dirname, '../src/renderer/styles/chat-app.css'), 'utf8');
    expect(css).toMatch(
      /\.da-trace-inline \[data-as='chat-trace-timeline'\] > button:first-child\s*\{[^}]*display:\s*none/s
    );
  });

  it('pins the wide wrapping step labels in chat-app.css', () => {
    const css = readFileSync(resolve(__dirname, '../src/renderer/styles/chat-app.css'), 'utf8');
    expect(css).toMatch(
      /\[data-as='chat-trace-timeline'\] \[data-kind\] > div:first-child > button:first-child,\s*\[data-as='chat-trace-timeline'\] \[data-kind\] > div:first-child > span:first-child\s*\{[^}]*width:\s*10rem[^}]*white-space:\s*normal/s
    );
    expect(css).toMatch(/\[data-as='chat-trace-timeline'\] \[data-as='chat-trace-detail'\]\s*\{[^}]*margin-left:\s*10\.5rem/s);
  });

  it('keeps the static badge for turns with no tools or decision steps', () => {
    render(<ExpandableTraceMeta meta={{ outcome: 'ok', model: 'mini', durationMs: 500 } as TurnMetadata} />);
    expect(document.querySelector("[data-as='chat-trace-meta']")).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('falls back to the static badge when there is no metadata at all', () => {
    const { container } = render(<ExpandableTraceMeta meta={undefined} />);
    expect(container.querySelector('[data-as="chat-trace-meta"]')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
