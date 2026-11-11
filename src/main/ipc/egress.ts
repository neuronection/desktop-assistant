import { clearEgressLog, getEgressLog } from '@main/security/egress';
import { register } from './register';
import { IPC } from '@shared/ipc/registry';

export function registerEgressIpc(): void {
  register(IPC['egress:log'], async () => getEgressLog());
  register(IPC['egress:clear'], async () => {
    clearEgressLog();
    return true;
  });
}
