import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { Badge } from '@neuronection/assistant-ui/badge';
import { Button } from '@neuronection/assistant-ui/button';
import { Card } from '@neuronection/assistant-ui/card';
import { ConfirmationModal } from '@neuronection/assistant-ui/confirmation-modal';
import { EmptyState } from '@neuronection/assistant-ui/empty-state';
import { Modal, ModalContent, ModalBody, ModalFooter, ModalHeader, ModalTitle } from '@neuronection/assistant-ui/modal';
import { RefreshCw, Trash2 } from 'lucide-react';
import { TEXT, interpolate } from '@shared/constants/text';
import type {
  ConsentPayload,
  InstallExtensionResult,
  MiniAppSourceInstallView,
  MiniAppSourceView,
  MiniAppSourcesState,
  SourceCandidate,
} from '@shared/app-pack';

const REF_STRATEGIES = ['release-tag', 'tag-pattern', 'branch', 'commit-pin'] as const;

function statusLabel(source: MiniAppSourceView): string {
  if (source.status === 'ok') return TEXT.EXT_SOURCES_STATUS_OK;
  if (source.status === 'failing') return TEXT.EXT_SOURCES_STATUS_FAILING;
  if (source.status === 'degraded') return TEXT.EXT_SOURCES_STATUS_DEGRADED;
  return TEXT.EXT_SOURCES_STATUS_STALE;
}

function refLabel(source: MiniAppSourceView): string {
  if (!source.ref) {
    return '';
  }
  return source.ref.value ? `${source.ref.strategy} ${source.ref.value}` : source.ref.strategy;
}

function capabilityLabel(id: string): string {
  return id;
}

