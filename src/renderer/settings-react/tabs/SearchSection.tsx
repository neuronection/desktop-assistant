import { useCallback, useEffect, useState, type JSX } from 'react';
import { Badge } from '@neuronection/assistant-ui/badge';
import { Button } from '@neuronection/assistant-ui/button';
import { ConfirmationModal } from '@neuronection/assistant-ui/confirmation-modal';
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '@neuronection/assistant-ui/modal';
import { ArrowDown, ArrowUp, Globe, PlugZap, Trash2 } from 'lucide-react';
import type { SearchProviderSaveInput, SearchProviderTestResult, SearchProviderType, SearchProviderView } from '@shared/search';
import { SEARCH_PROVIDER_TYPES, searchProviderUsesKey } from '@shared/search';
import { TEXT, interpolate } from '@shared/constants/text';
import { Label } from './fields';
import { Switch } from '../tools/shared';

const TYPE_LABELS: Record<SearchProviderType, string> = {
  searxng: 'SearXNG',
  brave: 'Brave Search',
  tavily: 'Tavily',
  exa: 'Exa',
  serper: 'Serper (Google)',
  'google-pse': 'Google Programmable Search',
};

interface ProviderFormState {
  id: string | null;
  name: string;
  type: SearchProviderType;
  enabled: boolean;
  baseUrl: string;
  googleCx: string;
  key: string;
  timeoutMs: string;
  maxResults: string;
}

const EMPTY_FORM: ProviderFormState = {
  id: null,
  name: '',
  type: 'searxng',
  enabled: true,
  baseUrl: '',
  googleCx: '',
  key: '',
  timeoutMs: '',
  maxResults: '',
};

