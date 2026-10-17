import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import { Card } from '@neuronection/assistant-ui/card';
import { ConfirmationModal } from '@neuronection/assistant-ui/confirmation-modal';
import { AddIntegrationSourceDialog } from '@neuronection/assistant-ui/add-integration-source-dialog';
import { ConsentDialog } from '@neuronection/assistant-ui/consent-dialog';
import { IntegrationInstancesList } from '@neuronection/assistant-ui/integration-instances-list';
import { IntegrationSourcesList } from '@neuronection/assistant-ui/integration-sources-list';
import type { IntegrationSourcesListLabels } from '@neuronection/assistant-ui/integration-sources-list';
import type { IntegrationInstanceView, IntegrationSourceDraft } from '@neuronection/assistant-ui/integration-contracts';
import {
  consentView,
  orphanGroups,
  sourceDraftToDescriptor,
  sourceRows,
  updateConsentView,
} from './integration-views';
import { TEXT, interpolate } from '@shared/constants/text';
import type {
  ConsentPayload,
  InstallExtensionResult,
  MiniAppSourceInstallView,
  MiniAppSourceView,
  MiniAppSourcesState,
  SourceCandidate,
} from '@shared/app-pack';

const SOURCES_LABELS: IntegrationSourcesListLabels = {
  emptyLabel: TEXT.EXT_SOURCES_EMPTY,
  checkLabel: TEXT.EXT_SOURCES_SYNC,
  checkAriaLabel: TEXT.EXT_SOURCES_SYNC,
  removeSourceLabel: TEXT.EXT_SOURCES_REMOVE,
  removeSourceAriaLabel: TEXT.EXT_SOURCES_REMOVE,
  candidateLabel: TEXT.EXT_SOURCES_ORIGIN_LISTED,
  installLabel: TEXT.EXT_SOURCES_INSTALL,
  kindLabels: { git: TEXT.EXT_SOURCES_KIND_GIT, local: TEXT.EXT_SOURCES_KIND_LOCAL },
  statusLabels: {
    ok: TEXT.EXT_SOURCES_STATUS_OK,
    degraded: TEXT.EXT_SOURCES_STATUS_DEGRADED,
    failing: TEXT.EXT_SOURCES_STATUS_FAILING,
    stale: TEXT.EXT_SOURCES_STATUS_STALE,
  },
  updateAvailableLabel: TEXT.EXT_SOURCES_UPDATE_BADGE,
  reconsentRequiredLabel: TEXT.EXT_SOURCES_UPDATE_RECONSENT,
  digestDriftLabel: TEXT.EXT_SOURCES_UPDATE_DRIFT,
  parkedLabel: TEXT.EXT_SOURCES_PARKED_BADGE,
  restoreLabel: TEXT.EXT_SOURCES_RESTORE,
  applyUpdateLabel: TEXT.EXT_SOURCES_UPDATE_APPLY,
  lastSuccessLabel: TEXT.EXT_SOURCES_CONSENTED_AT,
};

const CONSENT_LABELS = {
  installTitle: TEXT.EXT_SOURCES_CONSENT_TITLE,
  updateTitle: TEXT.EXT_SOURCES_CONSENT_TITLE,
  reconsentTitle: TEXT.EXT_SOURCES_CONSENT_RECONSENT_TITLE,
  tierLabel: TEXT.EXT_SOURCES_CONSENT_TIER,
  versionLabel: TEXT.EXT_SOURCES_CONSENT_VERSION,
  authorLabel: TEXT.EXT_SOURCES_CONSENT_AUTHOR,
  licenseLabel: TEXT.EXT_SOURCES_CONSENT_LICENSE,
  repositoryLabel: TEXT.EXT_SOURCES_CONSENT_REPOSITORY,
  digestLabel: TEXT.EXT_SOURCES_CONSENT_DIGEST,
  capabilitiesLabel: TEXT.EXT_SOURCES_CONSENT_CAPABILITIES,
  changesLabel: TEXT.EXT_SOURCES_CHANGES,
  addedLabel: TEXT.EXT_SOURCES_ADDED_CAPABILITIES,
  versionChangeLabel: TEXT.EXT_SOURCES_CONSENT_VERSION,
  digestChangeLabel: TEXT.EXT_SOURCES_CONSENT_DIGEST,
  confirmLabel: TEXT.EXT_SOURCES_CONSENT_CONFIRM,
  declineLabel: TEXT.EXT_SOURCES_CONSENT_DECLINED,
};

