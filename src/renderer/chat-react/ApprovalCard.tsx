import { useEffect, useMemo, useState, type JSX } from 'react';
import { Badge } from '@neuronection/assistant-ui/badge';
import { Button } from '@neuronection/assistant-ui/button';
import { Check, Pencil, ShieldAlert, X } from 'lucide-react';
import type { ApprovalDecision, ApprovalRequest, ApprovalResolution, ToolGrantScope } from '@shared/turns';
import { TEXT, interpolate } from '@shared/constants/text';

export interface ApprovalCardProps {
  requests: ApprovalRequest[];
  deadline: number;
  variant?: 'compact' | 'rich';
  onResolve: (resolution: ApprovalResolution) => void;
  className?: string;
}

function useCountdown(deadline: number): number {
  const [remaining, setRemaining] = useState(() => Math.max(0, deadline - Date.now()));
  useEffect(() => {
    setRemaining(Math.max(0, deadline - Date.now()));
    const timer = setInterval(() => {
      setRemaining(Math.max(0, deadline - Date.now()));
    }, 1000);
    return () => clearInterval(timer);
  }, [deadline]);
  return remaining;
}

const RISK_LABEL: Record<string, string> = {
  'state-changing': TEXT.APPROVAL_RISK_STATE_CHANGING,
  destructive: TEXT.APPROVAL_RISK_DESTRUCTIVE,
};

interface ArgsEditorState {
  open: boolean;
  text: string;
  valid: boolean;
}

