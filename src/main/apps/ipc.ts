import { BrowserWindow, app } from 'electron';
import { register } from '@main/ipc/register';
import { IPC } from '@shared/ipc/registry';
import { join } from 'node:path';
import { PACK_LIMITS, isConsentEcho, type ImportMiniAppResult, type AddSourceResult, type ApplyUpdateResult, type InstallExtensionResult, type MiniAppSaveConfigResult, type MiniAppSetEnabledResult, type MiniAppSourcesState, type MiniAppsState, type MiniAppRunView, type MiniAppRunReportView, type MiniAppRunDiffView, type MiniAppExportFormat, type MiniAppLiveCardView, type MiniAppRunStats, type RestoreExtensionResult, type SourceSyncResult } from '@shared/app-pack';
import { joinWithinRoot, validateRunRoot, type PackFsEnv } from './capabilities/fs';
import { nodePackFsDeps } from './capabilities/node-fs';
import { packDocPage, packDocs } from './docs';
import type { PackDocPageResult, PackDocsResult } from '@shared/app-pack';
import { exportRunReport } from './run/export';
import type { MiniAppStack } from './composition';

/** Every channel this module registers (the teardown list consumes this). */

/**
 * The mini-app IPC surface (plan 26): every `miniapps:*` handler in one
 * registrar, consuming the stack built in `composition.ts`. Handler
 * bodies validate argument shapes main-side (the renderer is untrusted)
 * and never re-implement domain logic.
 */
