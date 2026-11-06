import type { JSX, ReactElement } from 'react';
import { Languages, ShieldCheck, Tag, Wrench } from 'lucide-react';
import type { ModelPickerProvider } from '@neuronection/assistant-ui/model-picker';
import { DECISION_SLOTS, decisionSlotCapability } from '@shared/ai/decisions';
import { TEXT } from '@shared/constants/text';
import { DecisionKindRow } from './shared';

interface ApiDecisionGroupProps {
  assignments: Record<string, string | null>;
  catalog: ModelPickerProvider[];
  onAssign: (slot: string, modelId: string | null) => void;
  defaultsToLine: JSX.Element | null;
  renderMeta: (slot: string) => JSX.Element | null;
}

export function ApiDecisionGroup({
  assignments,
  catalog,
  onAssign,
  defaultsToLine,
  renderMeta,
}: ApiDecisionGroupProps): ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--as-muted-fg)]">
          {TEXT.API_DECISION_KINDS_GROUP_TITLE}
        </p>
        <p className="mt-0.5 text-xs text-[var(--as-muted-fg)]">{TEXT.DECISION_PRIVACY_NOTICE}</p>
      </div>
      {DECISION_SLOTS.map((slot) => {
        const capability = decisionSlotCapability(slot);
        const labels = {
          'tool-dispatch': { id: 'tool-dispatch', label: TEXT.API_TASK_DECISION_TOOL_DISPATCH, description: TEXT.API_TASK_DECISION_TOOL_DISPATCH_DESCRIPTION, icon: Wrench },
          'boolean-gate': { id: 'boolean-gate', label: TEXT.API_TASK_DECISION_BOOLEAN_GATE, description: TEXT.API_TASK_DECISION_BOOLEAN_GATE_DESCRIPTION, icon: ShieldCheck },
          choice: { id: 'choice', label: TEXT.API_TASK_DECISION_CHOICE, description: TEXT.API_TASK_DECISION_CHOICE_DESCRIPTION, icon: Languages },
          score: { id: 'score', label: TEXT.API_TASK_DECISION_SCORE, description: TEXT.API_TASK_DECISION_SCORE_DESCRIPTION, icon: Tag },
        } as const;
        const entry =
          (capability && capability !== 'open-args' ? labels[capability] : undefined) ??
          labels['tool-dispatch'];
        return (
          <DecisionKindRow
            key={slot}
            slot={slot}
            label={entry.label}
            description={entry.description}
            icon={entry.icon}
            catalog={catalog}
            modelValue={assignments?.[slot] ?? null}
            placeholder={TEXT.API_DECISION_INHERITED}
            clearLabel={TEXT.API_DEFAULT_MODEL_UNSET}
            onAssign={onAssign}
            meta={
              <>
                {defaultsToLine}
                {renderMeta(slot)}
              </>
            }
          />
        );
      })}
    </div>
  );
}