interface ConsentTarget {
  sourceId: string;
  origin: string;
  payload: ConsentPayload | null;
  install: MiniAppSourceInstallView | null;
  candidate: SourceCandidate | null;
  update: boolean;
  requiresReconsent: boolean;
}

function consentDescription(target: ConsentTarget): string {
  const id = target.update ? (target.install?.extensionId ?? '') : (target.payload?.extensionId ?? '');
  const version = target.update
    ? target.install?.update?.state === 'available'
      ? target.install.update.manifestDiff.versionTo
      : (target.install?.version ?? '')
    : (target.payload?.version ?? '');
  const parts = [interpolate(TEXT.EXT_SOURCES_CONSENT_BODY, { id, version, origin: target.origin })];
  if (target.update && target.requiresReconsent) {
    parts.push(TEXT.EXT_SOURCES_CONSENT_RECONSENT_NOTICE);
  }
  parts.push(TEXT.EXT_SOURCES_CONSENT_NO_AUTOAPPLY);
  return parts.join(' ');
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
  const rows = useMemo(() => (state ? sourceRows(state) : []), [state]);
  const orphans = useMemo(() => (state ? orphanGroups(state) : []), [state]);

  const rawCandidate = useCallback(
    (sourceId: string, extensionId: string): SourceCandidate | undefined =>
      sources.find((source) => source.id === sourceId)?.candidates.find(
        (candidate) => candidate.extensionId === extensionId
      ),
    [sources]
  );

  const originOf = useCallback(
    (sourceId: string): string => sources.find((source) => source.id === sourceId)?.origin ?? '',
    [sources]
  );

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
    (draft: IntegrationSourceDraft) => {
      const { descriptor, secrets } = sourceDraftToDescriptor(draft);
      void run(async () => {
        const result = await window.electronAPI.addMiniAppSource(descriptor, secrets);
        if (!result.ok) {
          setNotice(interpolate(TEXT.EXT_SOURCES_ADD_FAILED, { error: result.error }));
          return;
        }
        setAdding(false);
      });
    },
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
          ? await window.electronAPI.applyMiniAppExtensionUpdate(target.sourceId, target.install?.extensionId ?? '', true)
          : await window.electronAPI.installMiniAppExtension(target.sourceId, target.payload?.extensionId ?? '', true);
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
    (sourceId: string, extensionId: string) =>
      void run(async () => {
        const result = await window.electronAPI.applyMiniAppExtensionUpdate(sourceId, extensionId, false);
        if (!result.ok) {
          setNotice(interpolate(TEXT.EXT_SOURCES_CONSENT_FAILED, { error: result.error }));
        }
      }),
    [run]
  );

  const openUpdateConsent = useCallback(
    (install: MiniAppSourceInstallView) => {
      const update = install.update?.state === 'available' ? install.update : null;
      if (!update) {
        return;
      }
      setConsent({
        sourceId: install.sourceId,
        origin: originOf(install.sourceId),
        payload: null,
        install,
        candidate: rawCandidate(install.sourceId, install.extensionId) ?? null,
        update: true,
        requiresReconsent: update.requiresReconsent,
      });
    },
    [originOf, rawCandidate]
  );

  const installCandidate = useCallback(
    (sourceId: string, candidate: { extensionId: string }) => {
      const raw = rawCandidate(sourceId, candidate.extensionId);
      if (!raw) {
        return;
      }
      setConsent({
        sourceId,
        origin: originOf(sourceId),
        payload: raw.consent,
        install: null,
        candidate: raw,
        update: false,
        requiresReconsent: false,
      });
    },
    [originOf, rawCandidate]
  );

  const findInstall = useCallback(
    (sourceId: string, extensionId: string): MiniAppSourceInstallView | undefined =>
      state?.installs.find(
        (install) => install.extensionId === extensionId && (sourceId === '' || install.sourceId === sourceId)
      ),
    [state]
  );

  const instanceActions = useCallback(
    (sourceId: string, instance: IntegrationInstanceView): ReactElement => {
      const install = findInstall(sourceId, instance.id);
      if (!install) {
        return <></>;
      }
      const update = install.update?.state === 'available' ? install.update : null;
      return (
        <>
          <span className="font-mono text-[11px] text-[var(--as-muted-foreground)]">
            {interpolate(TEXT.EXT_SOURCES_PIN, { ref: install.pinRef })}
            {install.consentedAt !== null ? ` · ${new Date(install.consentedAt).toLocaleString()}` : ''}
          </span>
          {install.update?.state === 'absent-from-source' && (
            <span className="text-xs text-[var(--as-muted-foreground)]">{TEXT.EXT_SOURCES_UPDATE_ABSENT}</span>
          )}
          {update && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => (update.requiresReconsent ? openUpdateConsent(install) : applyAuto(sourceId, install.extensionId))}
            >
              {update.requiresReconsent ? TEXT.EXT_SOURCES_UPDATE_APPLY : TEXT.EXT_SOURCES_UPDATE_AUTO}
            </Button>
          )}
          {install.parked && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void restore(install.extensionId)}>
              {TEXT.EXT_SOURCES_RESTORE}
            </Button>
          )}
        </>
      );
    },
    [applyAuto, busy, findInstall, openUpdateConsent, restore]
  );

  const consentPayload = consent
    ? consent.update && consent.install
      ? updateConsentView(consent.install, consent.candidate ?? undefined)
      : consentView(
          consent.payload ?? {
            extensionId: '',
            version: '',
            subpath: '',
            digest: '',
            tier: 'T0',
            importClass: 'imported',
            originClass: 'imported',
            capabilities: [],
            provenance: {},
            disclosure: '',
          }
        )
    : null;

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
      <IntegrationSourcesList
        sources={rows}
        labels={SOURCES_LABELS}
        busy={busy}
        onCheck={(sourceId) => sync(sourceId)}
        onRemoveSource={(sourceId) => {
          const source = sources.find((entry) => entry.id === sourceId);
          if (source) {
            setRemoving(source);
          }
        }}
        onInstallCandidate={installCandidate}
        renderInstanceActions={instanceActions}
      />
      {orphans.length > 0 && (
        <Card className="p-4">
          <h4 className="text-xs font-medium">{TEXT.EXT_SOURCES_INSTALLED_TITLE}</h4>
          <IntegrationInstancesList
            groups={orphans}
            labels={SOURCES_LABELS}
            busy={busy}
            renderInstanceActions={(instance) => instanceActions('', instance)}
          />
        </Card>
      )}
      <AddIntegrationSourceDialog
        open={adding}
        onOpenChange={setAdding}
        onSubmit={addSource}
        busy={busy}
        labels={{
          title: TEXT.EXT_SOURCES_ADD_TITLE,
          urlLabel: TEXT.EXT_SOURCES_ADD_URL_LABEL,
          localPathLabel: TEXT.EXT_SOURCES_ADD_LOCAL_LABEL,
          refStrategyLabel: TEXT.EXT_SOURCES_ADD_REF_LABEL,
          refValueLabel: TEXT.EXT_SOURCES_ADD_REF_VALUE_LABEL,
          subpathLabel: TEXT.EXT_SOURCES_ADD_SUBPATH_LABEL,
          submitLabel: TEXT.EXT_SOURCES_ADD_SUBMIT,
          cancelLabel: TEXT.EXT_SOURCES_ADD_CANCEL,
        }}
      />
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
      <ConsentDialog
        open={consent !== null}
        onOpenChange={(open) => !open && setConsent(null)}
        payload={consentPayload}
        busy={busy}
        labels={{ ...CONSENT_LABELS, description: consent ? consentDescription(consent) : undefined }}
        onConsent={() => consent && install(consent)}
        onDecline={() => setConsent(null)}
      />
    </section>
  );
}
