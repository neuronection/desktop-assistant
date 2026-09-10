import { useState, type JSX } from 'react';
import { Badge } from '@neuronection/assistant-ui/badge';
import { Button } from '@neuronection/assistant-ui/button';
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalDescription } from '@neuronection/assistant-ui/modal';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import type { ToolParameterInfo, ToolRiskClass, ToolVerificationSettings } from '@shared/turns';
import { TEXT, interpolate } from '@shared/constants/text';
import { Switch } from './shared';
import { VerificationEditor } from './VerificationEditor';

export interface DetailTool {
  name: string;
  description: string;
  risk: ToolRiskClass;
  editableArgs: boolean;
  enabled: boolean;
  granted: boolean;
  parameters: ToolParameterInfo[];
  verification: ToolVerificationSettings;
  source: 'native' | 'mcp';
}

export interface ToolDetailsModalProps {
  tool: DetailTool;
  onClose: () => void;
  onToggleEnabled: (enabled: boolean) => Promise<void>;
  /** Native tools only — MCP grant management lives on the approval card. */
  onToggleGrant?: (granted: boolean) => Promise<void>;
  onSaveVerification: (settings: ToolVerificationSettings) => Promise<void>;
  onRiskChange?: (risk: ToolRiskClass) => Promise<void>;
}

