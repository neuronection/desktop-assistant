import { useState, type JSX } from 'react';
import { Badge } from '@neuronection/assistant-ui/badge';
import { Button } from '@neuronection/assistant-ui/button';
import { ModelPicker, type ModelPickerProvider } from '@neuronection/assistant-ui/model-picker';
import { ChatToolsCatalog, type ChatToolCatalogEntry } from '@neuronection/assistant-ui/chat-tools-catalog';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FileText,
  Image as ImageIcon,
  Wrench,
} from 'lucide-react';
import type { ChatMessageView } from '@neuronection/assistant-ui/chat-core';
import type { LiveTurnState } from '@neuronection/assistant-ui/chat-core';
import type { TurnMetadata, TurnPhase, TurnTraceStep } from '@shared/turns';
import { formatDuration, phaseLabel } from './launcherState';
import { TEXT, interpolate } from '@shared/constants/text';

export interface InspectorProps {
  live: LiveTurnState | null;
  liveTrace: { phase: TurnPhase | null; startedAt: number | null; steps: TurnTraceStep[] };
  lastAssistant: ChatMessageView | null;
  lastUserAttachments: { name: string; isImage: boolean }[];
  activeModel: string | null;
  modelProviders: ModelPickerProvider[];
  onModelChange: (modelId: string | null) => void;
  onExport: (format: 'md' | 'json') => void;
  catalog?: ChatToolCatalogEntry[];
}

const PHASE_GLYPH: Record<string, string> = {
  thinking: '…',
  tool_call: '⚙',
  tool_result: '✓',
};

