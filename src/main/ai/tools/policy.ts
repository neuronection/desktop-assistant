import { existsSync, statSync } from 'fs';
import { dirname, isAbsolute, parse, relative, resolve, sep } from 'path';
import type { ToolPolicySettings } from '@shared/config/AppConfig';
import type { ToolClassDefaults, ToolRiskClass, ToolVerificationCondition, ToolVerificationSettings } from '@shared/turns';
import { MCP_TOOL_PREFIX } from '@shared/mcp';

export type PolicyDecision = 'run' | 'approve' | 'deny';

export type GrantSource = 'auto' | 'once' | 'session' | 'always' | 'policy';

export interface ToolPolicySnapshot {
  toolGrants: Record<string, 'always'>;
  disabledTools: string[];
  grantedRoots: string[];
  toolSettings: Record<string, ToolVerificationSettings>;
  classDefaults: ToolClassDefaults;
}

export type PolicyReader = () => ToolPolicySnapshot;

export interface EffectiveVerification {
  settings: ToolVerificationSettings;
  /** True when a per-tool override (not the class default) decides. */
  custom: boolean;
}

/**
 * Privacy-sensitive built-ins whose class default (read-only → run)
 * is not safe enough: the clipboard regularly holds passwords, tokens,
 * and copied secrets, so model-initiated reads ask first. A per-tool
 * override still wins.
 */
const BUILT_IN_TOOL_DEFAULTS: Record<string, ToolVerificationSettings> = {
  clipboard_read: { mode: 'always_ask' },
};

/**
 * Verification resolution order: per-tool override → built-in tool
 * default → class default → built-in (standard). Class defaults only
 * apply to built-in tools — third-party MCP tools (namespaced `mcp__…`)
 * always keep their own settings so a preset can never silently
 * auto-run unvetted code. Destructive tools have no class default —
 * they always confirm (ADR-0011).
 */
export function resolveVerification(
  toolName: string,
  risk: ToolRiskClass,
  snapshot: Pick<ToolPolicySnapshot, 'toolSettings' | 'classDefaults'>
): EffectiveVerification {
  const override = snapshot.toolSettings?.[toolName];
  if (override) {
    return { settings: override, custom: true };
  }
  if (toolName.startsWith(MCP_TOOL_PREFIX)) {
    return { settings: { mode: 'standard' }, custom: false };
  }
  const builtIn = BUILT_IN_TOOL_DEFAULTS[toolName];
  if (builtIn) {
    return { settings: builtIn, custom: false };
  }
  const defaults = snapshot.classDefaults ?? {};
  if (risk === 'read-only' && defaults.readOnly === 'always_ask') {
    return { settings: { mode: 'always_ask' }, custom: false };
  }
  if (risk === 'state-changing' && defaults.stateChanging && defaults.stateChanging !== 'standard') {
    return { settings: { mode: defaults.stateChanging }, custom: false };
  }
  return { settings: { mode: 'standard' }, custom: false };
}

/**
 * The hard product rule (ADR-0011): destructive tools confirm every call —
 * verification overrides and grants can never bypass that.
 */
export function destructiveLocked(risk: ToolRiskClass): boolean {
  return risk === 'destructive';
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function asString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined || value === null) {
    return '';
  }
  return String(value);
}

/** Evaluates one scenario row against the call arguments. */
export function conditionMatches(condition: ToolVerificationCondition, args: unknown): boolean {
  if (typeof args !== 'object' || args === null) {
    return condition.operator === 'absent';
  }
  const value = (args as Record<string, unknown>)[condition.param];
  switch (condition.operator) {
    case 'present':
      return value !== undefined;
    case 'absent':
      return value === undefined;
    case 'equals':
      return asString(value) === (condition.value ?? '');
    case 'not_equals':
      return asString(value) !== (condition.value ?? '');
    case 'contains':
      return asString(value).toLowerCase().includes((condition.value ?? '').toLowerCase());
    case 'gt':
    case 'lt': {
      const left = asNumber(value);
      const right = asNumber(condition.value);
      if (left === null || right === null) {
        return false;
      }
      return condition.operator === 'gt' ? left > right : left < right;
    }
    case 'matches':
      try {
        return new RegExp(condition.value ?? '').test(asString(value));
      } catch {
        return false;
    }
  }
}

