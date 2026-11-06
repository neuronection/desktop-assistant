export type RendererErrorSource = 'error' | 'unhandledrejection' | 'boundary';

export interface RendererErrorPayload {
  message: string;
  stack?: string;
  source: RendererErrorSource;
}

/** Renderer → main crash report (plan 46 S1): one validated IPC seam, the
 * main side logs through its own logger. Safe to call before the bridge
 * exists (tests, early dev loads) — the optional chain no-ops. */
export function reportRendererError(payload: RendererErrorPayload): void {
  void window.electronAPI?.reportRendererError?.(payload);
}

/** Installs the global renderer error hooks once per window root:
 * uncaught exceptions and unhandled promise rejections are forwarded to
 * the main-side logger instead of vanishing in a blank window. Idempotent
 * — one stable subscription per window, re-invocation never re-registers.
 * Returns a disposer (teardown for tests/harnesses); production call
 * sites ignore it. */
export function installErrorReporting(): () => void {
  const marker = window as unknown as Record<string, unknown>;
  if (marker.__daErrorReportingInstalled === true) {
    return () => undefined;
  }
  marker.__daErrorReportingInstalled = true;
  const onError = (event: Event): void => {
    const errorEvent = event as ErrorEvent;
    const error = errorEvent.error;
    reportRendererError({
      message: String(error?.message ?? errorEvent.message ?? 'Unknown error').slice(0, 2000),
      stack: typeof error?.stack === 'string' ? error.stack.slice(0, 8000) : undefined,
      source: 'error',
    });
  };
  const onRejection = (event: Event): void => {
    const reason = (event as PromiseRejectionEvent).reason;
    reportRendererError({
      message: String(reason?.message ?? reason ?? 'Unhandled rejection').slice(0, 2000),
      stack: typeof reason?.stack === 'string' ? reason.stack.slice(0, 8000) : undefined,
      source: 'unhandledrejection',
    });
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    delete marker.__daErrorReportingInstalled;
  };
}