function StepRow({ step }: { step: TurnTraceStep }): JSX.Element {
  const [open, setOpen] = useState(false);
  const hasDetail = step.detail !== undefined && step.detail !== null;
  return (
    <li className="rounded-md border border-[var(--as-border)] bg-[var(--as-surface)]/50">
      <button
        type="button"
        className={`flex w-full items-center gap-2 px-2 py-1 text-left text-xs ${hasDetail ? 'hover:bg-[var(--as-muted)]' : 'cursor-default'}`}
        onClick={() => hasDetail && setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        <span className="w-4 shrink-0 text-center opacity-70" aria-hidden>
          {step.endedAt !== undefined ? PHASE_GLYPH[step.phase] ?? '·' : '…'}
        </span>
        <span className="min-w-0 flex-1 truncate">{step.label}</span>
        <span className="shrink-0 tabular-nums opacity-70">
          {step.endedAt !== undefined ? formatDuration(step.endedAt - step.startedAt) : ''}
        </span>
      </button>
      {open && hasDetail && (
        <div className="border-t border-[var(--as-border)] px-2 py-1">
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-[10px] leading-snug opacity-80">
            {typeof step.detail === 'string' ? step.detail : JSON.stringify(step.detail, null, 2)}
          </pre>
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 h-6 px-1 text-[10px]"
            title={TEXT.INSPECTOR_COPY_STEP}
            onClick={() => void navigator.clipboard.writeText(typeof step.detail === 'string' ? step.detail : JSON.stringify(step.detail, null, 2))}
          >
            <Copy className="mr-1 h-3 w-3" aria-hidden /> {TEXT.COPY_BUTTON}
          </Button>
        </div>
      )}
    </li>
  );
}

export function Inspector(props: InspectorProps): JSX.Element {
  const [toolsOpen, setToolsOpen] = useState(false);
  const liveTurn = props.live && (props.live.status === 'pending' || props.live.status === 'streaming');
  const steps = liveTurn ? props.liveTrace.steps : props.lastAssistant?.meta ? ((props.lastAssistant.meta as unknown as TurnMetadata).steps ?? []) : [];
  const model = liveTurn ? null : props.lastAssistant?.meta ? ((props.lastAssistant.meta as unknown as TurnMetadata).model ?? null) : null;
  const durationMs = liveTurn ? null : props.lastAssistant?.meta ? ((props.lastAssistant.meta as unknown as TurnMetadata).durationMs ?? null) : null;
  const outcome = liveTurn ? 'running' : props.lastAssistant?.meta ? ((props.lastAssistant.meta as unknown as TurnMetadata).outcome ?? null) : null;

  return (
    <div data-no-drag className="flex h-full flex-col gap-4 overflow-y-auto border-l border-[var(--as-border)] p-3 text-sm">
      <section className="space-y-1">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider opacity-50">{TEXT.INSPECTOR_TURN}</h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="text-[10px] font-normal">
            {liveTurn ? phaseLabel(props.liveTrace.phase, props.liveTrace.steps) : outcome ?? TEXT.INSPECTOR_OUTCOME_IDLE}
          </Badge>
          {model && <Badge variant="secondary" className="text-[10px] font-normal">{model}</Badge>}
          {durationMs !== null && <Badge variant="secondary" className="text-[10px] font-normal">{formatDuration(durationMs)}</Badge>}
        </div>
        {props.activeModel && (
          <p className="text-[10px] opacity-50">{interpolate(TEXT.INSPECTOR_NEXT_TURN, { model: props.activeModel })}</p>
        )}
      </section>

      <section className="space-y-1">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider opacity-50">{TEXT.INSPECTOR_TRACE}</h3>
        {steps.length === 0 ? (
          <p className="text-xs opacity-40">{TEXT.INSPECTOR_NO_STEPS}</p>
        ) : (
          <ol className="space-y-1">
            {steps.map((step) => (
              <StepRow key={step.id} step={step} />
            ))}
          </ol>
        )}
      </section>

      <section className="space-y-1">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider opacity-50">{TEXT.INSPECTOR_ATTACHMENTS}</h3>
        {props.lastUserAttachments.length === 0 ? (
          <p className="text-xs opacity-40">{TEXT.INSPECTOR_NO_ATTACHMENTS}</p>
        ) : (
          <ul className="space-y-1">
            {props.lastUserAttachments.map((att, index) => (
              <li key={index} className="flex items-center gap-1.5 text-xs">
                {att.isImage ? <ImageIcon className="h-3 w-3 opacity-60" aria-hidden /> : <FileText className="h-3 w-3 opacity-60" aria-hidden />}
                <span className="truncate">{att.name}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-1">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider opacity-50">{TEXT.INSPECTOR_MODEL}</h3>
        <ModelPicker
          providers={props.modelProviders}
          value={props.activeModel ?? undefined}
          onChange={(modelId) => props.onModelChange(modelId)}
          clearable={true}
          clearLabel={TEXT.INSPECTOR_CLEAR_MODEL_LABEL}
          label={TEXT.INSPECTOR_MODEL_LABEL}
          hideLabel={true}
          placeholder={TEXT.INSPECTOR_CLEAR_MODEL_LABEL}
          className="h-8 w-full text-xs"
        />
        <p className="text-[10px] opacity-50">{TEXT.INSPECTOR_MODEL_HINT}</p>
      </section>

      <section className="space-y-1">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider opacity-50">{TEXT.INSPECTOR_EXPORT}</h3>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" onClick={() => props.onExport('md')}>
            <Download className="mr-1 h-3.5 w-3.5" aria-hidden /> {TEXT.EXPORT_FORMAT_MARKDOWN}
          </Button>
          <Button variant="outline" size="sm" onClick={() => props.onExport('json')}>
            <Download className="mr-1 h-3.5 w-3.5" aria-hidden /> {TEXT.EXPORT_FORMAT_JSON}
          </Button>
        </div>
      </section>

      {props.catalog && props.catalog.length > 0 && (
        <section className="space-y-1">
          <button
            type="button"
            className="flex w-full items-center gap-1 text-left text-[10px] font-semibold uppercase tracking-wider opacity-50 hover:opacity-80"
            aria-expanded={toolsOpen}
            onClick={() => setToolsOpen((open) => !open)}
          >
            {toolsOpen ? <ChevronDown className="h-3 w-3" aria-hidden /> : <ChevronRight className="h-3 w-3" aria-hidden />}
            <Wrench className="h-3 w-3" aria-hidden />
            {TEXT.INSPECTOR_TOOLS}
          </button>
          {toolsOpen && (
            <div className="-mx-1">
              <ChatToolsCatalog tools={props.catalog} searchable={true} className="text-xs" />
            </div>
          )}
        </section>
      )}
    </div>
  );
}
