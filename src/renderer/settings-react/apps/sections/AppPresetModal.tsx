import type { ReactElement } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import { Combobox } from '@neuronection/assistant-ui/combobox';
import { IntegrationCatalogGrid } from '@neuronection/assistant-ui/integration-catalog-grid';
import { Modal, ModalContent, ModalBody, ModalHeader, ModalTitle } from '@neuronection/assistant-ui/modal';
import { RISK_BADGE_CLASS } from '../../tools/shared';
import type { ToolAppPreset } from '@shared/app-presets';
import type { ToolAppSpec } from '@shared/apps';
import { TEXT } from '@shared/constants/text';
import type { IntegrationExtensionView } from '@neuronection/assistant-ui/integration-contracts';

interface AppPresetModalProps {
  onClose: () => void;
  addMode: 'preset' | 'custom';
  onAddModeSelect: (mode: 'preset' | 'custom') => void;
  catalogEntries: IntegrationExtensionView[];
  presetSearch: string;
  onPresetSearchChange: (value: string) => void;
  loading: boolean;
  loadError: string | null;
  presets: ToolAppPreset[];
  selectedPreset: ToolAppPreset | null;
  onSelectPreset: (preset: ToolAppPreset | null) => void;
  presetEndpoint: string;
  onPresetEndpointChange: (value: string) => void;
  presetToken: string;
  onPresetTokenChange: (value: string) => void;
  presetError: string | null;
  onPresetErrorChange: (value: string | null) => void;
  onSavePreset: () => Promise<void>;
  customName: string;
  onCustomNameChange: (value: string) => void;
  customType: 'http' | 'sse' | 'stdio';
  onCustomTypeChange: (value: 'http' | 'sse' | 'stdio') => void;
  customUrl: string;
  onCustomUrlChange: (value: string) => void;
  customCommand: string;
  onCustomCommandChange: (value: string) => void;
  customArgs: string;
  onCustomArgsChange: (value: string) => void;
  customToken: string;
  onCustomTokenChange: (value: string) => void;
  customAllowlist: string;
  onCustomAllowlistChange: (value: string) => void;
  customTimeout: string;
  onCustomTimeoutChange: (value: string) => void;
  customMaxConcurrent: string;
  onCustomMaxConcurrentChange: (value: string) => void;
  customEnv: string;
  onCustomEnvChange: (value: string) => void;
  customHeaders: string;
  onCustomHeadersChange: (value: string) => void;
  customDirectives: string;
  onCustomDirectivesChange: (value: string) => void;
  customExposure: ToolAppSpec['exposure'];
  onCustomExposureChange: (value: ToolAppSpec['exposure']) => void;
  customError: string | null;
  deferredSupported: boolean;
  onSaveCustomApp: () => Promise<void>;
}

