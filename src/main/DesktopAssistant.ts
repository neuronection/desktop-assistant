import { app, BrowserWindow } from 'electron';
import { WindowManager } from '@main/window';
import { TrayManager } from '@main/tray';
import { setupIpcHandlers } from '@main/ipc-handlers';
import { DatabaseService } from '@main/services/DatabaseService';
import { MainConfigService } from '@main/services/ConfigService';
import { HotkeyService } from '@main/services/HotkeyService';
import { ResidencyService } from '@main/services/ResidencyService';
import { applyDemoConfig, isDemoLaunch, seedDemoWorkspace } from '@main/demo';

export class DesktopAssistant {
  private isDev = process.env.NODE_ENV === 'development';
  private windowManager: WindowManager;
  private trayManager: TrayManager;
  private hotkeyService!: HotkeyService;
  private databaseService: DatabaseService;
  private configService: MainConfigService;
  private isInitialized = false;

  constructor() {
    this.windowManager = new WindowManager();
    this.trayManager = new TrayManager();
    this.databaseService = new DatabaseService();
    this.configService = MainConfigService.getInstance();
    
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }
    try {
      
      if (this.isDev) {
        this.enableDevelopmentFeatures();
      }
      
      await this.configService.loadConfig();

      ResidencyService.getInstance().apply(this.configService.getConfig().preferences?.autostart ?? false);
      
      await this.databaseService.initialize();

      if (isDemoLaunch(process.argv)) {
        await seedDemoWorkspace(this.databaseService.getClient());
        await applyDemoConfig(this.configService);
      }
      
      await this.windowManager.createMainWindow(process.argv.includes('--hidden'));

      this.hotkeyService = HotkeyService.getInstance(this.configService, this.windowManager);
      
      setupIpcHandlers(this.databaseService, this.windowManager, this.hotkeyService);

      this.trayManager.initialize();

      this.hotkeyService.registerAll();

      this.bindEvents();

      // The page load must never gate the tray/hotkeys above: a failed or
      // hung renderer load otherwise leaves the app unreachable (no tray,
      // no summon hotkey) — the 2026-09 Electron-36 zygote incident.
      await this.windowManager.loadApp();
      
      this.isInitialized = true;
      console.log('✅ Desktop Assistant initialized successfully');
      
      this.showStartupNotification();
      
    } catch (error) {
      console.error('❌ Failed to initialize Desktop Assistant:', error);
      if (this.isDev) {
        console.error('📋 Error:', error);
        throw error;
      }
    }
  }

  private showStartupNotification(): void {
    this.trayManager.showNotification(
      'Desktop Assistant',
      'Application started and ready to use!'
    );
  }

  private bindEvents(): void {
    // App events
    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') app.quit();
    });
    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await this.windowManager.createMainWindow();
      }
    });
    app.on('before-quit', () => this.windowManager.setQuitting(true));
    app.on('will-quit', () => this.cleanup());

    this.windowManager.on('window-closed', () => {
    });

    this.trayManager.on('show-window', () => this.windowManager.showMainWindow());
    this.trayManager.on('hide-window', () => this.windowManager.hideMainWindow());
    this.trayManager.on('toggle-window', () => this.windowManager.toggleMainWindow());
    this.trayManager.on('open-desktop', () => void this.windowManager.showDesktopWindow());
    this.trayManager.on('open-settings', () => this.windowManager.showSettingsWindow());
    this.trayManager.on('open-setup', () => this.windowManager.showSettingsWindow({ tab: 'api' }));
    this.trayManager.on('stop-speaking', () => this.hotkeyService.triggerStopSpeaking());
    this.trayManager.on('end-live', () => this.hotkeyService.triggerEndLive());
    this.trayManager.on('quit-app', () => this.quit());
    
  }

  private cleanup(): void {
    try {
      if (this.hotkeyService) {
        this.hotkeyService.unregisterAll();
      }
      
      this.databaseService.cleanup();
      
      console.log('Cleanup completed');
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }

  public quit(): void {
    console.log('🔵 Quitting application gracefully...');
    this.windowManager.setQuitting(true);
    app.quit();
  }

  private enableDevelopmentFeatures(): void {
  }

}