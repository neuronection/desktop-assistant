// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { NoticeBanner } from '@renderer/chat-react/NoticeBanner';
import { noticeActionFor, nextNotice, toNoticeEvent } from '@renderer/chat-react/notice';
import { TEXT } from '@shared/constants/text';

afterEach(cleanup);

const NO_MODEL_ERROR = "Error invoking remote method 'ai:turn-start': Error: No model is assigned to the chat task. Pick one in Settings → Models.";

describe('noticeActionFor', () => {
  it('routes the no-model error to setup when nothing is configured', () => {
    expect(noticeActionFor(NO_MODEL_ERROR, false)).toEqual({ label: TEXT.NOTICE_ACTION_SETUP, target: 'setup' });
  });

  it('routes the no-model error to the model picker when a provider exists', () => {
    expect(noticeActionFor(NO_MODEL_ERROR, true)).toEqual({ label: TEXT.NOTICE_ACTION_MODELS, target: 'tasks' });
  });

  it('leaves unrelated errors and successes alone', () => {
    expect(noticeActionFor('Provider unreachable', false)).toBeNull();
    expect(noticeActionFor('Saved', true)).toBeNull();
  });
});

describe('notice helpers', () => {
  it('parses notice events defensively', () => {
    expect(toNoticeEvent({ type: 'error', message: 'boom' })).toEqual({ type: 'error', message: 'boom' });
    expect(toNoticeEvent({ type: 'nope', message: 'boom' })).toBeNull();
    expect(toNoticeEvent('junk')).toBeNull();
    expect(nextNotice(null, { type: 'error', message: 'boom' }, 42).id).toBe(42);
  });
});

describe('NoticeBanner action', () => {
  it('renders the deep-link button and activates it', () => {
    const onActivate = vi.fn();
    const onDismiss = vi.fn();
    render(
      <NoticeBanner
        notice={{ id: 1, type: 'error', message: NO_MODEL_ERROR }}
        onDismiss={onDismiss}
        action={{ label: 'Set up AI', onActivate }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Set up AI' }));
    expect(onActivate).toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).not.toContain('{');
  });

  it('renders plain errors without an action', () => {
    render(<NoticeBanner notice={{ id: 1, type: 'error', message: 'Provider unreachable' }} onDismiss={vi.fn()} />);
    expect(screen.queryByRole('button', { name: TEXT.NOTICE_ACTION_SETUP })).toBeNull();
  });
});