export function AppPresetModal({
  onClose,
  addMode,
  onAddModeSelect,
  catalogEntries,
  presetSearch,
  onPresetSearchChange: setPresetSearch,
  loading,
  loadError,
  presets,
  selectedPreset,
  onSelectPreset: setSelectedPreset,
  presetEndpoint,
  onPresetEndpointChange: setPresetEndpoint,
  presetToken,
  onPresetTokenChange: setPresetToken,
  presetError,
  onPresetErrorChange: setPresetError,
  onSavePreset,
  customName,
  onCustomNameChange: setCustomName,
  customType,
  onCustomTypeChange: setCustomType,
  customUrl,
  onCustomUrlChange: setCustomUrl,
  customCommand,
  onCustomCommandChange: setCustomCommand,
  customArgs,
  onCustomArgsChange: setCustomArgs,
  customToken,
  onCustomTokenChange: setCustomToken,
  customAllowlist,
  onCustomAllowlistChange: setCustomAllowlist,
  customTimeout,
  onCustomTimeoutChange: setCustomTimeout,
  customMaxConcurrent,
  onCustomMaxConcurrentChange: setCustomMaxConcurrent,
  customEnv,
  onCustomEnvChange: setCustomEnv,
  customHeaders,
  onCustomHeadersChange: setCustomHeaders,
  customDirectives,
  onCustomDirectivesChange: setCustomDirectives,
  customExposure,
  onCustomExposureChange: setCustomExposure,
  customError,
  deferredSupported,
  onSaveCustomApp,
}: AppPresetModalProps): ReactElement {
  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>{TEXT.APPS_ADD_APP}</ModalTitle>
        </ModalHeader>
        <ModalBody className="space-y-3">
          <div className="flex gap-1" role="tablist" aria-label={TEXT.APPS_ADD_APP}>
            {(['preset', 'custom'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={addMode === mode}
                onClick={() => onAddModeSelect(mode)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  addMode === mode ? 'bg-[var(--as-primary)]/15 text-[var(--as-primary)]' : 'text-[var(--as-muted-foreground)]'
                }`}
              >
                {mode === 'preset' ? TEXT.APPS_ADD_MODE_PRESET : TEXT.APPS_ADD_MODE_CUSTOM}
              </button>
            ))}
          </div>

          {addMode === 'preset' && !selectedPreset && (
            <IntegrationCatalogGrid
              entries={catalogEntries}
              query={presetSearch}
              onQueryChange={setPresetSearch}
              loading={loading}
              error={loadError}
              labels={{
                loadingLabel: TEXT.APPS_LOADING,
                searchPlaceholder: TEXT.APPS_CATALOG_SEARCH_PLACEHOLDER,
                emptyLabel: TEXT.APPS_CATALOG_EMPTY,
                noMatchesLabel: TEXT.APPS_CATALOG_NO_MATCHES,
                installLabel: TEXT.APPS_CATALOG_INSTALL,
                installedLabel: TEXT.APPS_CATALOG_INSTALLED,
                incompatibleLabel: TEXT.APPS_CATALOG_INCOMPATIBLE,
                listedLabel: TEXT.APPS_CATALOG_LISTED,
                uncategorizedLabel: TEXT.APPS_CATALOG_UNCATEGORIZED,
                categoryLabels: {
                  home: TEXT.APPS_CAT_HOME,
                  files: TEXT.APPS_CAT_FILES,
                  utilities: TEXT.APPS_CAT_UTILITIES,
                  developer: TEXT.APPS_CAT_DEVELOPER,
                  productivity: TEXT.APPS_CAT_PRODUCTIVITY,
                  data: TEXT.APPS_CAT_DATA,
                  search: TEXT.APPS_CAT_SEARCH,
                  learning: TEXT.APPS_CAT_LEARNING,
                },
              }}
              onInstall={(entry) => {
                const preset = presets.find((candidate) => candidate.id === entry.id);
                if (preset) {
                  setSelectedPreset(preset);
                  setPresetEndpoint(preset.defaultEndpoint);
                  setPresetError(null);
                }
              }}
            />
          )}
          {addMode === 'preset' && selectedPreset && (
            <div className="space-y-3">
              <p className="text-xs font-semibold">{TEXT.APPS_PRESET_PREVIEW_RISKS}</p>
              <ul className="space-y-1">
                {selectedPreset.toolDomains.map((domain) => (
                  <li key={domain.tool} className="flex items-center gap-2 text-xs">
                    <span className={`rounded px-1.5 py-0.5 ${RISK_BADGE_CLASS[domain.baseRisk]}`}>{domain.baseRisk}</span>
                    <span>{domain.tool}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs font-semibold">{TEXT.APPS_PRESET_PREVIEW_NOTES}</p>
              {selectedPreset.skill && (
                <p className="text-xs text-[var(--as-muted-foreground)]">{selectedPreset.skill}</p>
              )}
              {!selectedPreset.skill && selectedPreset.promptNotes && (
                <p className="text-xs text-[var(--as-muted-foreground)]">{selectedPreset.promptNotes}</p>
              )}
              <p className="text-xs font-semibold">{TEXT.APPS_PRESET_HELP}</p>
              <ul className="space-y-1">
                {selectedPreset.helpCopy.map((line) => (
                  <li key={line} className="text-xs text-[var(--as-muted-foreground)]">{line}</li>
                ))}
              </ul>
              <label className="block text-xs" htmlFor="preset-endpoint">
                {TEXT.APPS_PRESET_ENDPOINT_LABEL}
                <input
                  id="preset-endpoint"
                  className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                  value={presetEndpoint}
                  onChange={(event) => setPresetEndpoint(event.target.value)}
                />
              </label>
              <label className="block text-xs" htmlFor="preset-token">
                {selectedPreset.auth?.label ?? TEXT.APPS_PRESET_TOKEN_LABEL}
                <input
                  id="preset-token"
                  type="password"
                  className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                  value={presetToken}
                  onChange={(event) => setPresetToken(event.target.value)}
                />
              </label>
              {presetError && (
                <p role="alert" className="text-xs text-[var(--as-danger)]">
                  {presetError}
                </p>
              )}
              <Button size="sm" onClick={() => void onSavePreset()}>
                {TEXT.APPS_PRESET_SAVE}
              </Button>
            </div>
          )}

          {addMode === 'custom' && (
            <div className="space-y-3">
              <p className="text-xs text-[var(--as-muted-foreground)]">{TEXT.APPS_CUSTOM_HINT}</p>
              <label className="block text-xs">
                {TEXT.APPS_CUSTOM_NAME}
                <input
                  className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                  value={customName}
                  onChange={(event) => setCustomName(event.target.value)}
                />
              </label>
              <div className="space-y-1 text-xs">
                <span>{TEXT.APPS_CUSTOM_TYPE}</span>
                <Combobox
                  id="apps-custom-type"
                  hideLabel
                  label={TEXT.APPS_CUSTOM_TYPE}
                  value={customType}
                  onChange={(value) => setCustomType(value as 'http' | 'sse' | 'stdio')}
                  options={[
                    { value: 'http', label: 'Streamable HTTP' },
                    { value: 'sse', label: 'SSE' },
                    { value: 'stdio', label: 'stdio (local command)' },
                  ]}
                />
              </div>
              {customType === 'stdio' ? (
                <>
                  <label className="block text-xs">
                    {TEXT.APPS_CUSTOM_COMMAND}
                    <input
                      className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                      value={customCommand}
                      onChange={(event) => setCustomCommand(event.target.value)}
                      placeholder="/usr/bin/npx"
                    />
                  </label>
                  <label className="block text-xs">
                    {TEXT.APPS_CUSTOM_ARGS}
                    <input
                      className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                      value={customArgs}
                      onChange={(event) => setCustomArgs(event.target.value)}
                    />
                  </label>
                </>
              ) : (
                <label className="block text-xs">
                  {TEXT.APPS_CUSTOM_URL}
                  <input
                    className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                    value={customUrl}
                    onChange={(event) => setCustomUrl(event.target.value)}
                    placeholder="http://host:port/mcp"
                  />
                </label>
              )}
              <label className="block text-xs">
                {TEXT.APPS_CUSTOM_TOKEN}
                <input
                  type="password"
                  className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                  value={customToken}
                  onChange={(event) => setCustomToken(event.target.value)}
                />
              </label>
              <fieldset className="space-y-1">
                <legend className="text-xs">{TEXT.APPS_EXPOSURE_TITLE}</legend>
                {(['always', 'relevance', 'deferred'] as const).map((exposure) => {
                  if (exposure === 'deferred' && !deferredSupported) {
                    return null;
                  }
                  return (
                    <label key={exposure} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="custom-exposure"
                        checked={customExposure === exposure}
                        onChange={() => setCustomExposure(exposure)}
                      />
                      {exposure === 'always' ? TEXT.APPS_EXPOSURE_ALWAYS : exposure === 'relevance' ? TEXT.APPS_EXPOSURE_RELEVANCE : TEXT.APPS_EXPOSURE_DEFERRED}
                    </label>
                  );
                })}
              </fieldset>
              <label className="block text-xs">
                {TEXT.APPS_DIRECTIVES_LABEL}
                <textarea
                  rows={2}
                  maxLength={500}
                  className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                  value={customDirectives}
                  onChange={(event) => setCustomDirectives(event.target.value)}
                  placeholder="e.g. For all smart-home tasks use the app tools — never shell commands."
                />
              </label>
              <label className="block text-xs">
                {TEXT.APPS_CUSTOM_ALLOWLIST}
                <input
                  className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                  value={customAllowlist}
                  onChange={(event) => setCustomAllowlist(event.target.value)}
                />
              </label>
              <div className="flex gap-2">
                <label className="block flex-1 text-xs">
                  {TEXT.APPS_CUSTOM_TIMEOUT}
                  <input
                    type="number"
                    min={1000}
                    className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                    value={customTimeout}
                    onChange={(event) => setCustomTimeout(event.target.value)}
                  />
                </label>
                <label className="block flex-1 text-xs">
                  {TEXT.APPS_CUSTOM_MAXCONC}
                  <input
                    type="number"
                    min={1}
                    className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 text-sm"
                    value={customMaxConcurrent}
                    onChange={(event) => setCustomMaxConcurrent(event.target.value)}
                  />
                </label>
              </div>
              <label className="block text-xs">
                {TEXT.APPS_CUSTOM_ENV}
                <textarea
                  rows={2}
                  placeholder='{{ "KEY": "value" }}'
                  className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 font-mono text-xs"
                  value={customEnv}
                  onChange={(event) => setCustomEnv(event.target.value)}
                />
              </label>
              <label className="block text-xs">
                {TEXT.APPS_CUSTOM_HEADERS}
                <textarea
                  rows={2}
                  placeholder='{{ "X-Custom": "value" }}'
                  className="mt-1 w-full rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1 font-mono text-xs"
                  value={customHeaders}
                  onChange={(event) => setCustomHeaders(event.target.value)}
                />
              </label>
              {customError && (
                <p role="alert" className="text-xs text-[var(--as-danger)]">
                  {customError}
                </p>
              )}
              <Button size="sm" onClick={() => void onSaveCustomApp()}>
                {TEXT.APPS_CUSTOM_SAVE}
              </Button>
            </div>
          )}
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
