import { app } from 'electron';

export class ResidencyService {
  private static instance: ResidencyService;
  private applied: boolean | null = null;

  private constructor() {}

  static getInstance(): ResidencyService {
    if (!ResidencyService.instance) {
      ResidencyService.instance = new ResidencyService();
    }
    return ResidencyService.instance;
  }

  apply(autostart: boolean): void {
    if (this.applied === autostart) {
      return;
    }
    try {
      app.setLoginItemSettings({ openAtLogin: autostart });
      this.applied = autostart;
      console.log(`Login item ${autostart ? 'enabled' : 'disabled'}`);
    } catch (error) {
      console.error('Failed to update login item settings:', error);
    }
  }
}
