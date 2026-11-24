import type { JSX, ReactElement } from 'react';
import { TaskAssignmentPicker } from '@neuronection/assistant-ui/task-assignment-picker';
import { ChevronDown, Languages, Send, Tag, Wrench } from 'lucide-react';
import type { ModelPickerProvider } from '@neuronection/assistant-ui/model-picker';
import { AiTask } from '@shared/types';
import { TEXT } from '@shared/constants/text';
import { DEFAULT_ROW_TASKS } from './shared';
import { ApiDecisionGroup } from './ApiDecisionGroup';

interface ApiTasksGroupProps {
  assignments: Record<string, string | null>;
  modelAssignments: Record<string, string | null>;
  taskCatalog: ModelPickerProvider[];
  onAssign: (taskId: string, modelId: string | null) => void;
  renderDefaultMeta: (task: { id: string }) => JSX.Element | null;
  renderOtherMeta: (task: { id: string }) => JSX.Element | null;
  decisionCatalog: ModelPickerProvider[];
  defaultsToLine: JSX.Element | null;
  renderDecisionMeta: (slot: string) => JSX.Element | null;
}

const DEFAULT_TASK_IDS = new Set(DEFAULT_ROW_TASKS.map((task) => task.id));

export function ApiTasksGroup({
  assignments,
  modelAssignments,
  taskCatalog,
  onAssign,
  renderDefaultMeta,
  renderOtherMeta,
  decisionCatalog,
  defaultsToLine,
  renderDecisionMeta,
}: ApiTasksGroupProps): ReactElement {
  // ADR-0070: everything that overrides a capability default — decision
  // kinds and specialist tasks — is an advanced, collapsed disclosure.
  const overrideCount = Object.entries(assignments).filter(
    ([taskId, modelId]) => Boolean(modelId) && !DEFAULT_TASK_IDS.has(taskId),
  ).length;

  return (
    <div role="tabpanel" aria-label={TEXT.API_TASKS_TITLE} className="space-y-8">
      <section className="space-y-3">
        <div className="space-y-1">
          <h3 className="text-base font-semibold">{TEXT.API_TASKS_TITLE}</h3>
          <p className="text-sm opacity-60">{TEXT.API_TASKS_SUBTITLE}</p>
        </div>
        <TaskAssignmentPicker
          sections={[{ id: 'defaults', label: TEXT.API_TASKS_DEFAULTS_SECTION, tasks: DEFAULT_ROW_TASKS }]}
          providers={taskCatalog}
          value={modelAssignments}
          onAssign={onAssign}
          renderMeta={renderDefaultMeta}
          clearLabel={TEXT.API_DEFAULT_MODEL_UNSET}
        />
        <details
          className="group rounded-md border border-[var(--as-border)]"
          data-testid="task-overrides-advanced"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2">
            <span className="text-sm font-semibold">
              {TEXT.API_TASKS_ADVANCED_TITLE}
            </span>
            <span className="flex items-center gap-2 text-xs opacity-60">
              {TEXT.API_TASKS_ADVANCED_COUNT.replace(
                '{count}',
                String(overrideCount),
              )}
              <ChevronDown
                className="size-4 transition-transform group-open:rotate-180"
                aria-hidden
              />
            </span>
          </summary>
          <div className="space-y-4 border-t border-[var(--as-border)] p-3">
            <p className="text-xs opacity-60">{TEXT.API_TASKS_ADVANCED_HINT}</p>
            <ApiDecisionGroup
              assignments={assignments}
              catalog={decisionCatalog}
              onAssign={onAssign}
              defaultsToLine={defaultsToLine}
              renderMeta={renderDecisionMeta}
            />
            <TaskAssignmentPicker
              sections={[
                {
                  id: 'other',
                  label: TEXT.API_TASKS_OTHER_SECTION,
                  tasks: [
                    { id: AiTask.TITLES, label: TEXT.API_TASK_TITLES, description: TEXT.API_TASK_TITLES_DESCRIPTION, requires: 'text', icon: Tag },
                    { id: AiTask.TRANSLATE, label: TEXT.API_TASK_TRANSLATE, description: TEXT.API_TASK_TRANSLATE_DESCRIPTION, requires: 'text', icon: Languages },
                    { id: AiTask.PLUMBING, label: TEXT.API_TASK_PLUMBING, description: TEXT.API_TASK_PLUMBING_DESCRIPTION, requires: 'text', icon: Wrench },
                    { id: AiTask.VOICE_ENDPOINT, label: TEXT.API_TASK_VOICE_ENDPOINT, description: TEXT.API_TASK_VOICE_ENDPOINT_DESCRIPTION, requires: 'text', icon: Send },
                  ],
                },
              ]}
              providers={taskCatalog}
              value={modelAssignments}
              onAssign={onAssign}
              renderMeta={renderOtherMeta}
              clearLabel={TEXT.API_DEFAULT_MODEL_UNSET}
            />
          </div>
        </details>
      </section>
    </div>
  );
}
