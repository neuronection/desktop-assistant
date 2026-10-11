import { ipcMain, BrowserWindow } from 'electron';
import { PACK_LIMITS, type ImportMiniAppResult, type MiniAppSaveConfigResult, type MiniAppSetEnabledResult, type MiniAppsState, type MiniAppRunView, type MiniAppRunReportView, type MiniAppRunDiffView, type MiniAppExportFormat, type MiniAppLiveCardView, type MiniAppRunStats } from '@shared/app-pack';
import { joinWithinRoot, validateRunRoot, type PackFsEnv } from './capabilities/fs';
import { nodePackFsDeps } from './capabilities/node-fs';
import { exportRunReport } from './run/export';
import type { MiniAppStack } from './composition';

/** Every channel this module registers (the teardown list consumes this). */
export const MINIAPP_IPC_CHANNELS = [
  'miniapps:get-state', 'miniapps:import', 'miniapps:remove', 'miniapps:set-enabled', 'miniapps:save-config',
  'miniapps:pick-root', 'miniapps:run-start', 'miniapps:run-cancel', 'miniapps:run-resume', 'miniapps:runs-list',
  'miniapps:run-report', 'miniapps:run-export', 'miniapps:run-diff', 'miniapps:override-item', 'miniapps:exclude-item',
  'miniapps:live-card', 'miniapps:run-stats',
  'miniapps:reveal-item', 'miniapps:open-item', 'miniapps:arm-run', 'miniapps:resolve-proposal', 'miniapps:abort-proposal',
  'miniapps:restore-item', 'miniapps:restore-quarantine-record', 'miniapps:restore-batch', 'miniapps:restore-bundled',
  'miniapps:quarantine-list', 'miniapps:feedback-list', 'miniapps:feedback-clear', 'miniapps:quarantine-status',
  'miniapps:empty-quarantine',
] as const;

/**
 * The mini-app IPC surface (plan 26): every `miniapps:*` handler in one
 * registrar, consuming the stack built in `composition.ts`. Handler
 * bodies validate argument shapes main-side (the renderer is untrusted)
 * and never re-implement domain logic.
 */