function SourceCard({
  source,
  onSync,
  onRemove,
  onInstall,
  busy,
}: {
  source: MiniAppSourceView;
  onSync: () => void;
  onRemove: () => void;
  onInstall: (candidate: SourceCandidate) => void;
  busy: boolean;
}): ReactElement {
  const listed = source.candidates.filter((candidate) => !source.installs.some((install) => install.extensionId === candidate.extensionId));
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-[10px]">
              {source.kind === 'git' ? TEXT.EXT_SOURCES_KIND_GIT : TEXT.EXT_SOURCES_KIND_LOCAL}
            </Badge>
            <span className="truncate text-sm font-medium">{source.origin}</span>
            <Badge variant="secondary" className="text-[10px]">
              {statusLabel(source)}
            </Badge>
            {refLabel(source) && (
              <Badge variant="outline" className="text-[10px]">
                {refLabel(source)}
              </Badge>
            )}
          </div>
          {source.subpath && <p className="text-xs text-[var(--as-muted-foreground)]">{source.subpath}</p>}
          {source.error && <p className="text-xs text-[var(--as-destructive)]">{source.error}</p>}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onSync} disabled={busy} aria-label={TEXT.EXT_SOURCES_SYNC}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Button variant="outline" size="sm" onClick={onRemove} aria-label={TEXT.EXT_SOURCES_REMOVE}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      </div>
      {listed.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-[var(--as-border)] pt-2.5">
          <div>
            <h4 className="text-xs font-medium">{TEXT.EXT_SOURCES_LISTED_TITLE}</h4>
            <p className="text-[11px] text-[var(--as-muted-foreground)]">{TEXT.EXT_SOURCES_LISTED_HINT}</p>
          </div>
          <ul className="space-y-2">
            {listed.map((candidate) => (
              <li key={`${candidate.extensionId}@${candidate.subpath}`} className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm">{candidate.consent.extensionId}</span>
                    <Badge variant="outline" className="text-[10px]">{`v${candidate.consent.version}`}</Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {TEXT.EXT_SOURCES_ORIGIN_LISTED}
                    </Badge>
                    {candidate.consent.provenance.author && (
                      <span className="text-xs text-[var(--as-muted-foreground)]">
                        {interpolate(TEXT.EXT_SOURCES_AUTHOR, { author: candidate.consent.provenance.author })}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1" aria-label={TEXT.MINIAPPS_CAPABILITIES}>
                    {candidate.consent.capabilities.map((capability) => (
                      <Badge key={capability} variant="secondary" className="text-[10px]">
                        {capabilityLabel(capability)}
                      </Badge>
                    ))}
                  </div>
                  {!candidate.compatible && candidate.reason && (
                    <p className="text-xs text-[var(--as-destructive)]">{interpolate(TEXT.EXT_SOURCES_INCOMPATIBLE, { reason: candidate.reason })}</p>
                  )}
                </div>
                <Button size="sm" disabled={!candidate.compatible || busy} onClick={() => onInstall(candidate)}>
                  {TEXT.EXT_SOURCES_INSTALL}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function InstallCard({
  install,
  onApply,
  onRestore,
  busy,
}: {
  install: MiniAppSourceInstallView;
  onApply: (install: MiniAppSourceInstallView, requiresReconsent: boolean) => void;
  onRestore: (extensionId: string) => void;
  busy: boolean;
}): ReactElement {
  const update = install.update?.state === 'available' ? install.update : null;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-1.5">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">{install.extensionId}</span>
          <Badge variant="outline" className="text-[10px]">{`v${install.version}`}</Badge>
          <Badge variant="outline" className="text-[10px]">
            {TEXT.EXT_SOURCES_ORIGIN_IMPORTED}
          </Badge>
          {install.parked && (
            <Badge variant="secondary" className="text-[10px]">
              {TEXT.EXT_SOURCES_PARKED_BADGE}
            </Badge>
          )}
        </div>
        <p className="text-[11px] text-[var(--as-muted-foreground)]">
          {interpolate(TEXT.EXT_SOURCES_PIN, { ref: install.pinRef })} · {interpolate(TEXT.EXT_SOURCES_DIGEST_SHORT, { digest: `${install.digest.slice(0, 12)}…` })}
          {install.consentedAt !== null ? ` · ${new Date(install.consentedAt).toLocaleString()}` : ''}
        </p>
        {install.parked && (
          <p className="text-xs text-[var(--as-muted-foreground)]">{interpolate(TEXT.EXT_SOURCES_PARKED, { reason: install.parkedReason ?? '' })}</p>
        )}
        {update && <p className="text-xs">{interpolate(TEXT.EXT_SOURCES_UPDATE_AVAILABLE, { from: update.manifestDiff.versionFrom, to: update.manifestDiff.versionTo })}</p>}
        {install.update?.state === 'digest-drift' && <p className="text-xs text-[var(--as-destructive)]">{TEXT.EXT_SOURCES_UPDATE_DRIFT}</p>}
        {install.update?.state === 'absent-from-source' && <p className="text-xs text-[var(--as-muted-foreground)]">{TEXT.EXT_SOURCES_UPDATE_ABSENT}</p>}
        {install.provenance.repository && <p className="truncate text-[11px] text-[var(--as-muted-foreground)]">{install.provenance.repository}</p>}
      </div>
      <div className="flex items-center gap-2">
        {install.parked && (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onRestore(install.extensionId)}>
            {TEXT.EXT_SOURCES_RESTORE}
          </Button>
        )}
        {update && (
          <Button size="sm" disabled={busy} onClick={() => onApply(install, update.requiresReconsent)}>
            {update.requiresReconsent ? TEXT.EXT_SOURCES_UPDATE_APPLY : TEXT.EXT_SOURCES_UPDATE_AUTO}
          </Button>
        )}
      </div>
    </li>
  );
}

interface ConsentTarget {
  sourceId: string;
  origin: string;
  payload: ConsentPayload;
  update: boolean;
  requiresReconsent: boolean;
}

export function ExtensionSourcesSection(): ReactElement {
  const [state, setState] = useState<MiniAppSourcesState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<MiniAppSourceView | null>(null);
  const [consent, setConsent] = useState<ConsentTarget | null>(null);

  const refresh = useCallback(async () => {
    setState(await window.electronAPI.getMiniAppSources());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sources = useMemo(() => state?.sources ?? [], [state]);
  const installs = useMemo(() => state?.installs ?? [], [state]);

  const run = useCallback(
    async (action: () => Promise<void>) => {
      setBusy(true);
      setNotice(null);
      try {
        await action();
      } finally {
        setBusy(false);
        await refresh();
      }
    },
    [refresh]
  );

  const sync = useCallback(
    (sourceId: string) =>
      void run(async () => {
        const result = await window.electronAPI.syncMiniAppSource(sourceId);
        if (!result.ok) {
          setNotice(interpolate(TEXT.EXT_SOURCES_SYNC_FAILED, { code: result.error.code, detail: result.error.detail }));
        }
      }),
    [run]
  );

  const addSource = useCallback(
    (descriptor: unknown, secrets?: Record<string, string>) =>
      void run(async () => {
        const result = await window.electronAPI.addMiniAppSource(descriptor, secrets);
        if (!result.ok) {
          setNotice(interpolate(TEXT.EXT_SOURCES_ADD_FAILED, { error: result.error }));
          return;
        }
        setAdding(false);
      }),
    [run]
  );

  const remove = useCallback(
    (sourceId: string) =>
      void run(async () => {
        await window.electronAPI.removeMiniAppSource(sourceId);
        setRemoving(null);
      }),
    [run]
  );

  const install = useCallback(
    (target: ConsentTarget) =>
      void run(async () => {
        const result: InstallExtensionResult = target.update
          ? await window.electronAPI.applyMiniAppExtensionUpdate(target.sourceId, target.payload.extensionId, true)
          : await window.electronAPI.installMiniAppExtension(target.sourceId, target.payload.extensionId, true);
        if (!result.ok) {
          setNotice(interpolate(TEXT.EXT_SOURCES_CONSENT_FAILED, { error: result.error }));
          return;
        }
        setConsent(null);
      }),
    [run]
  );

  const restore = useCallback(
    (extensionId: string) =>
      void run(async () => {
        await window.electronAPI.restoreMiniAppExtension(extensionId);
      }),
    [run]
  );

  const applyAuto = useCallback(
    (install: MiniAppSourceInstallView) =>
      void run(async () => {
        const result = await window.electronAPI.applyMiniAppExtensionUpdate(install.sourceId, install.extensionId, false);
        if (!result.ok) {
          setNotice(interpolate(TEXT.EXT_SOURCES_CONSENT_FAILED, { error: result.error }));
        }
      }),
    [run]
  );

  const applyWithReconsent = useCallback(
    (install: MiniAppSourceInstallView) => {
      const source = sources.find((entry) => entry.id === install.sourceId);
      const candidate = source?.candidates.find((entry) => entry.extensionId === install.extensionId);
      const update = install.update?.state === 'available' ? install.update : null;
      if (!source || !update) {
        return;
      }
      setConsent({
        sourceId: install.sourceId,
        origin: source.origin,
        payload:
          candidate?.consent ??
          {
            extensionId: install.extensionId,
            version: update.manifestDiff.versionTo,
            subpath: '',
            digest: update.digest,
            tier: 'T0',
            importClass: 'imported',
            originClass: 'imported',
            capabilities: [],
            provenance: install.provenance,
            disclosure: '',
          },
        update: true,
        requiresReconsent: update.requiresReconsent,
      });
    },
    [sources]
  );

  return (
    <section aria-label={TEXT.EXT_SOURCES_TITLE} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">{TEXT.EXT_SOURCES_TITLE}</h3>
          <p className="text-xs text-[var(--as-muted-foreground)]">{TEXT.EXT_SOURCES_HINT}</p>
        </div>
        <Button size="sm" onClick={() => setAdding(true)}>
          {TEXT.EXT_SOURCES_ADD}
        </Button>
      </div>
      {notice && (
        <p role="alert" className="rounded-md border border-[var(--as-destructive)]/40 bg-[var(--as-destructive)]/10 px-3 py-2 text-xs text-[var(--as-destructive)]">
          {notice}
        </p>
      )}
      {sources.length === 0 && installs.length === 0 ? (
        <EmptyState title={TEXT.EXT_SOURCES_EMPTY} description={TEXT.EXT_SOURCES_EMPTY_HINT} />
      ) : (
        <>
          {sources.length > 0 && (
            <ul className="space-y-3">
              {sources.map((source) => (
                <li key={source.id}>
                  <SourceCard source={source} onSync={() => sync(source.id)} onRemove={() => setRemoving(source)} onInstall={(candidate) => setConsent({ sourceId: source.id, origin: source.origin, payload: candidate.consent, update: false, requiresReconsent: false })} busy={busy} />
                </li>
              ))}
            </ul>
          )}
          {installs.length > 0 && (
            <Card className="p-4">
              <h4 className="text-xs font-medium">{TEXT.EXT_SOURCES_INSTALLED_TITLE}</h4>
              <ul className="divide-y divide-[var(--as-border)]">
                {installs.map((install) => (
                  <InstallCard
                    key={install.extensionId}
                    install={install}
                    onApply={(target, requiresReconsent) => (requiresReconsent ? applyWithReconsent(target) : applyAuto(target))}
                    onRestore={restore}
                    busy={busy}
                  />
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
      {adding && <AddSourceModal onCancel={() => setAdding(false)} onAdd={addSource} busy={busy} />}
      {removing && (
        <ConfirmationModal
          open
          onOpenChange={(open) => !open && setRemoving(null)}
          title={TEXT.EXT_SOURCES_REMOVE_CONFIRM_TITLE}
          description={interpolate(TEXT.EXT_SOURCES_REMOVE_CONFIRM_BODY, { origin: removing.origin })}
          confirmLabel={TEXT.EXT_SOURCES_REMOVE}
          destructive
          onConfirm={() => remove(removing.id)}
        />
      )}
      {consent && <ConsentModal target={consent} busy={busy} onConfirm={() => install(consent)} onClose={() => setConsent(null)} />}
    </section>
  );
}

function ConsentModal({ target, busy, onConfirm, onClose }: { target: ConsentTarget; busy: boolean; onConfirm: () => void; onClose: () => void }): ReactElement {
  const { payload } = target;
  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>{TEXT.EXT_SOURCES_CONSENT_TITLE}</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <div className="space-y-3 text-sm">
            <p>
              {interpolate(TEXT.EXT_SOURCES_CONSENT_BODY, { id: payload.extensionId, version: payload.version, origin: target.origin })}
            </p>
            <div className="flex flex-wrap gap-1" aria-label={TEXT.EXT_SOURCES_CONSENT_CAPABILITIES}>
              {payload.capabilities.map((capability) => (
                <Badge key={capability} variant="secondary" className="text-[10px]">
                  {capabilityLabel(capability)}
                </Badge>
              ))}
            </div>
            <dl className="space-y-1 text-xs">
              <div className="flex gap-2">
                <dt className="font-medium">{TEXT.EXT_SOURCES_CONSENT_TIER}:</dt>
                <dd>{TEXT.EXT_SOURCES_CONSENT_TIER_VALUE}</dd>
              </div>
              {payload.provenance.author && (
                <div className="flex gap-2">
                  <dt className="font-medium">{TEXT.EXT_SOURCES_CONSENT_AUTHOR}:</dt>
                  <dd>{payload.provenance.author}</dd>
                </div>
              )}
              {payload.provenance.license && (
                <div className="flex gap-2">
                  <dt className="font-medium">{TEXT.EXT_SOURCES_CONSENT_LICENSE}:</dt>
                  <dd>{payload.provenance.license}</dd>
                </div>
              )}
              {payload.provenance.repository && (
                <div className="flex gap-2">
                  <dt className="font-medium">{TEXT.EXT_SOURCES_CONSENT_REPOSITORY}:</dt>
                  <dd className="break-all">{payload.provenance.repository}</dd>
                </div>
              )}
              <div className="flex gap-2">
                <dt className="font-medium">{TEXT.EXT_SOURCES_CONSENT_DIGEST}:</dt>
                <dd className="break-all font-mono">{payload.digest}</dd>
              </div>
            </dl>
            {payload.disclosure && (
              <p className="rounded-md border border-[var(--as-border)] bg-[var(--as-background)] px-3 py-2 text-xs text-[var(--as-muted-foreground)]">{payload.disclosure}</p>
            )}
            {target.update && target.requiresReconsent && <p className="text-xs text-[var(--as-destructive)]">{TEXT.EXT_SOURCES_CONSENT_RECONSENT_NOTICE}</p>}
            <p className="text-xs text-[var(--as-muted-foreground)]">{TEXT.EXT_SOURCES_CONSENT_NO_AUTOAPPLY}</p>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            {TEXT.EXT_SOURCES_CONSENT_DECLINED}
          </Button>
          <Button size="sm" onClick={onConfirm} disabled={busy}>
            {TEXT.EXT_SOURCES_CONSENT_CONFIRM}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function AddSourceModal({ onCancel, onAdd, busy }: { onCancel: () => void; onAdd: (descriptor: unknown, secrets?: Record<string, string>) => void; busy: boolean }): ReactElement {
  const [kind, setKind] = useState<'git' | 'local'>('git');
  const [url, setUrl] = useState('');
  const [path, setPath] = useState('');
  const [strategy, setStrategy] = useState<(typeof REF_STRATEGIES)[number]>('release-tag');
  const [refValue, setRefValue] = useState('');
  const [subpath, setSubpath] = useState('');

  const submit = useCallback(() => {
    const ref = strategy === 'release-tag' ? { strategy } : { strategy, value: refValue };
    const descriptor =
      kind === 'git'
        ? { url, ref, ...(subpath ? { subpath } : {}) }
        : { local: { path }, ref, ...(subpath ? { subpath } : {}) };
    onAdd(descriptor);
  }, [kind, url, path, strategy, refValue, subpath, onAdd]);

  const inputClass = 'w-full rounded-md border border-[var(--as-border)] bg-[var(--as-background)] px-2 py-1.5 text-sm';
  const needsValue = strategy === 'tag-pattern' || strategy === 'branch' || strategy === 'commit-pin';

  return (
    <Modal open onOpenChange={(open) => !open && onCancel()}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>{TEXT.EXT_SOURCES_ADD_TITLE}</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <div className="space-y-3">
            <div className="flex gap-2" role="radiogroup" aria-label={TEXT.EXT_SOURCES_ADD_TITLE}>
              <Button variant={kind === 'git' ? 'default' : 'outline'} size="sm" onClick={() => setKind('git')} aria-pressed={kind === 'git'}>
                {TEXT.EXT_SOURCES_ADD_KIND_GIT}
              </Button>
              <Button variant={kind === 'local' ? 'default' : 'outline'} size="sm" onClick={() => setKind('local')} aria-pressed={kind === 'local'}>
                {TEXT.EXT_SOURCES_ADD_KIND_LOCAL}
              </Button>
            </div>
            {kind === 'git' ? (
              <label className="block space-y-1">
                <span className="text-sm">{TEXT.EXT_SOURCES_ADD_URL_LABEL}</span>
                <input type="text" className={inputClass} value={url} placeholder={TEXT.EXT_SOURCES_ADD_URL_PLACEHOLDER} onChange={(event) => setUrl(event.target.value)} />
              </label>
            ) : (
              <label className="block space-y-1">
                <span className="text-sm">{TEXT.EXT_SOURCES_ADD_LOCAL_LABEL}</span>
                <input type="text" className={inputClass} value={path} placeholder={TEXT.EXT_SOURCES_ADD_LOCAL_PLACEHOLDER} onChange={(event) => setPath(event.target.value)} />
              </label>
            )}
            <label className="block space-y-1">
              <span className="text-sm">{TEXT.EXT_SOURCES_ADD_REF_LABEL}</span>
              <select className={inputClass} value={strategy} onChange={(event) => setStrategy(event.target.value as (typeof REF_STRATEGIES)[number])}>
                {REF_STRATEGIES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            {needsValue && (
              <label className="block space-y-1">
                <span className="text-sm">{TEXT.EXT_SOURCES_ADD_REF_VALUE_LABEL}</span>
                <input type="text" className={inputClass} value={refValue} onChange={(event) => setRefValue(event.target.value)} />
              </label>
            )}
            <label className="block space-y-1">
              <span className="text-sm">{TEXT.EXT_SOURCES_ADD_SUBPATH_LABEL}</span>
              <input type="text" className={inputClass} value={subpath} onChange={(event) => setSubpath(event.target.value)} />
            </label>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>
            {TEXT.EXT_SOURCES_ADD_CANCEL}
          </Button>
          <Button size="sm" onClick={submit} disabled={busy || (kind === 'git' ? url.trim().length === 0 : path.trim().length === 0) || (needsValue && refValue.trim().length === 0)}>
            {TEXT.EXT_SOURCES_ADD_SUBMIT}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
