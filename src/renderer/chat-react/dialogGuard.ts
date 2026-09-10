let openDialogs = 0;

export function beginDialog(): void {
  openDialogs += 1;
}

export function endDialog(): void {
  openDialogs = Math.max(0, openDialogs - 1);
}

export function isDialogOpen(): boolean {
  return openDialogs > 0;
}
