import type { ValidatedPack } from '@shared/app-pack';
import { PackFs, validateRunRoot, type FsResult, type PackFsDeps, type PackFsEnv } from './fs';
import { PackDecideBridge, type PackDecideDeps } from './decide';
import { PackRunBridge } from './run';

/** Thrown when a bridge is accessed without the pack declaring the capability. */
export class PackCapabilityError extends Error {
  constructor(readonly error: { code: 'invalid'; detail: { message?: string } }) {
    super(String(error.detail.message ?? ''));
  }
}

export interface PackCapabilityDeps extends PackFsDeps {
  fsEnv: PackFsEnv;
  decideDeps: PackDecideDeps;
  run: PackRunBridge;
}

export interface PackCapabilitySet {
  /** Opens the host fs capability bound to one validated run root (fs-read). */
  readonly fs: (root: string) => Promise<FsResult<PackFs>>;
  /** Typed questions through the decision funnel (decision). */
  readonly decide: PackDecideBridge;
  /** Own-run lifecycle only (run). */
  readonly run: PackRunBridge;
}

/**
 * Capability-gated registration (plan 26 S2, ADR-0029 clause 5): the
 * declared set gates the API surface — accessing an undeclared bridge
 * throws HERE (registration), never mid-run. `net` has no member at any
 * tier in v1; `fs-write-quarantine` arrives with the S6 propose executor.
 */
export function capabilitiesFor(pack: ValidatedPack, deps: PackCapabilityDeps): PackCapabilitySet {
  const declared = new Set<string>(pack.manifest.capabilities);
  const gate = (capability: string): void => {
    if (!declared.has(capability)) {
      throw new PackCapabilityError({
        code: 'invalid',
        detail: { message: `capability "${capability}" is not declared by this pack` },
      });
    }
  };
  return {
    get fs() {
      gate('fs-read');
      return async (root: string): Promise<FsResult<PackFs>> => {
        const validated = await validateRunRoot(root, deps.fsEnv, deps);
        if (!validated.ok) {
          return validated;
        }
        return { ok: true, value: new PackFs(validated.value.root, validated.value.dev, deps) };
      };
    },
    get decide() {
      gate('decision');
      return new PackDecideBridge(deps.decideDeps);
    },
    get run() {
      gate('run');
      return deps.run;
    },
  };
}