export function registerMiniAppIpc(stack: MiniAppStack, fsEnv: Parameters<typeof validateRunRoot>[1]): void {
  const { registry, runService, proposalService } = stack;

  ipcMain.handle('miniapps:get-state', async (): Promise<MiniAppsState> => registry.getState());

  ipcMain.handle('miniapps:import', async (_event, json: unknown, path: unknown): Promise<ImportMiniAppResult> => {
    if (typeof json !== 'string' || json.length === 0 || json.length > PACK_LIMITS.manifestMaxBytes * 2) {
      return { ok: false, error: 'Invalid pack file.' };
    }
    const originPath = typeof path === 'string' && path.length > 0 && path.length <= 1024 ? path : undefined;
    return registry.importManifest(json, { kind: 'imported', ...(originPath ? { path: originPath } : {}) });
  });

  ipcMain.handle('miniapps:remove', async (_event, id: unknown): Promise<boolean> => {
    if (typeof id !== 'string' || id.length === 0 || id.length > 200) {
      return false;
    }
    return registry.remove(id);
  });

  ipcMain.handle('miniapps:set-enabled', async (_event, id: unknown, enabled: unknown): Promise<MiniAppSetEnabledResult> => {
    if (id !== null && (typeof id !== 'string' || id.length === 0 || id.length > 200)) {
      return { ok: false, error: 'Invalid pack id.' };
    }
    if (typeof enabled !== 'boolean') {
      return { ok: false, error: 'enabled must be a boolean.' };
    }
    return registry.setEnabled(id as string | null, enabled);
  });

  ipcMain.handle('miniapps:save-config', async (_event, id: unknown, values: unknown): Promise<MiniAppSaveConfigResult> => {
    if (typeof id !== 'string' || id.length === 0 || id.length > 200) {
      return { ok: false, error: 'Invalid pack id.' };
    }
    return registry.saveConfig(id, values);
  });

  ipcMain.handle('miniapps:pick-root', async (event): Promise<{ ok: true; root: string } | { ok: false; error: string }> => {
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

  ipcMain.handle('miniapps:run-start', async (_event, packId: unknown, rootPath: unknown, options: unknown): Promise<{ ok: true; runId: string } | { ok: false; error: string }> => {
    if (typeof packId !== 'string' || packId.length === 0 || packId.length > 200) {
      return { ok: false, error: 'Invalid pack id.' };
    }
    if (typeof rootPath !== 'string' || rootPath.length === 0 || rootPath.length > 2048) {
      return { ok: false, error: 'Invalid root path.' };
    }
    const maxModelCalls =
      typeof options === 'object' && options !== null && typeof (options as { maxModelCalls?: unknown }).maxModelCalls === 'number'
        ? (options as { maxModelCalls: number }).maxModelCalls
        : undefined;
    const started = await runService.start(packId, rootPath, maxModelCalls !== undefined ? { maxModelCalls } : {});
    if (!started.ok) {
      return { ok: false, error: stack.formatError(started.error) };
    }
    return { ok: true, runId: started.runId };
  });

  ipcMain.handle('miniapps:run-cancel', async (_event, runId: unknown): Promise<{ ok: true } | { ok: false; error: string }> => {
    if (typeof runId !== 'string' || runId.length === 0 || runId.length > 200) {
      return { ok: false, error: 'Invalid run id.' };
    }
    const result = await runService.cancel(runId);
    return result.ok ? { ok: true } : { ok: false, error: stack.formatError(result.error) };
  });

  ipcMain.handle('miniapps:run-resume', async (_event, runId: unknown): Promise<{ ok: true } | { ok: false; error: string }> => {
    if (typeof runId !== 'string' || runId.length === 0 || runId.length > 200) {
      return { ok: false, error: 'Invalid run id.' };
    }
    const result = await runService.resume(runId);
    return result.ok ? { ok: true } : { ok: false, error: stack.formatError(result.error) };
  });

  ipcMain.handle('miniapps:runs-list', async (_event, packId: unknown): Promise<MiniAppRunView[]> => {
    const scoped = typeof packId === 'string' && packId.length > 0 && packId.length <= 200 ? packId : undefined;
    const rows = await runService.recentRuns(scoped, 20);
    return rows.map(stack.runRowToView);
  });

  ipcMain.handle('miniapps:run-report', async (_event, runId: unknown): Promise<MiniAppRunReportView | null> => {
    if (typeof runId !== 'string' || runId.length === 0 || runId.length > 200) {
      return null;
    }
    return stack.buildReportView(runId);
  });

  ipcMain.handle('miniapps:live-card', async (_event, packId: unknown): Promise<MiniAppLiveCardView | null> => {
    if (typeof packId !== 'string' || packId.length === 0 || packId.length > 200) {
      return null;
    }
    return stack.buildLiveCardView(packId);
  });

  ipcMain.handle('miniapps:run-stats', async (_event, windowDays: unknown): Promise<MiniAppRunStats> => {
    const days = windowDays === 7 || windowDays === 30 ? windowDays : null;
    return stack.buildRunStats(days);
  });

  ipcMain.handle('miniapps:run-export', async (_event, runId: unknown, format: unknown): Promise<{ ok: true; text: string; fileName: string } | { ok: false; error: string }> => {
    if (typeof runId !== 'string' || runId.length === 0 || runId.length > 200) {
      return { ok: false, error: 'Invalid run id.' };
    }
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

  ipcMain.handle('miniapps:run-diff', async (_event, runId: unknown): Promise<MiniAppRunDiffView | null> => {
    if (typeof runId !== 'string' || runId.length === 0 || runId.length > 200) {
      return null;
    }
    return stack.diffFor(runId);
  });

  ipcMain.handle('miniapps:override-item', async (_event, runId: unknown, relPath: unknown, verdict: unknown): Promise<{ ok: true } | { ok: false; error: string }> => {
    if (typeof runId !== 'string' || runId.length === 0 || runId.length > 200) {
      return { ok: false, error: 'Invalid run id.' };
    }
    if (typeof relPath !== 'string' || relPath.length === 0 || relPath.length > 2048) {
      return { ok: false, error: 'Invalid path.' };
    }
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

  ipcMain.handle('miniapps:exclude-item', async (_event, runId: unknown, relPath: unknown): Promise<{ ok: true } | { ok: false; error: string }> => {
    if (typeof runId !== 'string' || runId.length === 0 || runId.length > 200) {
      return { ok: false, error: 'Invalid run id.' };
    }
    if (typeof relPath !== 'string' || relPath.length === 0 || relPath.length > 2048) {
      return { ok: false, error: 'Invalid path.' };
    }
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

  ipcMain.handle('miniapps:reveal-item', async (_event, runId: unknown, relPath: unknown): Promise<{ ok: true } | { ok: false; error: string }> => {
    if (typeof runId !== 'string' || typeof relPath !== 'string' || relPath.length === 0 || relPath.length > 2048) {
      return { ok: false, error: 'Invalid arguments.' };
    }
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

  ipcMain.handle('miniapps:open-item', async (_event, runId: unknown, relPath: unknown): Promise<{ ok: true } | { ok: false; error: string }> => {
    if (typeof runId !== 'string' || typeof relPath !== 'string' || relPath.length === 0 || relPath.length > 2048) {
      return { ok: false, error: 'Invalid arguments.' };
    }
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

  ipcMain.handle('miniapps:arm-run', async (_event, runId: unknown): Promise<{ ok: true; proposal: unknown } | { ok: false; error: string }> => {
    if (typeof runId !== 'string' || runId.length === 0 || runId.length > 200) {
      return { ok: false, error: 'Invalid run id.' };
    }
    const run = await runService.getRun(runId);
    if (!run) {
      return { ok: false, error: 'Unknown run.' };
    }
    if (run.disallowArm) {
      return {
        ok: false,
        error: stack.formatError({ code: 'invalid', detail: { reason: 'scheduled runs are report-only — arming is structurally unavailable to them' } }),
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

  ipcMain.handle('miniapps:resolve-proposal', async (_event, proposalId: unknown, approve: unknown): Promise<{ ok: true; outcome: unknown } | { ok: false; error: string }> => {
    if (typeof proposalId !== 'string' || proposalId.length === 0 || proposalId.length > 200) {
      return { ok: false, error: 'Invalid proposal id.' };
    }
    if (typeof approve !== 'boolean') {
      return { ok: false, error: 'approve must be a boolean.' };
    }
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

  ipcMain.handle('miniapps:abort-proposal', (_event, proposalId: unknown): boolean => {
    if (typeof proposalId !== 'string' || proposalId.length === 0 || proposalId.length > 200) {
      return false;
    }
    proposalService.abort(proposalId);
    return true;
  });

  ipcMain.handle('miniapps:restore-item', async (_event, runId: unknown, relPath: unknown): Promise<{ ok: true; restoredPath: string } | { ok: false; error: string }> => {
    if (typeof runId !== 'string' || typeof relPath !== 'string' || relPath.length === 0 || relPath.length > 2048) {
      return { ok: false, error: 'Invalid arguments.' };
    }
    const result = await proposalService.restoreItem(runId, relPath);
    return result.ok ? { ok: true, restoredPath: result.restoredPath } : { ok: false, error: stack.formatError(result.error) };
  });

  ipcMain.handle('miniapps:restore-quarantine-record', async (_event, recordId: unknown): Promise<{ ok: true; restoredPath: string } | { ok: false; error: string }> => {
    if (typeof recordId !== 'string' || recordId.length === 0 || recordId.length > 200) {
      return { ok: false, error: 'Invalid record id.' };
    }
    return stack.restoreQuarantineRecord(recordId);
  });

  ipcMain.handle('miniapps:restore-batch', async (_event, proposalId: unknown): Promise<{ ok: true; restored: number } | { ok: false; error: string }> => {
    if (typeof proposalId !== 'string' || proposalId.length === 0 || proposalId.length > 200) {
      return { ok: false, error: 'Invalid proposal id.' };
    }
    const result = await proposalService.restoreBatch(proposalId);
    return result.ok ? { ok: true, restored: result.restored } : { ok: false, error: stack.formatError(result.error) };
  });

  ipcMain.handle('miniapps:restore-bundled', async (): Promise<{ ok: true; installed: string[] } | { ok: false; error: string }> => {
    try {
      const installed = await stack.installBundled(true);
      return { ok: true, installed };
    } catch (error) {
      return { ok: false, error: String((error as Error)?.message ?? error) };
    }
  });

  ipcMain.handle('miniapps:quarantine-list', async (_event, packId: unknown): Promise<{ packId: string; records: { id: string; relPath: string; originPath: string; movedAt: number; restoredAt: number | null }[] } | null> => {
    if (typeof packId !== 'string' || packId.length === 0 || packId.length > 200) {
      return null;
    }
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

  ipcMain.handle('miniapps:feedback-list', async (_event, packId: unknown): Promise<{ packId: string; rootPath: string; relPath: string; verdict: string; source: string }[]> => {
    if (typeof packId !== 'string' || packId.length === 0 || packId.length > 200) {
      return [];
    }
    const rows = await stack.store().feedbackList(packId);
    return rows.map((row) => ({ packId: row.packId, rootPath: row.rootPath, relPath: row.relPath, verdict: row.verdict, source: row.source }));
  });

  ipcMain.handle('miniapps:feedback-clear', async (_event, packId: unknown, relPath: unknown): Promise<number> => {
    if (typeof packId !== 'string' || packId.length === 0 || packId.length > 200) {
      return 0;
    }
    const path = typeof relPath === 'string' && relPath.length > 0 && relPath.length <= 2048 ? relPath : undefined;
    return stack.store().feedbackClear(packId, path);
  });

  ipcMain.handle('miniapps:quarantine-status', async (_event, packId: unknown): Promise<{ total: number; restorable: number }> => {
    const scoped = typeof packId === 'string' && packId.length > 0 && packId.length <= 200 ? packId : undefined;
    const all = scoped ? await stack.quarantineStore().byPack(scoped) : [];
    return {
      total: all.length,
      restorable: all.filter((record) => record.restoredAt === null).length,
    };
  });

  ipcMain.handle('miniapps:empty-quarantine', async (_event, packId: unknown): Promise<{ ok: true; removed: number } | { ok: false; error: string }> => {
    if (typeof packId !== 'string' || packId.length === 0 || packId.length > 200) {
      return { ok: false, error: 'Invalid pack id.' };
    }
    const removed = await stack.quarantineService.empty(packId);
    return { ok: true, removed };
  });
}

