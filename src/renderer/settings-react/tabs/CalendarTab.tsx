import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { Badge } from '@neuronection/assistant-ui/badge';
import { Button } from '@neuronection/assistant-ui/button';
import { ConfirmationModal } from '@neuronection/assistant-ui/confirmation-modal';
import { EmptyState } from '@neuronection/assistant-ui/empty-state';
import { Modal, ModalContent, ModalBody, ModalHeader, ModalTitle } from '@neuronection/assistant-ui/modal';
import { CalendarDays, KeyRound, PlugZap, RefreshCw, Trash2 } from 'lucide-react';
import type {
  CalendarCatalogView,
  CalendarProviderView,
  ConnectorAccountView,
  ConnectorBindStatusView,
} from '@shared/connectors';
import { scopeDiff } from '@shared/connectors';
import { TEXT, interpolate } from '@shared/constants/text';
import { NotificationService } from '@renderer/services/NotificationService';

const CALENDAR_SETUP_URL =
  'https://github.com/neuronection/desktop-assistant/blob/main/docs/user/calendar.md';

function statusLabel(status: ConnectorAccountView['status']): string {
  switch (status) {
    case 'ok':
      return TEXT.CALENDAR_STATUS_OK;
    case 'degraded':
      return TEXT.CALENDAR_STATUS_DEGRADED;
    case 'failing':
      return TEXT.CALENDAR_STATUS_FAILING;
    case 'stale':
      return TEXT.CALENDAR_STATUS_STALE;
    case 'needs-auth':
      return TEXT.CALENDAR_STATUS_NEEDS_AUTH;
    case 'needs-secret':
      return TEXT.CALENDAR_STATUS_NEEDS_SECRET;
    case 'needs-config':
      return TEXT.CALENDAR_STATUS_NEEDS_CONFIG;
  }
}

function statusVariant(status: ConnectorAccountView['status']): 'success' | 'warning' | 'danger' | 'outline' {
  switch (status) {
    case 'ok':
      return 'success';
    case 'degraded':
    case 'stale':
    case 'needs-auth':
    case 'needs-secret':
    case 'needs-config':
      return 'warning';
    case 'failing':
      return 'danger';
  }
}

interface ConsentTarget {
  provider: CalendarProviderView;
  /** Set when this consent is a re-bind of an existing account (scope delta shown). */
  existing?: ConnectorAccountView;
}

