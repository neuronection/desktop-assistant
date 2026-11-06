import type { NotificationRecordView } from '@shared/notifications';
import { register } from './register';
import { IPC } from '@shared/ipc/registry';

export interface NotificationsIpcDeps {
  list(limit?: number): Promise<NotificationRecordView[]>;
  markRead(id: string): Promise<boolean>;
  markAllRead(): Promise<number>;
  clear(): Promise<number>;
  /** Route the record's closed click action through the shared rails; marks it read. */
  click(id: string): Promise<boolean>;
}

export function registerNotificationsIpc(deps: NotificationsIpcDeps): void {
  register(IPC['notifications:list'], async (_event, limit?: number) => deps.list(limit));
  register(IPC['notifications:mark-read'], async (_event, id: string) => deps.markRead(id));
  register(IPC['notifications:mark-all-read'], async () => deps.markAllRead());
  register(IPC['notifications:clear'], async () => deps.clear());
  register(IPC['notifications:click'], async (_event, id: string) => deps.click(id));
}
