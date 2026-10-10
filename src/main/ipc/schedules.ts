import { ipcMain } from 'electron';
import type { ScheduleInput, ScheduleService } from '@main/services/ScheduleService';

/** Every channel this module registers (the teardown list consumes this). */
export const SCHEDULES_IPC_CHANNELS: string[] = [
  'schedules:list', 'schedules:create', 'schedules:update', 'schedules:delete', 'schedules:run-now',
];

export interface SchedulesIpcDeps {
  scheduleService: ScheduleService;
}

export function registerSchedulesIpc(deps: SchedulesIpcDeps): void {
  const { scheduleService } = deps;

  ipcMain.handle('schedules:list', async () => {
    return scheduleService.list();
  });

  ipcMain.handle('schedules:create', async (_event, input: ScheduleInput) => {
    return scheduleService.create(input);
  });

  ipcMain.handle('schedules:update', async (_event, id: string, patch: Partial<ScheduleInput> & { enabled?: boolean }) => {
    return scheduleService.update(id, patch);
  });

  ipcMain.handle('schedules:delete', async (_event, id: string) => {
    await scheduleService.remove(id);
    return true;
  });

  ipcMain.handle('schedules:run-now', async (_event, id: string) => {
    return scheduleService.runNow(id);
  });
}
