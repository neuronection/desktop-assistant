/**
 * Request-scoped abort seam for the non-chat audio ops (tts synthesis,
 * stt transcription). The renderer names each in-flight request and can
 * cancel it (SpeechBar stop, transcribing cancel, the global
 * Stop-Speaking hotkey); the abort reaches the provider fetch, so a
 * cancelled request stops paying for the roundtrip. The
 * `tools:cancel-download` tracker is the precedential shape.
 */

const ops = new Map<string, AbortController>();

/** Registers an op and returns its abort signal (undefined without an id). */
export function beginAudioOp(requestId: string | undefined): AbortSignal | undefined {
  if (!requestId) {
    return undefined;
  }
  if (ops.size > 64) {
    for (const [id, controller] of ops) {
      if (controller.signal.aborted) {
        ops.delete(id);
      }
    }
  }
  let controller = ops.get(requestId);
  if (!controller || controller.signal.aborted) {
    controller = new AbortController();
    ops.set(requestId, controller);
  }
  return controller.signal;
}

export function endAudioOp(requestId: string | undefined): void {
  if (requestId) {
    ops.delete(requestId);
  }
}

/** Aborts an in-flight op; true when one was live under this id. */
export function cancelAudioOp(requestId: string): boolean {
  const controller = ops.get(requestId);
  if (!controller) {
    return false;
  }
  controller.abort();
  ops.delete(requestId);
  return true;
}

/** True for cancellation rejections (fetch AbortError, OpenAI APIUserAbortError). */
export function isAbortError(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  if (name === 'AbortError' || name === 'APIUserAbortError') {
    return true;
  }
  return /\babort(ed)?\b/i.test((error as Error | null)?.message ?? '');
}