export function SearchSection(): JSX.Element {
  const [providers, setProviders] = useState<SearchProviderView[]>([]);
  const [form, setForm] = useState<ProviderFormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<SearchProviderView | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, SearchProviderTestResult>>({});

  const refresh = useCallback(async () => {
    setProviders(await window.electronAPI.getSearchProviders());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const startEdit = (view: SearchProviderView): void => {
    const { config } = view;
    setFormError(null);
    setForm({
      id: config.id,
      name: config.name,
      type: config.type,
      enabled: config.enabled,
      baseUrl: config.baseUrl ?? '',
      googleCx: config.googleCx ?? '',
      key: '',
      timeoutMs: config.timeoutMs ? String(config.timeoutMs) : '',
      maxResults: config.maxResults ? String(config.maxResults) : '',
    });
  };

  const saveForm = async (): Promise<void> => {
    if (!form || !form.name.trim()) {
      setFormError(TEXT.SEARCH_NAME_REQUIRED);
      return;
    }
    if (form.type === 'searxng' && !form.baseUrl.trim()) {
      setFormError(TEXT.SEARCH_BASE_URL_REQUIRED);
      return;
    }
    try {
      const input: SearchProviderSaveInput = {
        id: form.id ?? crypto.randomUUID(),
        name: form.name.trim(),
        type: form.type,
        enabled: form.enabled,
        timeoutMs: form.timeoutMs.trim() ? Number(form.timeoutMs) : undefined,
        maxResults: form.maxResults.trim() ? Number(form.maxResults) : undefined,
        ...(form.type === 'searxng' ? { baseUrl: form.baseUrl.trim() } : {}),
        ...(form.type === 'google-pse' && form.googleCx.trim() ? { googleCx: form.googleCx.trim() } : {}),
        ...(searchProviderUsesKey(form.type) && form.key.trim() !== '' ? { key: form.key.trim() } : {}),
      };
      const saved = await window.electronAPI.saveSearchProvider(input);
      setProviders((prev) => {
        const next = prev.filter((view) => view.config.id !== saved.config.id);
        return [...next, saved];
      });
      setForm(null);
      setFormError(null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    }
  };

  const clearStoredKey = async (view: SearchProviderView): Promise<void> => {
    if (!searchProviderUsesKey(view.config.type)) {
      return;
    }
    const saved = await window.electronAPI.saveSearchProvider({
      ...view.config,
      key: '',
    });
    setProviders((prev) => prev.map((candidate) => (candidate.config.id === saved.config.id ? saved : candidate)));
  };

  const testProvider = async (providerId: string): Promise<void> => {
    setTesting(providerId);
    try {
      const result = await window.electronAPI.testSearchProvider(providerId);
      setTestResults((prev) => ({ ...prev, [providerId]: result }));
    } finally {
      setTesting(null);
    }
  };

  return (
    <section className="space-y-2 rounded-xl border border-[var(--as-border)] p-3">
      <div className="flex items-center justify-between">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold">
          <Globe className="h-4 w-4" aria-hidden />
          {TEXT.SEARCH_TITLE}
        </h4>
        <Button variant="outline" size="sm" onClick={() => { setFormError(null); setForm({ ...EMPTY_FORM }); }}>
          {TEXT.SEARCH_ADD}
        </Button>
      </div>
      <p className="text-xs opacity-50">{TEXT.SEARCH_HINT}</p>
      {providers.length === 0 && !form && <p className="text-xs opacity-50">{TEXT.SEARCH_NO_PROVIDERS}</p>}
      <ul className="space-y-1.5">
        {providers.map((view, index) => {
          const test = testResults[view.config.id];
          return (
            <li key={view.config.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--as-border)] p-2 text-sm">
              <Switch
                checked={view.config.enabled}
                label={interpolate(TEXT.SEARCH_ENABLE_ARIA, { name: view.config.name })}
                hideLabel
                onCheckedChange={(checked) => {
                  void window.electronAPI.setSearchProviderEnabled(view.config.id, checked);
                  setProviders((prev) =>
                    prev.map((candidate) =>
                      candidate.config.id === view.config.id
                        ? { ...candidate, config: { ...candidate.config, enabled: checked } }
                        : candidate
                    )
                  );
                }}
              />
              <span className="font-medium">{view.config.name}</span>
              <Badge variant="outline" className="text-[10px] font-normal uppercase">
                {TYPE_LABELS[view.config.type]}
              </Badge>
              <Badge variant="outline" className="text-[10px] font-normal">
                {interpolate(TEXT.SEARCH_ORDER_LABEL, { position: index + 1 })}
              </Badge>
              {view.hasKey && (
                <span className="text-xs opacity-50">
                  {interpolate(TEXT.SEARCH_KEY_HINT, { hint: view.config.keyHint ?? '' })}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate font-mono text-xs opacity-50">
                {view.config.baseUrl ?? ''}
              </span>
              <Button
                variant="ghost"
                size="sm"
                aria-label={interpolate(TEXT.SEARCH_MOVE_UP_ARIA, { name: view.config.name })}
                disabled={index === 0}
                onClick={() => {
                  void window.electronAPI.moveSearchProvider(view.config.id, 'up');
                  setProviders((prev) => {
                    if (index === 0) return prev;
                    const next = [...prev];
                    [next[index - 1], next[index]] = [next[index], next[index - 1]];
                    return next;
                  });
                }}
              >
                <ArrowUp className="h-3.5 w-3.5" aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={interpolate(TEXT.SEARCH_MOVE_DOWN_ARIA, { name: view.config.name })}
                disabled={index === providers.length - 1}
                onClick={() => {
                  void window.electronAPI.moveSearchProvider(view.config.id, 'down');
                  setProviders((prev) => {
                    if (index === prev.length - 1) return prev;
                    const next = [...prev];
                    [next[index + 1], next[index]] = [next[index], next[index + 1]];
                    return next;
                  });
                }}
              >
                <ArrowDown className="h-3.5 w-3.5" aria-hidden />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => startEdit(view)}>
                {TEXT.EDIT_BUTTON}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={interpolate(TEXT.SEARCH_TEST_ARIA, { name: view.config.name })}
                disabled={testing === view.config.id}
                onClick={() => void testProvider(view.config.id)}
              >
                <PlugZap className="h-3.5 w-3.5" aria-hidden />
                {test
                  ? test.ok
                    ? ` ${interpolate(TEXT.SEARCH_TEST_OK, { count: test.resultCount ?? '', latency: test.latencyMs ?? '' })}`
                    : ` ${TEXT.SEARCH_TEST_FAILED}`
                  : ''}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={interpolate(TEXT.SEARCH_DELETE_ARIA, { name: view.config.name })}
                onClick={() => setDeleting(view)}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </Button>
              {test && !test.ok && test.error && (
                <p className="w-full text-xs text-red-500">{test.error}</p>
              )}
            </li>
          );
        })}
      </ul>

      {form && (
        <Modal open onOpenChange={(open) => { if (!open) { setForm(null); } }}>
          <ModalContent size="md">
            <ModalHeader>
              <ModalTitle>{form.id ? TEXT.EDIT_BUTTON : TEXT.SEARCH_ADD}</ModalTitle>
            </ModalHeader>
            <div className="space-y-3 px-6 pb-4">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="search-name">{TEXT.SEARCH_NAME_LABEL}</Label>
                  <input
                    id="search-name"
                    aria-label={TEXT.SEARCH_NAME_ARIA}
                    className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 text-sm"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder={TEXT.SEARCH_NAME_PLACEHOLDER}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="search-type">{TEXT.SEARCH_TYPE_LABEL}</Label>
                  <select
                    id="search-type"
                    className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 text-sm"
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value as SearchProviderType })}
                  >
                    {SEARCH_PROVIDER_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {TYPE_LABELS[type]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {form.type === 'searxng' && (
                <div className="space-y-1">
                  <Label htmlFor="search-baseurl">{TEXT.SEARCH_BASE_URL_LABEL}</Label>
                  <p className="text-xs opacity-50">{TEXT.SEARCH_BASE_URL_HINT}</p>
                  <input
                    id="search-baseurl"
                    aria-label={TEXT.SEARCH_BASE_URL_ARIA}
                    className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 font-mono text-sm"
                    value={form.baseUrl}
                    onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                    placeholder={TEXT.SEARCH_BASE_URL_PLACEHOLDER}
                  />
                </div>
              )}
              {searchProviderUsesKey(form.type) && (
                <div className="space-y-1">
                  <Label htmlFor="search-key">
                    {TEXT.SEARCH_KEY_LABEL + (form.id ? TEXT.SEARCH_KEY_LABEL_STORED : '')}
                  </Label>
                  <div className="flex gap-1.5">
                    <input
                      id="search-key"
                      type="password"
                      aria-label={TEXT.SEARCH_KEY_ARIA}
                      autoComplete="off"
                      className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 font-mono text-sm"
                      value={form.key}
                      onChange={(e) => setForm({ ...form, key: e.target.value })}
                    />
                    {form.id && (
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={TEXT.SEARCH_KEY_CLEAR_ARIA}
                        onClick={() => {
                          const view = providers.find((candidate) => candidate.config.id === form.id);
                          if (view) {
                            void clearStoredKey(view);
                          }
                        }}
                      >
                        {TEXT.SEARCH_KEY_CLEAR}
                      </Button>
                    )}
                  </div>
                </div>
              )}
              {form.type === 'google-pse' && (
                <div className="space-y-1">
                  <Label htmlFor="search-cx">{TEXT.SEARCH_CX_LABEL}</Label>
                  <input
                    id="search-cx"
                    aria-label={TEXT.SEARCH_CX_ARIA}
                    className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 font-mono text-sm"
                    value={form.googleCx}
                    onChange={(e) => setForm({ ...form, googleCx: e.target.value })}
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="search-timeout">{TEXT.SEARCH_TIMEOUT_LABEL}</Label>
                  <input
                    id="search-timeout"
                    type="number"
                    min={1000}
                    max={30000}
                    aria-label={TEXT.SEARCH_TIMEOUT_ARIA}
                    className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 text-sm"
                    value={form.timeoutMs}
                    onChange={(e) => setForm({ ...form, timeoutMs: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="search-maxresults">{TEXT.SEARCH_MAX_RESULTS_LABEL}</Label>
                  <input
                    id="search-maxresults"
                    type="number"
                    min={1}
                    max={10}
                    aria-label={TEXT.SEARCH_MAX_RESULTS_ARIA}
                    className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 text-sm"
                    value={form.maxResults}
                    onChange={(e) => setForm({ ...form, maxResults: e.target.value })}
                  />
                </div>
              </div>
              {formError && <p className="text-xs text-red-500">{formError}</p>}
            </div>
            <ModalFooter className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setForm(null)}>
                {TEXT.CANCEL_BUTTON}
              </Button>
              <Button size="sm" onClick={() => void saveForm()}>
                {TEXT.SEARCH_SAVE}
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}

      <ConfirmationModal
        open={deleting !== null}
        onOpenChange={(open) => { if (!open) { setDeleting(null); } }}
        title={deleting?.config.name ?? ''}
        description={TEXT.SEARCH_DELETE_CONFIRM}
        confirmLabel={TEXT.REMOVE_BUTTON}
        destructive
        onConfirm={() => {
          if (deleting) {
            void window.electronAPI.deleteSearchProvider(deleting.config.id);
            setProviders((prev) => prev.filter((view) => view.config.id !== deleting.config.id));
            setDeleting(null);
          }
        }}
      />
    </section>
  );
}