export function matchesAnyCondition(
  conditions: ToolVerificationCondition[] | undefined,
  args: unknown
): boolean {
  if (!conditions || conditions.length === 0) {
    return false;
  }
  return conditions.some((condition) => conditionMatches(condition, args));
}

/**
 * Decides whether a tool call may run, needs approval, or is denied:
 * risk class × per-tool verification settings × persistent grants ×
 * in-memory session grants × kill switch. Destructive tools always
 * require per-call approval — class-level rule, overrides and grants
 * never bypass it (ADR-0011). Session grants live in memory only;
 * persistent grants come from config (non-secret) and are written back
 * through `persistAlways`.
 */
export class ToolPolicyEngine {
  private readonly sessionGrants = new Set<string>();
  private readonly sessionRoots = new Set<string>();

  constructor(
    private readonly readConfig: PolicyReader,
    private readonly persistAlways?: (toolName: string) => Promise<void>,
    private readonly persistRoot?: (root: string) => Promise<void>
  ) {}

  resolveVerificationFor(toolName: string, risk: ToolRiskClass): EffectiveVerification {
    const config = this.readConfig();
    return resolveVerification(toolName, risk, {
      toolSettings: config.toolSettings ?? {},
      classDefaults: config.classDefaults ?? {},
    });
  }

  decision(toolName: string, risk: ToolRiskClass, args?: unknown): PolicyDecision {
    if (this.isDisabled(toolName)) {
      return 'deny';
    }
    const { mode, conditions } = this.resolveVerificationFor(toolName, risk).settings;
    if (mode === 'always_ask') {
      return 'approve';
    }
    if (!destructiveLocked(risk)) {
      if (mode === 'never') {
        return 'run';
      }
      if (mode === 'conditions') {
        return matchesAnyCondition(conditions, args) ? 'approve' : 'run';
      }
    }
    if (risk === 'read-only') {
      return 'run';
    }
    if (risk === 'destructive') {
      return 'approve';
    }
    if (this.sessionGrants.has(toolName) || this.readConfig().toolGrants[toolName] === 'always') {
      return 'run';
    }
    return 'approve';
  }

  needsApproval(toolName: string, risk: ToolRiskClass, args?: unknown): boolean {
    return this.decision(toolName, risk, args) === 'approve';
  }

  isDisabled(toolName: string): boolean {
    return this.readConfig().disabledTools.includes(toolName);
  }

  grantSource(toolName: string, risk: ToolRiskClass, args?: unknown): GrantSource {
    if (this.decision(toolName, risk, args) !== 'run') {
      return 'once';
    }
    if (risk === 'read-only') {
      return 'auto';
    }
    const { mode } = this.resolveVerificationFor(toolName, risk).settings;
    if (mode === 'never' || mode === 'conditions') {
      return 'policy';
    }
    if (this.sessionGrants.has(toolName)) {
      return 'session';
    }
    return 'always';
  }

  grantSession(toolName: string): void {
    this.sessionGrants.add(toolName);
  }

  async grantAlways(toolName: string): Promise<void> {
    if (this.persistAlways) {
      await this.persistAlways(toolName);
    }
  }

  sessionGrantsList(): string[] {
    return [...this.sessionGrants];
  }

  grantedRoots(): string[] {
    return [...new Set([...this.readConfig().grantedRoots, ...this.sessionRoots])];
  }

