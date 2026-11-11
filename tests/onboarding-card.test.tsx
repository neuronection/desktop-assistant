// @vitest-environment jsdom
import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import type { ElectronAPI } from '@shared/types';
import type { OnboardingStatus } from '@shared/onboarding';
import { OnboardingCard } from '@renderer/chat-react/OnboardingCard';

afterEach(cleanup);

const status: OnboardingStatus = {
  platform: 'darwin',
  hotkey: 'Control+Space',
  permissions: [
    { kind: 'microphone', status: 'granted' },
    { kind: 'screen', status: 'denied' },
    { kind: 'accessibility', status: 'denied' },
  ],
  clipboardEnabled: false,
  providerConfigured: true,
  completed: false,
};

describe('OnboardingCard', () => {
  beforeEach(() => {
    (window as unknown as { electronAPI: Partial<ElectronAPI> }).electronAPI = {
      getOnboardingStatus: vi.fn(async () => status),
      completeOnboarding: vi.fn(async () => true),
      onSettingsOpen: vi.fn(async () => undefined),
    };
  });

  it('shows the hotkey and permissions, then completes', async () => {
    render(<OnboardingCard />);
    expect(await screen.findByText(/Control\+Space/)).toBeTruthy();
    expect(screen.getByText('Microphone (dictation)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(window.electronAPI.completeOnboarding).toHaveBeenCalled();
  });

  it('has no axe violations', async () => {
    const { container } = render(<OnboardingCard />);
    await screen.findByText(/Control\+Space/);
    const results = await axe.run(container);
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
