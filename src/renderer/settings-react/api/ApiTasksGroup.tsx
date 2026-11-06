import type { JSX, ReactElement } from 'react';
import { TaskAssignmentPicker } from '@neuronection/assistant-ui/task-assignment-picker';
import { Languages, Send, Tag, Wrench } from 'lucide-react';
import type { ModelPickerProvider } from '@neuronection/assistant-ui/model-picker';
import { AiTask } from '@shared/types';
import { TEXT } from '@shared/constants/text';
import { DEFAULT_ROW_TASKS } from './shared';
import { ApiDecisionGroup } from './ApiDecisionGroup';

interface ApiTasksGroupProps {
  assignments: Record<string, string | null>;
  taskCatalog: ModelPickerProvider[];
  onAssign: (taskId: string, modelId: string | null) => void;
  renderDefaultMeta: (task: { id: string }) => JSX.Element | null;
  decisionCatalog: ModelPickerProvider[];
  defaultsToLine: JSX.Element | null;
  renderDecisionMeta: (slot: string) => JSX.Element | null;
}

export function ApiTasksGroup({
  assignments,
  taskCatalog,
  onAssign,
  renderDefaultMeta,
  decisionCatalog,
  defaultsToLine,
  renderDecisionMeta,
}: ApiTasksGroupProps): ReactElement {
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
          value={assignments}
          onAssign={onAssign}
          renderMeta={renderDefaultMeta}
          clearLabel={TEXT.API_DEFAULT_MODEL_UNSET}
        />
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
          value={assignments}
          onAssign={onAssign}
          clearLabel={TEXT.API_DEFAULT_MODEL_UNSET}
        />
      </section>
    </div>
  );
}