  /**
   * HITL access requests: the roots a call would need granted. A path
   * already inside a granted root contributes nothing; everything else
   * maps to its `deriveGrantRoot` proposal (filesystem root refused).
   */
  rootsNeedingGrant(pathArgs: string[] | undefined, args: unknown): string[] {
    if (!pathArgs || pathArgs.length === 0) {
      return [];
    }
    const paths = extractPathArgs(args, pathArgs);
    const granted = this.grantedRoots();
    const outside = paths.filter((path) => resolveWithinGrantedRoots(granted, path) === null);
    if (outside.length === 0) {
      return [];
    }
    const roots = new Set<string>();
    for (const path of outside) {
      const root = deriveGrantRoot(path);
      if (root) {
        roots.add(root);
      }
    }
    return [...roots];
  }

  needsRootGrant(pathArgs: string[] | undefined, args: unknown): boolean {
    return this.rootsNeedingGrant(pathArgs, args).length > 0;
  }

  /** Root granted for this session only (in memory, like session grants). */
  grantRootSession(root: string): void {
    this.sessionRoots.add(resolve(root));
  }

  /** Root persisted into `config.tools.grantedRoots` (shows in Settings). */
  async grantRootAlways(root: string): Promise<void> {
    if (this.persistRoot) {
      await this.persistRoot(resolve(root));
    }
    this.grantRootSession(root);
  }

  clearSession(): void {
    this.sessionGrants.clear();
    this.sessionRoots.clear();
  }

  snapshot(): ToolPolicySnapshot {
    const config = this.readConfig();
    return {
      toolGrants: { ...config.toolGrants },
      disabledTools: [...config.disabledTools],
      grantedRoots: [...config.grantedRoots],
      toolSettings: { ...config.toolSettings },
      classDefaults: { ...config.classDefaults },
    };
  }
}

export function defaultPolicySnapshot(settings: ToolPolicySettings | undefined): ToolPolicySnapshot {
  return {
    toolGrants: settings?.toolGrants ?? {},
    disabledTools: settings?.disabledTools ?? [],
    grantedRoots: settings?.grantedRoots ?? [],
    toolSettings: settings?.toolSettings ?? {},
    classDefaults: settings?.classDefaults ?? {},
  };
}

/**
 * Resolves `target` inside `root` and returns the absolute path, or null
 * when the target escapes the root (`..`, absolute relative paths, or the
 * root boundary itself is allowed as the empty relative path).
 */
export function resolveWithinRoot(root: string, target: string): string | null {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  const rel = relative(resolvedRoot, resolvedTarget);
  if (rel === '') {
    return resolvedTarget;
  }
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return null;
  }
  return resolvedTarget;
}

export function resolveWithinGrantedRoots(roots: string[], target: string): string | null {
  for (const root of roots) {
    const inside = resolveWithinRoot(root, target);
    if (inside !== null) {
      return inside;
    }
  }
  return null;
}

export function describeRootBreach(target: string): string {
  return `Access to '${target}' was not granted — it is outside the folders the user approved. Ask the user to allow access or pick the folder in Settings → Tools.`;
}

export function isSubpath(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) && !rel.includes(`..${sep}`);
}

/** String values of the given path-arg keys present in the call args. */
export function extractPathArgs(args: unknown, pathArgs: string[]): string[] {
  if (typeof args !== 'object' || args === null || pathArgs.length === 0) {
    return [];
  }
  const record = args as Record<string, unknown>;
  return pathArgs
    .map((key) => record[key])
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '');
}

/**
 * Proposes the folder to grant for access to `target`: the directory
 * itself when it exists, else the nearest existing ancestor (so new
 * files in not-yet-existing folders work). Returns null when the only
 * sensible grant would be the filesystem/drive root — that is never
 * auto-proposed; the user picks such a folder in Settings themselves.
 */
export function deriveGrantRoot(target: string): string | null {
  let current = resolve(target);
  const fsRoot = parse(current).root;
  for (let i = 0; i < 64; i += 1) {
    if (current !== fsRoot && existsSync(current)) {
      try {
        if (statSync(current).isDirectory()) {
          return current;
        }
      } catch {
        // unreadable stat → keep walking up
      }
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
  return null;
}
