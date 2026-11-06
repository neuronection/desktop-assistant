export const IPC_ERROR_CODES = ['invalid_args', 'scope_denied', 'unknown_channel', 'handler_error'] as const;

export type IpcErrorCode = (typeof IPC_ERROR_CODES)[number];

export interface IpcErrorShape {
  code: IpcErrorCode;
  message: string;
  channel?: string;
}

export const IPC_ERROR_PREFIX = 'ipc:';

export function formatIpcError(error: IpcErrorShape): string {
  return `${IPC_ERROR_PREFIX}${error.code}: ${error.message}`;
}

export function parseIpcError(message: string): IpcErrorShape | null {
  const match = /^ipc:([a-z_]+):\s*(.*)$/s.exec(message);
  if (!match || !(IPC_ERROR_CODES as readonly string[]).includes(match[1])) {
    return null;
  }
  return { code: match[1] as IpcErrorCode, message: match[2] };
}
