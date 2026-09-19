import { Button } from '@neuronection/assistant-ui/button';
import { LLMProvider } from '@shared/types';
import { hasConfiguredProvider } from '@shared/ai/providerPresets';
import { TEXT } from '@shared/constants/text';
import type { JSX } from 'react';

export function SetupEmptyStateCta({ providers }: { providers?: LLMProvider[] }): JSX.Element | null {
  if (hasConfiguredProvider(providers)) {
    return null;
  }
  return (
    <div className="mt-3">
      <Button variant="outline" size="sm" onClick={() => void window.electronAPI.onSettingsOpen({ tab: 'api' })}>
        {TEXT.SETUP_EMPTY_STATE_CTA}
      </Button>
    </div>
  );
}
