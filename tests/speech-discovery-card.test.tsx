// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { SpeechDiscoveryCard } from '@renderer/chat-react/SpeechDiscoveryCard';
import { TEXT } from '@shared/constants/text';

afterEach(cleanup);

describe('speech discovery card (plan 58 §6 / plan 59 S3)', () => {
  it('reaches the unconfigured user with a setup card', () => {
    const onSetupVoice = vi.fn();
    const { container } = render(<SpeechDiscoveryCard assigned={false} onSetupVoice={onSetupVoice} />);
    expect(screen.getByText(TEXT.SPEECH_DISCOVERY_SETUP_TITLE)).toBeTruthy();
    expect(screen.getByText(TEXT.SPEECH_DISCOVERY_SETUP_BODY)).toBeTruthy();
    screen.getByRole('button', { name: TEXT.SPEECH_DISCOVERY_SETUP_CTA }).click();
    expect(onSetupVoice).toHaveBeenCalledTimes(1);
  });

  it('renders nothing once a speech model is assigned — the Shortcuts sheet owns discovery', () => {
    const { container } = render(<SpeechDiscoveryCard assigned onSetupVoice={vi.fn()} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('button', { name: TEXT.SPEECH_DISCOVERY_SETUP_CTA })).toBeNull();
  });

  it('keeps the setup card accessible', async () => {
    const { container } = render(<SpeechDiscoveryCard assigned={false} onSetupVoice={vi.fn()} />);
    const results = await axe.run(container);
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
