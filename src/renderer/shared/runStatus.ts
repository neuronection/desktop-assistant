import { TEXT } from '@shared/constants/text';

const STATUS_KEY: Record<string, string> = {
  queued: TEXT.MINIAPPS_RUN_STATUS_QUEUED,
  running: TEXT.MINIAPPS_RUN_STATUS_RUNNING,
  paused: TEXT.MINIAPPS_RUN_STATUS_PAUSED,
  done: TEXT.MINIAPPS_RUN_STATUS_DONE,
  failed: TEXT.MINIAPPS_RUN_STATUS_FAILED,
  canceled: TEXT.MINIAPPS_RUN_STATUS_CANCELED,
  interrupted: TEXT.MINIAPPS_RUN_STATUS_INTERRUPTED,
};

export function runStatusLabel(status: string): string {
  return STATUS_KEY[status] ?? status;
}
