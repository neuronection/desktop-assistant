import type { ReactElement } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import { ProviderCard } from '@neuronection/assistant-ui/provider-card';
import { Pencil, PlugZap, Sparkles, Trash2 } from 'lucide-react';
import type { LLMProvider, ProviderTestResult } from '@shared/types';
import { TEXT, interpolate } from '@shared/constants/text';
import { presetKeyForProvider, type AnyPresetKey } from '@shared/ai/providerPresets';
import { SetupFirstRunCard } from '../tabs/SetupWizard';

interface ApiProvidersGroupProps {
  firstRunCard: boolean;
  onOpenWizard: (preset?: AnyPresetKey) => void;
  providers: LLMProvider[];
  defaultProviderId: string | null;
  tests: Record<string, ProviderTestResult>;
  testingId: string | null;
  reSettingUpId: string | null;
  onReSetup: (provider: LLMProvider) => void;
  onEdit: (provider: LLMProvider) => void;
  onTest: (provider: LLMProvider) => Promise<void>;
  onDelete: (provider: LLMProvider) => void;
}

export function ApiProvidersGroup({
  firstRunCard,
  onOpenWizard,
  providers,
  defaultProviderId,
  tests,
  testingId,
  reSettingUpId,
  onReSetup,
  onEdit,
  onTest,
  onDelete,
}: ApiProvidersGroupProps): ReactElement {
  return (
    <div role="tabpanel" aria-label={TEXT.API_PROVIDERS_SECTION} className="space-y-8">
      {firstRunCard && <SetupFirstRunCard onOpenWizard={onOpenWizard} />}
      <section className="space-y-3">
        <div className="space-y-1">
          <h3 className="text-base font-semibold">{TEXT.API_PROVIDERS_SECTION}</h3>
          <p className="text-sm opacity-60">{TEXT.API_PROVIDERS_HINT}</p>
        </div>
        <ul className="space-y-2">
          {providers.length === 0 && <li className="text-sm opacity-50">{TEXT.API_NO_PROVIDERS}</li>}
          {providers.map((p) => {
            const isDefault = defaultProviderId === p.id;
            const test = tests[p.id];
            const setupKey = presetKeyForProvider(p);
            const testing = testingId === p.id;
            // Career ProvidersTab ruling: management actions live in the
            // `⋯` overflow menu; the connection test is a menu action too
            // (pending/disabled while testing), never an inline button.
            const actions = [
              ...(setupKey
                ? [
                    {
                      key: 'setup',
                      label: TEXT.SETUP_SUBMIT,
                      icon: Sparkles,
                      disabled: reSettingUpId !== null,
                      pending: reSettingUpId === p.id,
                      onSelect: () => onReSetup(p),
                    },
                  ]
                : []),
              {
                key: 'edit',
                label: TEXT.EDIT_BUTTON,
                icon: Pencil,
                onSelect: () => onEdit(p),
              },
              {
                key: 'test',
                label: TEXT.API_TEST,
                icon: PlugZap,
                disabled: testing,
                pending: testing,
                onSelect: () => void onTest(p),
              },
              {
                key: 'delete',
                label: TEXT.DELETE_BUTTON,
                icon: Trash2,
                danger: true,
                disabled: providers.length <= 1,
                onSelect: () => onDelete(p),
              },
            ];
            return (
              <li key={p.id}>
                <ProviderCard
                  name={p.name}
                  logoPreset={setupKey ?? p.name}
                  nameTitle={p.apiBase}
                  subtitle={p.apiBase}
                  badges={[
                    ...(isDefault
                      ? [{ key: 'default', label: '★', title: TEXT.API_PROVIDERS_DEFAULT_TITLE }]
                      : []),
                    { key: 'type', label: p.type },
                    ...(!p.apiKeyHint
                      ? [
                          {
                            key: 'key',
                            label: TEXT.API_PROVIDERS_NO_KEY,
                            danger: true,
                            testId: `provider-key-${p.id}`,
                          },
                        ]
                      : []),
                  ]}
                  status={testing ? 'testing' : test ? (test.ok ? 'ok' : 'fail') : 'idle'}
                  idleLabel={TEXT.API_PROVIDERS_IDLE}
                  okLabel={TEXT.API_TEST_OK}
                  failLabel={TEXT.API_TEST_FAIL}
                  errorMessage={test?.error ?? null}
                  latencyMs={test?.ok ? test.latencyMs : undefined}
                  meta={interpolate(TEXT.API_MODELS_COUNT, {
                    count: p.availableModels?.length ?? 0,
                  })}
                  actions={actions}
                  actionsLabel={interpolate(TEXT.API_PROVIDERS_ACTIONS_ARIA, { name: p.name })}
                />
              </li>
            );
          })}
        </ul>
        {!firstRunCard && (
          <Button size="sm" onClick={() => onOpenWizard()}>
            {TEXT.API_ADD_PROVIDER}
          </Button>
        )}
      </section>
    </div>
  );
}
