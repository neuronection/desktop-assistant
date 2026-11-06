import type { ScheduleInput, ScheduleService } from '@main/services/ScheduleService';
import { register } from './register';
import { IPC } from '@shared/ipc/registry';

/** Every channel this module registers (the teardown list consumes this). */

export interface SchedulesIpcDeps {
  scheduleService: ScheduleService;
}

export function registerSchedulesIpc(deps: SchedulesIpcDeps): void {
  const { scheduleService } = deps;

  register(IPC['schedules:list'], async () => {
    return scheduleService.list();
  });

  register(IPC['schedules:create'], async (_event, input: ScheduleInput) => {
    return scheduleService.create(input);
  });

  register(IPC['schedules:update'], async (_event, id: string, patch: Partial<ScheduleInput> & { enabled?: boolean }) => {
    return scheduleService.update(id, patch);
  });

  register(IPC['schedules:delete'], async (_event, id: string) => {
    await scheduleService.remove(id);
    return true;
  });

  register(IPC['schedules:run-now'], async (_event, id: string) => {
    return scheduleService.runNow(id);
  });
}