export function ApprovalCard(props: ApprovalCardProps): JSX.Element {
  const { requests, deadline, variant = 'compact', onResolve, className = '' } = props;
  const remaining = useCountdown(deadline);
  const expired = remaining <= 0;
  const [editors, setEditors] = useState<Record<string, ArgsEditorState>>({});

  const primary = requests[0];
  const extraCount = Math.max(0, requests.length - 1);
  const confirmEveryTime = requests.some((request) => request.risk === 'destructive');

  useEffect(() => {
    setEditors((prev) => {
      const next: Record<string, ArgsEditorState> = {};
      for (const request of requests) {
        next[request.id] = prev[request.id] ?? { open: false, text: JSON.stringify(request.args, null, 2), valid: true };
      }
      return next;
    });
  }, [requests]);

  const updateEditor = (id: string, patch: Partial<ArgsEditorState>): void => {
    setEditors((prev) => {
      const current = prev[id];
      if (!current) {
        return prev;
      }
      const merged = { ...current, ...patch };
      if (patch.text !== undefined) {
        try {
          JSON.parse(patch.text);
          merged.valid = true;
        } catch {
          merged.valid = false;
        }
      }
      return { ...prev, [id]: merged };
    });
  };

  const buildDecisions = (approve: boolean): ApprovalDecision[] =>
    requests.map((request) => {
      if (!approve) {
        return { type: 'reject', message: TEXT.APPROVAL_DENIED_MESSAGE };
      }
      const editor = editors[request.id];
      if (request.allowedDecisions.includes('edit') && editor?.open && editor.valid) {
        return { type: 'edit', name: request.toolName, args: JSON.parse(editor.text) };
      }
      return { type: 'approve' };
    });

  const resolve = (approve: boolean, grant?: ToolGrantScope): void => {
    if (expired) {
      return;
    }
    onResolve({ decisions: buildDecisions(approve), grant });
  };

  const actions = useMemo(
    () => (
      <>
        <Button
          variant="ghost"
          size={variant === 'compact' ? 'sm' : 'sm'}
          className={variant === 'compact' ? 'h-7 px-2 text-xs' : ''}
          disabled={expired}
          onClick={() => resolve(false)}
        >
          <X className="mr-1 h-3.5 w-3.5" aria-hidden />
          {TEXT.APPROVAL_DENY}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={variant === 'compact' ? 'h-7 px-2 text-xs' : ''}
          disabled={expired}
          onClick={() => resolve(true)}
        >
          {TEXT.APPROVAL_ALLOW_ONCE}
        </Button>
        {!confirmEveryTime && (
          <>
            <Button
              variant="outline"
              size="sm"
              className={variant === 'compact' ? 'h-7 px-2 text-xs' : ''}
              disabled={expired}
              onClick={() => resolve(true, 'session')}
            >
              {TEXT.APPROVAL_THIS_SESSION}
            </Button>
            <Button
              size="sm"
              className={variant === 'compact' ? 'h-7 px-2 text-xs' : ''}
              disabled={expired}
              onClick={() => resolve(true, 'always')}
            >
              {TEXT.APPROVAL_ALWAYS}
            </Button>
          </>
        )}
      </>
    ),
    [confirmEveryTime, editors, expired, requests]
  );

  if (variant === 'compact') {
    return (
      <div
        data-no-drag
        role="group"
        aria-label={TEXT.APPROVAL_GROUP_LABEL}
        className={`da-rise flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs ${className}`}
      >
        <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">{primary.toolName}</span>
          {primary.summary ? <span className="opacity-70"> — {primary.summary}</span> : null}
          {extraCount > 0 && <span className="opacity-60"> {interpolate(TEXT.APPROVAL_MORE_COUNT, { count: extraCount })}</span>}
        </span>
        <span className="shrink-0 tabular-nums opacity-60" title={TEXT.APPROVAL_AUTO_DENY_HINT}>
          {Math.ceil(remaining / 1000)}s
        </span>
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      </div>
    );
  }

  return (
    <div
      data-no-drag
      role="group"
      aria-label={TEXT.APPROVAL_GROUP_LABEL}
      className={`da-rise rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm ${className}`}
    >
      <div className="mb-2 flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-amber-500" aria-hidden />
        <span className="font-medium">{TEXT.APPROVAL_TITLE}</span>
        <Badge variant="outline" className="text-[10px] font-normal uppercase tracking-wide">
          {primary.risk === 'read-only' ? TEXT.APPROVAL_READ_BADGE : RISK_LABEL[primary.risk] ?? primary.risk}
        </Badge>
        {confirmEveryTime && (
          <span className="text-xs opacity-60" title={TEXT.APPROVAL_DESTRUCTIVE_HINT}>
            {TEXT.APPROVAL_CONFIRM_EVERY_TIME}
          </span>
        )}
        <span className="ml-auto text-xs tabular-nums opacity-60" title={TEXT.APPROVAL_AUTO_DENY_HINT}>
          {interpolate(TEXT.APPROVAL_AUTO_DENY_IN, { seconds: Math.ceil(remaining / 1000) })}
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {requests.map((request) => {
          const editor = editors[request.id];
          const canEdit = request.allowedDecisions.includes('edit');
          return (
            <li key={request.id} className="rounded-lg border border-[var(--as-border)] bg-[var(--as-surface)]/60 p-2">
              <div className="flex items-baseline gap-2">
                <span className="font-medium">{request.toolName}</span>
                {request.summary && <span className="min-w-0 truncate text-xs opacity-70">{request.summary}</span>}
                {canEdit && (
                  <button
                    type="button"
                    className={`ml-auto flex items-center gap-1 text-xs ${editor?.open ? 'text-[var(--as-primary)]' : 'opacity-60 hover:opacity-100'}`}
                    aria-expanded={editor?.open}
                    onClick={() => updateEditor(request.id, { open: !editor?.open })}
                  >
                    <Pencil className="h-3 w-3" aria-hidden />
                    {TEXT.APPROVAL_EDIT_ARGS}
                  </button>
                )}
              </div>
              {editor?.open ? (
                <div className="mt-1.5">
                  <textarea
                    aria-label={interpolate(TEXT.APPROVAL_ARGS_LABEL, { toolName: request.toolName })}
                    className={`h-28 w-full resize-y rounded-md border bg-transparent p-2 font-mono text-xs outline-none ${
                      editor.valid ? 'border-[var(--as-border)]' : 'border-red-500/60'
                    }`}
                    value={editor.text}
                    onChange={(e) => updateEditor(request.id, { text: e.target.value })}
                  />
                  {!editor.valid && <p className="mt-0.5 text-xs text-red-500">{TEXT.APPROVAL_INVALID_JSON}</p>}
                  {editor.valid && editor.open && (
                    <p className="mt-0.5 flex items-center gap-1 text-xs opacity-60">
                      <Check className="h-3 w-3" aria-hidden />
                      {TEXT.APPROVAL_EDIT_NOTICE}
                    </p>
                  )}
                </div>
              ) : (
                typeof request.args === 'object' && request.args !== null && (
                  <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-md bg-[var(--as-muted)] p-2 font-mono text-xs opacity-80">
                    {JSON.stringify(request.args, null, 2)}
                  </pre>
                )
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5">{actions}</div>
    </div>
  );
}
