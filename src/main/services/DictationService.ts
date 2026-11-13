import {
  DICTATION_IDLE,
  normalizeDictationPatch,
  type DictationOrigin,
  type DictationSnapshot,
} from '@shared/dictation';

export interface DictationBeginResult {
  ok: boolean;
  snapshot: DictationSnapshot;
}

/**
 * The one dictation session (plan 83 S1). The recorder still lives in the
 * renderer that started it; this service owns *who* is recording, what the
 * session's text is, and pushes every change to all windows. A second window
 * cannot open a mic while a session is live, and any window can stop it.
 */
export class DictationService {
  private current: DictationSnapshot = { ...DICTATION_IDLE };
  private owner: number | null = null;
  private readonly listeners = new Set<(snapshot: DictationSnapshot) => void>();

  public snapshot(): DictationSnapshot {
    return { ...this.current };
  }

  public ownerId(): number | null {
    return this.owner;
  }

  public begin(origin: DictationOrigin, ownerId: number): DictationBeginResult {
    if (this.current.phase !== 'idle' && this.owner !== ownerId) {
      return { ok: false, snapshot: this.snapshot() };
    }
    this.owner = ownerId;
    const snapshot = this.publish({ ...DICTATION_IDLE, phase: 'recording', origin });
    return { ok: true, snapshot };
  }

  /** Owner-only: merge a patch into the session (ignored from any other window). */
  public report(ownerId: number, patch: Partial<DictationSnapshot>): DictationSnapshot | null {
    if (this.owner !== ownerId) {
      return null;
    }
    const normalized = normalizeDictationPatch(patch);
    const next: DictationSnapshot = { ...this.current, ...normalized };
    if (next.phase === 'idle') {
      return this.end(ownerId);
    }
    return this.publish(next);
  }

  /** Owner-only end, unless forced (the owner window went away). */
  public end(ownerId: number | null, options: { force?: boolean } = {}): DictationSnapshot {
    if (!options.force && (ownerId === null || this.owner !== ownerId)) {
      return this.snapshot();
    }
    this.owner = null;
    return this.publish({ ...DICTATION_IDLE });
  }

  public subscribe(listener: (snapshot: DictationSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private publish(next: DictationSnapshot): DictationSnapshot {
    this.current = next;
    for (const listener of this.listeners) {
      try {
        listener({ ...next });
      } catch {
        // A surface that throws must not break the session.
      }
    }
    return { ...next };
  }
}
