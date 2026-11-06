import type { ComponentProps, ReactElement } from 'react';
import { ModelRegistry } from '@neuronection/assistant-ui/model-registry';
import { LLMProviderType } from '@shared/types';
import { TEXT } from '@shared/constants/text';
import { CAP_DESCRIPTORS, CAP_IMPLICATIONS, REASONING_EFFORT_OPTIONS, STANDALONE_CAPS } from './shared';

type RegistryProps = ComponentProps<typeof ModelRegistry>;

interface ApiModelsGroupProps {
  registryProviders: RegistryProps['providers'];
  registryModels: RegistryProps['models'];
  expandedProviderId: string | null;
  onExpandedProviderChange: RegistryProps['onExpandedProviderChange'];
  remoteModels: RegistryProps['remoteModels'];
  remoteState: RegistryProps['remoteState'];
  remoteError: RegistryProps['remoteError'];
  onRetryRemote: RegistryProps['onRetryRemote'];
  onAddModel: RegistryProps['onAddModel'];
  onAddAll: RegistryProps['onAddAll'];
  onUpdateModel: RegistryProps['onUpdateModel'];
  onDeleteModel: RegistryProps['onDeleteModel'];
}

export function ApiModelsGroup({
  registryProviders,
  registryModels,
  expandedProviderId,
  onExpandedProviderChange,
  remoteModels,
  remoteState,
  remoteError,
  onRetryRemote,
  onAddModel,
  onAddAll,
  onUpdateModel,
  onDeleteModel,
}: ApiModelsGroupProps): ReactElement {
  return (
    <div role="tabpanel" aria-label={TEXT.API_MODELS_TITLE} className="space-y-8">
      <section className="space-y-3">
        <div className="space-y-1">
          <h3 className="text-base font-semibold">{TEXT.API_MODELS_TITLE}</h3>
          <p className="text-sm opacity-60">{TEXT.API_MODELS_SUBTITLE}</p>
        </div>
        <ModelRegistry
          providers={registryProviders}
          models={registryModels}
          caps={CAP_DESCRIPTORS}
          capsHint={TEXT.API_CAPS_HINT}
          standaloneCaps={[...STANDALONE_CAPS]}
          capImplications={CAP_IMPLICATIONS}
          defaultCaps={(provider) =>
            provider.type === LLMProviderType.DECISION ? ['decision'] : ['text', 'vision', 'tools']
          }
          modifiersLabel={TEXT.API_CAPS_MODIFIERS}
          decisionTransport="systemone"
          decisionTransportLabel={TEXT.API_TRANSPORT_LABEL}
          useCatalogLabel={TEXT.API_USE_CATALOG}
          providerContextLabel={TEXT.API_PROVIDER_CONTEXT}
          expandedProviderId={expandedProviderId}
          onExpandedProviderChange={onExpandedProviderChange}
          remoteModels={remoteModels}
          remoteState={remoteState}
          remoteError={remoteError}
          onRetryRemote={onRetryRemote}
          onAddModel={onAddModel}
          onAddAll={onAddAll}
          onUpdateModel={onUpdateModel}
          onDeleteModel={onDeleteModel}
          reasoningEffortOptions={REASONING_EFFORT_OPTIONS}
          addLabel={TEXT.API_ADD_MODEL}
          addAllLabel={TEXT.API_ADD_ALL}
          editLabel={TEXT.EDIT_BUTTON}
          removeLabel={TEXT.REMOVE_BUTTON}
          selectModelLabel={TEXT.API_SELECT_MODEL}
          manualIdToggleLabel={TEXT.API_MANUAL_ID}
          searchPlaceholder={TEXT.API_MODEL_SEARCH}
          emptyProviderLabel={TEXT.API_PROVIDERS_EMPTY}
          externalIdRequiredLabel={TEXT.API_EXTERNAL_ID_REQUIRED}
          remoteEmptyLabel={TEXT.API_REMOTE_EMPTY}
          remoteLoadingLabel={TEXT.API_REMOTE_LOADING}
          retryLabel={TEXT.API_REMOTE_RETRY}
          kindStepLabel={TEXT.API_MODEL_KIND_STEP}
          changeKindLabel={TEXT.API_MODEL_KIND_CHANGE}
          temperatureLabel={TEXT.API_TEMPERATURE_LABEL}
          maxTokensLabel={TEXT.API_MAX_TOKENS_LABEL}
          labelLabel={TEXT.API_MODEL_LIST_LABEL}
          reasoningEffortLabel={TEXT.API_REASONING_EFFORT}
          saveLabel={TEXT.SAVE_BUTTON}
          cancelLabel={TEXT.CANCEL_BUTTON}
        />
      </section>
    </div>
  );
}
