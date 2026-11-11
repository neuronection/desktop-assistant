export interface ClipboardSettings {
  /** Master switch; default off — history never captures before consent. */
  enabled: boolean;
  /** Temporarily stop capturing without losing the history. */
  paused: boolean;
  retentionHours: number;
  maxEntries: number;
}

export interface ClipboardEntryView {
  id: string;
  text: string;
  pinned: boolean;
  createdAt: string;
  /** True when the keyring is unavailable and the entry only lives in this session. */
  sessionOnly: boolean;
}

export interface ClipboardStatus {
  encryptionAvailable: boolean;
  enabled: boolean;
  paused: boolean;
  count: number;
  sessionOnly: boolean;
  /** Rows whose payload could not be decrypted (for example after a keyring change). */
  unreadable: number;
}
