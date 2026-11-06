import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import type { JSX } from 'react';
import { TEXT } from '@shared/constants/text';
import { reportRendererError } from './installErrorReporting';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/** Per-window root crash boundary (plan 46 S1): a renderer exception can
 * no longer blank a window — the failure card is TEXT-keyed, offers the
 * reload action, and reports through the main-side logger. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportRendererError({
      message: error.message || String(error),
      stack: [error.stack ?? '', info.componentStack ?? ''].join('\n').slice(0, 8000),
      source: 'boundary',
    });
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): JSX.Element {
    const { error } = this.state;
    if (!error) {
      return this.props.children as JSX.Element;
    }
    return (
      <div role="alert" className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm font-semibold">{TEXT.ERROR_BOUNDARY_TITLE}</p>
        <p className="max-w-md text-xs text-[var(--as-muted-foreground)]">{TEXT.ERROR_BOUNDARY_BODY}</p>
        {error.message && (
          <p className="max-w-md overflow-hidden text-ellipsis font-mono text-[10px] opacity-50">{error.message}</p>
        )}
        <button
          type="button"
          onClick={this.handleReload}
          className="rounded-md border border-[var(--as-border)] px-3 py-1.5 text-xs transition-colors hover:bg-[var(--as-muted)]"
        >
          {TEXT.ERROR_BOUNDARY_RELOAD}
        </button>
      </div>
    );
  }
}
