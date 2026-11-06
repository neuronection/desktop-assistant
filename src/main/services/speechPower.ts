export type SpeechPowerEvent = 'suspend' | 'lock-screen';

export interface SpeechPowerMonitor {
  on(event: SpeechPowerEvent, listener: () => void): void;
}

export interface SpeechSuspendable {
  suspend(): void;
}

/**
 * Plan 58 §4.4: both suspend and screen-lock land the bus in `idle`.
 * Injected monitor keeps this testable without Electron.
 */
export function attachSpeechPowerEvents(monitor: SpeechPowerMonitor, speech: SpeechSuspendable): void {
  monitor.on('suspend', () => speech.suspend());
  monitor.on('lock-screen', () => speech.suspend());
}
