import type { ReactElement } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import { Combobox } from '@neuronection/assistant-ui/combobox';
import type { EntityScopeRule, ToolAppView } from '@shared/apps';
import { TEXT } from '@shared/constants/text';
import type { ScopePreview } from './shared';

interface AppPermissionsSectionProps {
  view: ToolAppView;
  rules: EntityScopeRule[];
  onRulesChange: (update: (prev: EntityScopeRule[]) => EntityScopeRule[]) => void;
  preview: ScopePreview | null;
  onSave: (target: ToolAppView) => Promise<void>;
  onPreview: (appId: string) => Promise<void>;
}

export function AppPermissionsSection({
  view,
  rules,
  onRulesChange,
  preview,
  onSave,
  onPreview,
}: AppPermissionsSectionProps): ReactElement {
  return (
    <section aria-label={TEXT.APPS_SCOPE_TITLE} className="space-y-2">
      <p className="text-xs text-[var(--as-muted-foreground)]">{TEXT.APPS_SCOPE_HINT}</p>
      <ul className="space-y-1">
        {rules.map((rule, index) => (
          <li key={`${rule.pattern}-${index}`} className="flex items-center gap-2">
            <Combobox
              hideLabel
              label={TEXT.APPS_SCOPE_EFFECT_LABEL}
              className="w-28"
              value={rule.effect}
              onChange={(value) =>
                onRulesChange((prev) => prev.map((entry, i) => (i === index ? { ...entry, effect: value as 'allow' | 'deny' } : entry)))
              }
              options={[
                { value: 'allow', label: TEXT.APPS_SCOPE_ALLOW },
                { value: 'deny', label: TEXT.APPS_SCOPE_DENY },
              ]}
            />
            <input
              aria-label={TEXT.APPS_SCOPE_PATTERN_LABEL}
              value={rule.pattern}
              onChange={(event) =>
                onRulesChange((prev) => prev.map((entry, i) => (i === index ? { ...entry, pattern: event.target.value } : entry)))
              }
              className="flex-1 rounded border border-[var(--as-border)] bg-transparent px-2 py-0.5 text-xs"
            />
            <Button size="sm" variant="ghost" onClick={() => onRulesChange((prev) => prev.filter((_, i) => i !== index))}>
              {TEXT.APPS_REMOVE}
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => onRulesChange((prev) => [...prev, { effect: 'deny', pattern: 'lock.*' }])}>
          {TEXT.APPS_SCOPE_ADD}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void onSave(view)}>
          {TEXT.APPS_SCOPE_SAVE}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void onPreview(view.app.id)}>
          {TEXT.APPS_SCOPE_PREVIEW_ACTION}
        </Button>
      </div>
      {preview && (
        <ul className="space-y-0.5" aria-label={TEXT.APPS_SCOPE_PREVIEW}>
          {preview.entities.length === 0 ? (
            <li className="text-xs text-[var(--as-muted-foreground)]">{TEXT.APPS_SCOPE_PREVIEW_EMPTY}</li>
          ) : (
            preview.entities.map((entity) => (
              <li key={entity.id} className="flex items-center gap-2 text-xs">
                <span className={entity.allowed ? '' : 'text-[var(--as-danger)]'}>{entity.id}</span>
                <span className="text-[var(--as-muted-foreground)]">
                  {entity.allowed ? TEXT.APPS_SCOPE_PREVIEW_ALLOWED : TEXT.APPS_SCOPE_PREVIEW_BLOCKED}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </section>
  );
}