export function CalendarTab(): JSX.Element {
  const [catalog, setCatalog] = useState<CalendarCatalogView | null>(null);
  const [accounts, setAccounts] = useState<ConnectorAccountView[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [consent, setConsent] = useState<ConsentTarget | null>(null);
  const [consentLabel, setConsentLabel] = useState('');
  const [waitingProvider, setWaitingProvider] = useState<string | null>(null);
  const [waitingMessage, setWaitingMessage] = useState<string | null>(null);
  const [waitingFailed, setWaitingFailed] = useState(false);
  const [deleting, setDeleting] = useState<ConnectorAccountView | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [copiedEnv, setCopiedEnv] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(false);
    try {
      const [catalogView, accountViews] = await Promise.all([
        window.electronAPI.getCalendarCatalog(),
        window.electronAPI.listCalendarAccounts(),
      ]);
      setCatalog(catalogView);
      setAccounts(accountViews);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () => () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    },
    []
  );

  const startPolling = useCallback(
    (providerId: string, accountId: string) => {
      setWaitingProvider(providerId);
      setWaitingMessage(TEXT.CALENDAR_BIND_WAITING);
      setWaitingFailed(false);
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
      pollRef.current = setInterval(() => {
        void window.electronAPI
          .getCalendarBindStatus(providerId)
          .then((status: ConnectorBindStatusView) => {
            if (status.state === 'waiting') {
              return;
            }
            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
            if (status.state === 'failed') {
              setWaitingFailed(true);
              setWaitingMessage(
                interpolate(TEXT.CALENDAR_BIND_FAILED, { error: status.error ?? status.code ?? '' })
              );
              setTimeout(() => setWaitingProvider(null), 6000);
              return;
            }
            setWaitingFailed(false);
            setWaitingProvider(null);
            void load();
          })
          .catch(() => undefined);
      }, 1500);
      // accountId keeps the binding reference; the status poll above completes.
      void accountId;
    },
    [load]
  );

  const copyEnv = useCallback(async (env: string) => {
    try {
      await window.electronAPI.writeToClipboard(env);
      setCopiedEnv(env);
      window.setTimeout(() => setCopiedEnv((current) => (current === env ? null : current)), 2000);
    } catch {
      setCopiedEnv(null);
    }
  }, []);

  const beginBind = useCallback(
    async (provider: CalendarProviderView) => {
      try {
        const result = await window.electronAPI.startCalendarBind(
          provider.id,
          consentLabel.trim() || undefined,
          consent?.existing?.id
        );
        if (!result.ok) {
          setWaitingMessage(interpolate(TEXT.CALENDAR_BIND_FAILED, { error: result.error }));
          setWaitingProvider(provider.id);
          setTimeout(() => setWaitingProvider(null), 6000);
          return;
        }
        setConsent(null);
        setConsentLabel('');
        startPolling(provider.id, result.accountId);
      } catch (error) {
        NotificationService.showError(interpolate(TEXT.CALENDAR_BIND_FAILED, { error: error instanceof Error ? error.message : String(error) }));
      }
    },
    [consent, consentLabel, startPolling]
  );

  const cancelBind = useCallback(async (providerId: string) => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    await window.electronAPI.cancelCalendarBind(providerId).catch(() => undefined);
    setWaitingProvider(null);
    NotificationService.showSuccess(TEXT.CALENDAR_BIND_CANCELLED);
  }, []);

  const testAccount = useCallback(
    async (account: ConnectorAccountView) => {
      setTestingId(account.id);
      try {
        const result = await window.electronAPI.testCalendarAccount(account.id);
        if (result.ok) {
          NotificationService.showSuccess(interpolate(TEXT.CALENDAR_TEST_OK, { latency: String(result.latencyMs ?? 0) }));
        } else {
          NotificationService.showError(interpolate(TEXT.CALENDAR_TEST_FAILED, { error: result.error ?? 'unknown' }));
        }
        setAccounts(await window.electronAPI.listCalendarAccounts());
      } finally {
        setTestingId(null);
      }
    },
    []
  );

  const unbind = useCallback(async (account: ConnectorAccountView) => {
    setDeleting(null);
    try {
      await window.electronAPI.unbindCalendarAccount(account.id);
      NotificationService.showSuccess(TEXT.CALENDAR_UNBOUND);
    } finally {
      await load();
    }
  }, [load]);

  if (loading) {
    return (
      <section aria-label={TEXT.CALENDAR_TITLE} className="flex flex-col gap-3">
        <p className="text-sm opacity-60" role="status">
          {TEXT.CALENDAR_LOADING}
        </p>
      </section>
    );
  }

  if (loadError || !catalog) {
    return (
      <section aria-label={TEXT.CALENDAR_TITLE} className="flex flex-col items-start gap-3">
        <p className="text-sm text-[var(--as-danger)]" role="alert">
          {TEXT.CALENDAR_LOAD_ERROR}
        </p>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          {TEXT.CALENDAR_RETRY}
        </Button>
      </section>
    );
  }

  return (
    <section aria-label={TEXT.CALENDAR_TITLE} className="flex flex-col gap-4">
      <header className="flex items-start gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{TEXT.CALENDAR_TITLE}</h3>
          <p className="text-xs opacity-60">{TEXT.CALENDAR_DESCRIPTION}</p>
        </div>
      </header>

      <ul className="flex flex-col gap-2" aria-label={TEXT.CALENDAR_TITLE}>
        {catalog.providers.map((provider) => {
          const providerAccounts = accounts.filter((account) => account.provider === provider.id);
          return (
            <li
              key={provider.id}
              data-no-drag
              className="da-rise rounded-xl border border-[var(--as-border)] bg-[var(--as-surface)]/60 p-3 text-sm"
            >
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                <span className="font-medium">{provider.label}</span>
                {!provider.clientIdConfigured && (
                  <Badge variant="warning" className="shrink-0 text-[10px] font-normal">
                    {TEXT.CALENDAR_STATUS_NEEDS_CONFIG}
                  </Badge>
                )}
                <span className="ml-auto flex shrink-0 items-center gap-1.5">
                  {providerAccounts.length === 0 && (
                    <Button
                      size="sm"
                      disabled={!provider.clientIdConfigured}
                      aria-describedby={!provider.clientIdConfigured ? `calendar-config-${provider.id}` : undefined}
                      onClick={() => { setConsentLabel(''); setConsent({ provider }); }}
                    >
                      <PlugZap className="mr-1 h-3.5 w-3.5" aria-hidden />
                      {TEXT.CALENDAR_BIND}
                    </Button>
                  )}
                </span>
              </div>
              {!provider.clientIdConfigured && (
                <div
                  id={`calendar-config-${provider.id}`}
                  className="mt-2 rounded-lg border border-[var(--as-border)] bg-[var(--as-surface)]/40 p-2 text-[11px] leading-relaxed opacity-80"
                >
                  <p>
                    {interpolate(TEXT.CALENDAR_NEEDS_CONFIG, {
                      provider: provider.label,
                      env: provider.clientIdEnv ?? '',
                    })}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {provider.clientIdEnv && (
                      <>
                        <code className="rounded bg-[var(--as-border)]/40 px-1 py-0.5 font-mono text-[10px]">
                          {provider.clientIdEnv}
                        </code>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => void copyEnv(provider.clientIdEnv!)}
                        >
                          {copiedEnv === provider.clientIdEnv ? TEXT.CALENDAR_COPIED : TEXT.CALENDAR_COPY_ENV}
                        </Button>
                      </>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void window.electronAPI.openExternal(CALENDAR_SETUP_URL)}
                    >
                      {TEXT.CALENDAR_SETUP_GUIDE}
                    </Button>
                  </div>
                </div>
              )}
              <p className="mt-1 text-[11px] opacity-50">
                {provider.scopesWrite.length > 0 ? `${provider.scopesWrite.length} ${TEXT.CALENDAR_SCOPES_LABEL.replace('{count} ', '')} · ${provider.domains.join(', ')}` : provider.domains.join(', ')}
              </p>
              {providerAccounts.map((account) => (
                <div key={account.id} className="mt-2 flex flex-col gap-1 rounded-lg border border-[var(--as-border)] p-2">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 truncate font-medium" title={account.label}>{account.label}</span>
                    <Badge variant={statusVariant(account.status)} className="shrink-0 text-[10px] font-normal">
                      {statusLabel(account.status)}
                    </Badge>
                    <span className="ml-auto flex shrink-0 items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={testingId === account.id || account.status === 'needs-auth' || account.status === 'needs-config'}
                        onClick={() => void testAccount(account)}
                      >
                        <RefreshCw className={`mr-1 h-3.5 w-3.5${testingId === account.id ? ' animate-spin' : ''}`} aria-hidden />
                        {TEXT.CALENDAR_TEST}
                      </Button>
                      {account.status === 'needs-auth' && provider.clientIdConfigured && (
                        <Button size="sm" onClick={() => { setConsentLabel(account.label); setConsent({ provider, existing: account }); }}>
                          <KeyRound className="mr-1 h-3.5 w-3.5" aria-hidden />
                          {TEXT.CALENDAR_REBIND}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-[var(--as-danger)]"
                        aria-label={`${TEXT.CALENDAR_UNBIND} — ${account.label}`}
                        onClick={() => setDeleting(account)}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </span>
                  </div>
                  <p className="text-[11px] opacity-50">
                    {interpolate(TEXT.CALENDAR_SCOPES_LABEL, { count: String(account.scopes.length) })}
                    {account.expiresAt && (
                      <span>
                        {' · '}
                        {interpolate(TEXT.CALENDAR_EXPIRES, { when: new Date(account.expiresAt).toLocaleString() })}
                      </span>
                    )}
                  </p>
                </div>
              ))}
            </li>
          );
        })}
      </ul>

      {accounts.length === 0 && (
        <EmptyState icon={CalendarDays} title={TEXT.CALENDAR_TITLE} description={TEXT.CALENDAR_EMPTY} />
      )}

      <p className="text-[11px] opacity-50">{TEXT.CALENDAR_UPCOMING}</p>

      {consent && (
        <Modal open onOpenChange={(open) => !open && setConsent(null)}>
          <ModalContent>
            <ModalHeader>
              <ModalTitle>{interpolate(TEXT.CALENDAR_CONSENT_TITLE, { provider: consent.provider.label })}</ModalTitle>
            </ModalHeader>
            <ModalBody className="text-sm">
              <p>{interpolate(TEXT.CALENDAR_CONSENT_DELEGATION, { provider: consent.provider.label })}</p>
              <div>
                <p className="mb-1 text-xs font-medium opacity-70">{TEXT.CALENDAR_CONSENT_SCOPES}</p>
                <ul className="flex flex-col gap-0.5 rounded-md border border-[var(--as-border)] p-2 font-mono text-[11px]">
                  {consent.provider.scopesWrite.map((scope) => (
                    <li key={scope} className="break-all">{scope}</li>
                  ))}
                </ul>
                {consent.existing && (() => {
                  const diff = scopeDiff(consent.existing.scopes, consent.provider.scopesWrite);
                  return (
                    <>
                      {diff.added.length > 0 && (
                        <div className="mt-2">
                          <p className="mb-1 text-xs font-medium opacity-70">{TEXT.CALENDAR_CONSENT_SCOPES_ADDED}</p>
                          <ul className="flex flex-col gap-0.5 rounded-md border border-[var(--as-warning)] p-2 font-mono text-[11px]">
                            {diff.added.map((scope) => (
                              <li key={scope} className="break-all">+ {scope}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {diff.removed.length > 0 && (
                        <div className="mt-2">
                          <p className="mb-1 text-xs font-medium opacity-70">{TEXT.CALENDAR_CONSENT_SCOPES_REMOVED}</p>
                          <ul className="flex flex-col gap-0.5 rounded-md border border-[var(--as-danger)] p-2 font-mono text-[11px]">
                            {diff.removed.map((scope) => (
                              <li key={scope} className="break-all">− {scope}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
              <div>
                <p className="mb-1 text-xs font-medium opacity-70">{TEXT.CALENDAR_CONSENT_DOMAINS}</p>
                <ul className="flex flex-wrap gap-1">
                  {consent.provider.domains.map((domain) => (
                    <li key={domain}>
                      <Badge variant="outline" className="font-mono text-[10px] font-normal">{domain}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="text-[11px] opacity-60">{TEXT.CALENDAR_PRIMARY_ONLY}</p>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium opacity-70">{TEXT.CALENDAR_CONSENT_LABEL}</span>
                <input
                  className="rounded-md border border-[var(--as-border)] bg-transparent px-2 py-1.5 outline-none focus:border-[var(--as-primary)]"
                  value={consentLabel}
                  placeholder={TEXT.CALENDAR_CONSENT_LABEL_PLACEHOLDER}
                  onChange={(event) => setConsentLabel(event.target.value)}
                />
              </label>
              <div className="flex items-center justify-end gap-1.5">
                <Button type="button" variant="ghost" size="sm" onClick={() => setConsent(null)}>
                  {TEXT.CALENDAR_CONSENT_CANCEL}
                </Button>
                <Button size="sm" onClick={() => void beginBind(consent.provider)}>
                  {TEXT.CALENDAR_CONSENT_START}
                </Button>
              </div>
            </ModalBody>
          </ModalContent>
        </Modal>
      )}

      {waitingProvider && (
        <div
          className="flex items-center gap-2 rounded-xl border border-[var(--as-border)] bg-[var(--as-surface)]/60 p-3 text-sm"
          role={waitingFailed ? 'alert' : 'status'}
        >
          <RefreshCw className={`h-4 w-4 opacity-70${waitingFailed ? '' : ' animate-spin'}`} aria-hidden />
          <span className="min-w-0 flex-1 truncate">{waitingMessage ?? TEXT.CALENDAR_BIND_WAITING}</span>
          {!waitingFailed && (
            <Button variant="outline" size="sm" onClick={() => void cancelBind(waitingProvider)}>
              {TEXT.CALENDAR_CANCEL_BIND}
            </Button>
          )}
        </div>
      )}

      {deleting && (
        <ConfirmationModal
          open
          title={TEXT.CALENDAR_UNBIND_TITLE}
          description={interpolate(
            // Consent honesty: only a provider whose catalog row declares a
            // revoke URL may claim revocation; Microsoft has none, so its
            // copy says the grant is forgotten here, not revoked there.
            deleting.revocable ? TEXT.CALENDAR_UNBIND_BODY : TEXT.CALENDAR_UNBIND_BODY_NO_REVOKE,
            { label: deleting.label }
          )}
          confirmLabel={TEXT.CALENDAR_UNBIND_CONFIRM}
          destructive
          onConfirm={() => void unbind(deleting)}
          onOpenChange={(open) => !open && setDeleting(null)}
        />
      )}
    </section>
  );
}