export function registerMiniAppIpc(stack: MiniAppStack, fsEnv: Parameters<typeof validateRunRoot>[1]): void {
  const { registry, runService, proposalService } = stack;

  /** Bundled packs' on-disk root — the in-repo `src/packs` (dev) or the
   * packaged `resources/packs` copy (the sandbox-child dual resolution). */
  const bundledPacksBase = () =>
    app.isPackaged ? join(process.resourcesPath, 'packs') : join(app.getAppPath(), 'src', 'packs');

  register(IPC['miniapps:get-state'], async (): Promise<MiniAppsState> => {
    const state = registry.getState();
    const statuses = await stack.status.list('pack');
    const sources = await stack.sources.listState();
    return {
      ...state,
      packs: state.packs.map((pack) => {
        const install = sources.installs.find((candidate) => candidate.extensionId === pack.id);
        const instanceStatus = statuses.get(pack.id);
        return {
          ...pack,
          ...(instanceStatus ? { instanceStatus } : {}),
          ...(install ? { update: install.update } : {}),
        };
      }),
    };
  });

  register(IPC['miniapps:docs-tree'], async (_event, id: any): Promise<PackDocsResult> => {
    
    const installed = registry.getInstalled(id);
    if (!installed) {
      return { ok: false, error: 'Unknown pack.' };
    }
    return packDocs(installed, bundledPacksBase());
  });

  register(IPC['miniapps:docs-page'], async (_event, id: any, file: any): Promise<PackDocPageResult> => {
    
    
    const installed = registry.getInstalled(id);
    if (!installed) {
      return { ok: false, error: 'Unknown pack.' };
    }
    return packDocPage(installed, file, bundledPacksBase());
  });

  register(IPC['miniapps:import'], async (_event, json: any, path: any): Promise<ImportMiniAppResult> => {
    
    const originPath = typeof path === 'string' && path.length > 0 && path.length <= 1024 ? path : undefined;
    return registry.importManifest(json, { kind: 'imported', ...(originPath ? { path: originPath } : {}) });
  });

  register(IPC['miniapps:remove'], async (_event, id: any): Promise<boolean> => {
    
    const removed = await registry.remove(id);
    if (removed) {
      stack.windows.closeForPack(id, 'pack-removed');
      stack.sandbox.killPack(id);
    }
    return removed;
  });

  register(IPC['miniapps:set-enabled'], async (_event, id: any, enabled: any): Promise<MiniAppSetEnabledResult> => {
    
    
    const result = await registry.setEnabled(id as string | null, enabled);
    if (result.ok && !enabled) {
      if (id === null) {
        stack.windows.closeAll('kill-switch');
        for (const packId of stack.sandbox.livePacks()) {
          stack.sandbox.killPack(packId);
        }
      } else {
        stack.windows.closeForPack(id as string, 'pack-disabled');
        stack.sandbox.killPack(id as string);
      }
    }
    return result;
  });

  register(IPC['miniapps:save-config'], async (_event, id: any, values: any): Promise<MiniAppSaveConfigResult> => {
    
    return registry.saveConfig(id, values);
  });

  register(IPC['miniapps:pick-root'], async (event): Promise<{ ok: true; root: string } | { ok: false; error: string }> => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      return { ok: false, error: 'No window.' };
    }
    const { dialog } = await import('electron');
    const picked = await dialog.showOpenDialog(window, { title: 'Choose a folder to assess', properties: ['openDirectory'] });
    if (picked.canceled || picked.filePaths.length === 0) {
      return { ok: false, error: 'cancelled' };
    }
    return { ok: true, root: picked.filePaths[0] };
  });

  register(IPC['miniapps:run-start'], async (_event, packId: any, rootPath: any, options: any): Promise<{ ok: true; runId: string } | { ok: false; error: string }> => {
    
    
    const maxModelCalls =
      typeof options === 'object' && options !== null && typeof (options as { maxModelCalls?: any }).maxModelCalls === 'number'
        ? (options as { maxModelCalls: number }).maxModelCalls
        : undefined;
    const started = await runService.start(packId, rootPath, maxModelCalls !== undefined ? { maxModelCalls } : {});
    if (!started.ok) {
      return { ok: false, error: stack.formatError(started.error) };
    }
    return { ok: true, runId: started.runId };
  });

  register(IPC['miniapps:run-cancel'], async (_event, runId: any): Promise<{ ok: true } | { ok: false; error: string }> => {
    
    const result = await runService.cancel(runId);
    return result.ok ? { ok: true } : { ok: false, error: stack.formatError(result.error) };
  });

  register(IPC['miniapps:run-resume'], async (_event, runId: any): Promise<{ ok: true } | { ok: false; error: string }> => {
    
    const result = await runService.resume(runId);
    return result.ok ? { ok: true } : { ok: false, error: stack.formatError(result.error) };
  });

  register(IPC['miniapps:runs-list'], async (_event, packId: any): Promise<MiniAppRunView[]> => {
    const scoped = typeof packId === 'string' && packId.length > 0 && packId.length <= 200 ? packId : undefined;
    const rows = await runService.recentRuns(scoped, 20);
    return rows.map(stack.runRowToView);
  });

  register(IPC['miniapps:run-report'], async (_event, runId: any): Promise<MiniAppRunReportView | null> => {
    
    return stack.buildReportView(runId);
  });

  register(IPC['miniapps:live-card'], async (_event, packId: any): Promise<MiniAppLiveCardView | null> => {
    
    return stack.buildLiveCardView(packId);
  });

  register(IPC['miniapps:run-stats'], async (_event, windowDays: any): Promise<MiniAppRunStats> => {
    const days = windowDays === 7 || windowDays === 30 ? windowDays : null;
    return stack.buildRunStats(days);
  });

  register(IPC['miniapps:run-export'], async (_event, runId: any, format: any): Promise<{ ok: true; text: string; fileName: string } | { ok: false; error: string }> => {
    
    if (format !== 'markdown' && format !== 'json' && format !== 'csv') {
      return { ok: false, error: 'Unknown export format.' };
    }
    const report = await stack.buildReportView(runId, 0);
    if (!report) {
      return { ok: false, error: 'Unknown run.' };
    }
    return {
      ok: true,
      text: exportRunReport(report, format as MiniAppExportFormat),
      fileName: `${report.run.packId}-${report.run.id}.${format === 'markdown' ? 'md' : format}`,
    };
  });

  register(IPC['miniapps:run-diff'], async (_event, runId: any): Promise<MiniAppRunDiffView | null> => {
    
    return stack.diffFor(runId);
  });

  register(IPC['miniapps:override-item'], async (_event, runId: any, relPath: any, verdict: any): Promise<{ ok: true } | { ok: false; error: string }> => {
    
    
    if (verdict !== 'keep' && verdict !== 'ask' && verdict !== 'candidate') {
      return { ok: false, error: 'Invalid verdict.' };
    }
    const run = await runService.getRun(runId);
    if (!run) {
      return { ok: false, error: 'Unknown run.' };
    }
    await stack.store().upsertFeedback({
      packId: run.packId,
      rootPath: run.rootPath,
      relPath,
      verdict,
      source: 'override',
    });
    await stack.store().updateItemVerdict(runId, relPath, verdict, 'override:user');
    return { ok: true };
  });

  register(IPC['miniapps:exclude-item'], async (_event, runId: any, relPath: any): Promise<{ ok: true } | { ok: false; error: string }> => {
    
    
    const run = await runService.getRun(runId);
    if (!run) {
      return { ok: false, error: 'Unknown run.' };
    }
    await stack.store().upsertFeedback({
      packId: run.packId,
      rootPath: run.rootPath,
      relPath,
      verdict: 'keep',
      source: 'exclude',
    });
    await stack.store().updateItemVerdict(runId, relPath, 'keep', 'override:exclude');
    return { ok: true };
  });

  register(IPC['miniapps:reveal-item'], async (_event, runId: any, relPath: any): Promise<{ ok: true } | { ok: false; error: string }> => {
    
    const run = await runService.getRun(runId);
    if (!run) {
      return { ok: false, error: 'Unknown run.' };
    }
    const validated = await validateRunRoot(run.rootPath, fsEnv, nodePackFsDeps);
    if (!validated.ok) {
      return { ok: false, error: stack.formatError(validated.error) };
    }
    const joined = joinWithinRoot(validated.value.root, relPath);
    if (joined === null) {
      return { ok: false, error: 'Path escapes the run root.' };
    }
    const { stat } = await import('fs/promises');
    try {
      await stat(joined);
    } catch {
      return { ok: false, error: 'The file no longer exists.' };
    }
    const { shell } = await import('electron');
    shell.showItemInFolder(joined);
    return { ok: true };
  });

  register(IPC['miniapps:open-item'], async (_event, runId: any, relPath: any): Promise<{ ok: true } | { ok: false; error: string }> => {
    
    const run = await runService.getRun(runId);
    if (!run) {
      return { ok: false, error: 'Unknown run.' };
    }
    const validated = await validateRunRoot(run.rootPath, fsEnv, nodePackFsDeps);
    if (!validated.ok) {
      return { ok: false, error: stack.formatError(validated.error) };
    }
    const joined = joinWithinRoot(validated.value.root, relPath);
    if (joined === null) {
      return { ok: false, error: 'Path escapes the run root.' };
    }
    const { stat } = await import('fs/promises');
    const { EXECUTABLE_EXTENSIONS } = await import('@main/ai/tools/native/open-path');
    try {
      const info = await stat(joined);
      if (!info.isFile()) {
        return { ok: false, error: 'Not a file.' };
      }
      if ([...EXECUTABLE_EXTENSIONS].some((extension) => joined.toLowerCase().endsWith(extension))) {
        return { ok: false, error: 'Executables are refused.' };
      }
    } catch {
      return { ok: false, error: 'The file no longer exists.' };
    }
    const { shell } = await import('electron');
    const error = await shell.openPath(joined);
    if (error) {
      return { ok: false, error };
    }
    return { ok: true };
  });

  register(IPC['miniapps:arm-run'], async (_event, runId: any): Promise<{ ok: true; proposal: any } | { ok: false; error: string }> => {
    
    const run = await runService.getRun(runId);
    if (!run) {
      return { ok: false, error: 'Unknown run.' };
    }
    if (run.disallowArm) {
      return {
        ok: false,
        error: stack.formatError({ code: 'invalid', detail: { message: 'scheduled runs are report-only — arming is structurally unavailable to them' } }),
      };
    }
    const pack = registry.runnablePack(run.packId);
    if (!pack) {
      return { ok: false, error: 'Pack is not runnable.' };
    }
    const items = await runService.itemsOfRun(runId);
    const fs = await stack.openRunFs(run.rootPath);
    if (!fs) {
      return { ok: false, error: 'The run root is no longer accessible.' };
    }
    const armed = await proposalService.arm(pack, run, items, fs);
    if (!armed.ok) {
      return { ok: false, error: stack.formatError(armed.error) };
    }
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('miniapps:proposal-event', { type: 'proposal:created', proposalId: armed.proposal.id, runId, packId: run.packId });
    }
    return { ok: true, proposal: armed.proposal };
  });

  register(IPC['miniapps:resolve-proposal'], async (_event, proposalId: any, approve: any): Promise<{ ok: true; outcome: any } | { ok: false; error: string }> => {
    
    
    const resolved = await proposalService.resolve(proposalId, approve);
    if (!resolved.ok) {
      return { ok: false, error: stack.formatError(resolved.error) };
    }
    if (!resolved.executed) {
      return { ok: true, outcome: null };
    }
    const outcome = await stack.executeProposal(proposalId);
    return { ok: true, outcome };
  });

  register(IPC['miniapps:abort-proposal'], (_event, proposalId: any): boolean => {
    
    proposalService.abort(proposalId);
    return true;
  });

  register(IPC['miniapps:restore-item'], async (_event, runId: any, relPath: any): Promise<{ ok: true; restoredPath: string } | { ok: false; error: string }> => {
    
    const result = await proposalService.restoreItem(runId, relPath);
    return result.ok ? { ok: true, restoredPath: result.restoredPath } : { ok: false, error: stack.formatError(result.error) };
  });

  register(IPC['miniapps:restore-quarantine-record'], async (_event, recordId: any): Promise<{ ok: true; restoredPath: string } | { ok: false; error: string }> => {
    
    return stack.restoreQuarantineRecord(recordId);
  });

  register(IPC['miniapps:restore-batch'], async (_event, proposalId: any): Promise<{ ok: true; restored: number } | { ok: false; error: string }> => {
    
    const result = await proposalService.restoreBatch(proposalId);
    return result.ok ? { ok: true, restored: result.restored } : { ok: false, error: stack.formatError(result.error) };
  });

  register(IPC['miniapps:restore-bundled'], async (): Promise<{ ok: true; installed: string[] } | { ok: false; error: string }> => {
    try {
      const installed = await stack.installBundled(true);
      return { ok: true, installed };
    } catch (error) {
      return { ok: false, error: String((error as Error)?.message ?? error) };
    }
  });

  register(IPC['miniapps:quarantine-list'], async (_event, packId: any): Promise<{ packId: string; records: { id: string; relPath: string; originPath: string; movedAt: number; restoredAt: number | null }[] } | null> => {
    
    const records = await stack.quarantineStore().byPack(packId);
    return {
      packId,
      records: records
        .sort((a, b) => b.movedAt - a.movedAt)
        .slice(0, 200)
        .map((record) => ({
          id: record.id,
          relPath: record.relPath,
          originPath: record.originPath,
          movedAt: record.movedAt,
          restoredAt: record.restoredAt,
        })),
    };
  });

  register(IPC['miniapps:feedback-list'], async (_event, packId: any): Promise<{ packId: string; rootPath: string; relPath: string; verdict: string; source: string }[]> => {
    
    const rows = await stack.store().feedbackList(packId);
    return rows.map((row) => ({ packId: row.packId, rootPath: row.rootPath, relPath: row.relPath, verdict: row.verdict, source: row.source }));
  });

  register(IPC['miniapps:feedback-clear'], async (_event, packId: any, relPath: any): Promise<number> => {
    
    const path = typeof relPath === 'string' && relPath.length > 0 && relPath.length <= 2048 ? relPath : undefined;
    return stack.store().feedbackClear(packId, path);
  });

  register(IPC['miniapps:quarantine-status'], async (_event, packId: any): Promise<{ total: number; restorable: number }> => {
    const scoped = typeof packId === 'string' && packId.length > 0 && packId.length <= 200 ? packId : undefined;
    const all = scoped ? await stack.quarantineStore().byPack(scoped) : [];
    return {
      total: all.length,
      restorable: all.filter((record) => record.restoredAt === null).length,
    };
  });

  register(IPC['miniapps:empty-quarantine'], async (_event, packId: any): Promise<{ ok: true; removed: number } | { ok: false; error: string }> => {
    
    const removed = await stack.quarantineService.empty(packId);
    return { ok: true, removed };
  });

  register(IPC['miniapps:window-open'], async (_event, packId: any, runId: any): Promise<{ ok: true; opened: boolean } | { ok: false; error: string }> => {
    
    
    return stack.windows.openReportWindow(packId, runId);
  });

  register(IPC['miniapps:host-profile'], async (): Promise<Record<string, unknown>> => {
    const { desktopHostProfileView } = await import('@shared/app-pack/mapping');
    const { desktopT2Isolation } = await import('./isolation');
    return desktopHostProfileView(desktopT2Isolation());
  });

  register(IPC['miniapps:sources-list'], async (): Promise<MiniAppSourcesState> => stack.sources.listState());

  register(IPC['miniapps:source-add'], async (_event, descriptor: any, secretValues: any): Promise<AddSourceResult> => {
    if (typeof descriptor === 'string') {
      if (descriptor.length === 0 || descriptor.length > 8192) {
        return { ok: false, error: 'Invalid source descriptor.' };
      }
      try {
        descriptor = JSON.parse(descriptor);
      } catch {
        return { ok: false, error: 'The source descriptor is not valid JSON.' };
      }
    }
    
    
    const secrets: Record<string, string> = {};
    if (secretValues && typeof secretValues === 'object') {
      for (const [slot, value] of Object.entries(secretValues as Record<string, string>)) {
        
        secrets[slot] = value;
      }
    }
    return stack.sources.addSource(descriptor, Object.keys(secrets).length > 0 ? secrets : undefined);
  });

  register(IPC['miniapps:source-remove'], async (_event, sourceId: any): Promise<{ ok: true } | { ok: false; error: string }> => {
    
    return stack.sources.removeSource(sourceId);
  });

  register(IPC['miniapps:source-sync'], async (_event, sourceId: any): Promise<SourceSyncResult> => {
    
    return stack.sources.syncSource(sourceId);
  });

  register(IPC['miniapps:source-install'], async (_event, sourceId: any, extensionId: any, consent: any): Promise<InstallExtensionResult> => {
    
    
    if (!isConsentEcho(consent)) {
      return { ok: false, error: 'Consent must echo the displayed digest and capabilities — a renderer-asserted boolean is not consent (D7).' };
    }
    return stack.sources.installExtension(sourceId, extensionId, consent);
  });

  register(IPC['miniapps:source-apply-update'], async (_event, sourceId: any, extensionId: any, consent: any): Promise<ApplyUpdateResult> => {
    
    
    if (consent !== null && !isConsentEcho(consent)) {
      return { ok: false, error: 'Consent must be null (the auto-apply window) or echo the displayed digest and capabilities (D7/D22).' };
    }
    return stack.sources.applyUpdate(sourceId, extensionId, consent);
  });

  register(IPC['miniapps:source-restore'], async (_event, extensionId: any): Promise<RestoreExtensionResult> => {
    
    return stack.sources.restoreExtension(extensionId);
  });

  register(IPC['miniapps:command-execute'],
    async (_event, packId: any, commandId: any, argv: any): Promise<{ ok: true; text: string } | { ok: false; error: string }> => {
      
      
      
      return stack.executePackCommand(packId, commandId, Array.isArray(argv) ? (argv as string[]) : []);
    }
  );
}

