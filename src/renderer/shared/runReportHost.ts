/**
 * Run-report host choice (plan 53 follow-up): packs that declare
 * `ui:window` open their report in the host-owned pack window; every
 * other pack keeps the in-app report (desktop modal / settings deep-link).
 * The registry view is read at click time so capability changes apply
 * without a restart of the renderer.
 */
export async function openRunReportWindow(packId: string, runId: string): Promise<boolean> {
  if (typeof window.electronAPI?.getMiniApps !== 'function') {
    return false;
  }
  try {
    const state = await window.electronAPI.getMiniApps();
    const view = state.packs.find((pack) => pack.id === packId);
    if (!view?.capabilities.includes('ui:window')) {
      return false;
    }
  } catch {
    return false;
  }
  const opened = await window.electronAPI.openMiniAppWindow(packId, runId).catch(() => ({ ok: false as const, error: 'unavailable' }));
  return opened.ok;
}