function ParameterTable({ parameters }: { parameters: ToolParameterInfo[] }): JSX.Element {
  if (parameters.length === 0) {
    return <p className="text-xs opacity-50">{TEXT.TOOLS_DETAIL_PARAMETERS_EMPTY}</p>;
  }
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--as-border)]">
      <table className="w-full text-left text-xs">
        <thead className="bg-[var(--as-muted)]/60">
          <tr>
            <th scope="col" className="px-2 py-1.5 font-semibold">{TEXT.TOOLS_PARAM_HEADER_NAME}</th>
            <th scope="col" className="px-2 py-1.5 font-semibold">{TEXT.TOOLS_PARAM_HEADER_TYPE}</th>
            <th scope="col" className="px-2 py-1.5 font-semibold">{TEXT.TOOLS_PARAM_HEADER_DESCRIPTION}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--as-border)]">
          {parameters.map((parameter) => (
            <tr key={parameter.name}>
              <td className="px-2 py-1.5 align-top font-mono">{parameter.name}</td>
              <td className="px-2 py-1.5 align-top">
                <div className="flex flex-wrap items-center gap-1">
                  <code className="rounded bg-[var(--as-muted)] px-1 py-0.5 font-mono">{parameter.type}</code>
                  <span className={`text-[10px] uppercase tracking-wide ${parameter.required ? 'text-amber-500' : 'opacity-50'}`}>
                    {parameter.required ? TEXT.TOOLS_PARAM_REQUIRED : TEXT.TOOLS_PARAM_OPTIONAL}
                  </span>
                </div>
                {parameter.defaultValue !== undefined && (
                  <div className="mt-0.5 opacity-50">{interpolate(TEXT.TOOLS_PARAM_DEFAULT, { value: parameter.defaultValue })}</div>
                )}
                {parameter.enumValues && parameter.enumValues.length > 0 && (
                  <div className="mt-0.5 opacity-50">{interpolate(TEXT.TOOLS_PARAM_ALLOWED_VALUES, { values: parameter.enumValues.join(' · ') })}</div>
                )}
              </td>
              <td className="px-2 py-1.5 align-top opacity-80">{parameter.description ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ToolDetailsModal({
  tool,
  onClose,
  onToggleEnabled,
  onToggleGrant,
  onSaveVerification,
  onRiskChange,
}: ToolDetailsModalProps): JSX.Element {
  const [draft, setDraft] = useState<ToolVerificationSettings>(tool.verification);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(tool.verification);

  const apply = async (): Promise<void> => {
    setSaving(true);
    try {
      await onSaveVerification(draft);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onOpenChange={(open) => { if (!open) { onClose(); } }}>
      <ModalContent size="lg">
        <ModalHeader>
          <ModalTitle className="font-mono text-base">{tool.name}</ModalTitle>
          <ModalDescription>{tool.description}</ModalDescription>
        </ModalHeader>
        <div className="space-y-4 px-6 pb-6">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="text-[10px] font-normal uppercase">{tool.risk}</Badge>
            <Badge variant="outline" className="text-[10px] font-normal uppercase">{tool.source}</Badge>
            {tool.editableArgs && <Badge variant="outline" className="text-[10px] font-normal">{TEXT.TOOLS_BADGE_EDITABLE_ARGS}</Badge>}
            {!tool.enabled && <Badge variant="outline" className="text-[10px] font-normal">{TEXT.TOOLS_DISABLED_BADGE}</Badge>}
          </div>

          <ParameterTable parameters={tool.parameters} />

          <VerificationEditor
            risk={tool.risk}
            value={draft}
            onChange={setDraft}
            parameters={tool.parameters}
            toolName={tool.name}
          />
          {dirty && (
            <div className="flex items-center justify-end gap-1.5">
              <span className="mr-auto text-xs text-amber-500">{TEXT.TOOLS_UNSAVED_CHANGES}</span>
              <Button variant="ghost" size="sm" onClick={() => setDraft(tool.verification)}>
                {TEXT.CANCEL_BUTTON}
              </Button>
              <Button size="sm" disabled={saving} onClick={() => void apply()}>
                {TEXT.TOOLS_VERIFICATION_APPLY}
              </Button>
            </div>
          )}

          <div className="flex items-start justify-between gap-3 rounded-lg border border-[var(--as-border)] p-2.5">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium">{TEXT.TOOLS_ENABLE_TITLE}</p>
              <p className="text-xs opacity-60">{TEXT.TOOLS_ENABLE_HINT}</p>
            </div>
            <Switch
              checked={tool.enabled}
              label={interpolate(TEXT.TOOLS_ENABLE_ARIA, { name: tool.name })}
              onCheckedChange={(checked) => void onToggleEnabled(checked)}
            />
          </div>

          {tool.source === 'native' && tool.risk !== 'destructive' && onToggleGrant && (
            <div className="flex items-start justify-between gap-3 rounded-lg border border-[var(--as-border)] p-2.5">
              <div className="min-w-0 space-y-0.5">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  {tool.granted ? <ShieldCheck className="h-4 w-4 text-emerald-500" aria-hidden /> : <ShieldOff className="h-4 w-4" aria-hidden />}
                  {TEXT.TOOLS_GRANT_TITLE}
                </p>
                <p className="text-xs opacity-60">{TEXT.TOOLS_GRANT_ALLOW_HINT}</p>
              </div>
              {tool.granted ? (
                <Button variant="outline" size="sm" onClick={() => void onToggleGrant(false)}>
                  {TEXT.TOOLS_GRANT_REVOKE}
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => void onToggleGrant(true)}>
                  {TEXT.TOOLS_GRANT_ALLOW}
                </Button>
              )}
            </div>
          )}

          {tool.risk === 'destructive' && (
            <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-500">
              {TEXT.TOOLS_VERIFICATION_DESTRUCTIVE_LOCKED}
            </p>
          )}

          {onRiskChange && (
            <div className="space-y-1">
              <label htmlFor="tool-risk-select" className="text-sm font-medium">{TEXT.TOOLS_RISK_RECLASSIFY}</label>
              <p className="text-xs opacity-60">{TEXT.TOOLS_RISK_RECLASSIFY_HINT}</p>
              <select
                id="tool-risk-select"
                className="w-full rounded-md border border-[var(--as-border)] bg-[var(--as-input)] px-2 py-1.5 text-sm"
                value={tool.risk}
                onChange={(e) => void onRiskChange(e.target.value as ToolRiskClass)}
              >
                <option value="read-only">{TEXT.TOOLS_FILTER_READ_ONLY}</option>
                <option value="state-changing">{TEXT.TOOLS_FILTER_STATE_CHANGING}</option>
                <option value="destructive">{TEXT.TOOLS_FILTER_DESTRUCTIVE}</option>
              </select>
            </div>
          )}
        </div>
      </ModalContent>
    </Modal>
  );
}
