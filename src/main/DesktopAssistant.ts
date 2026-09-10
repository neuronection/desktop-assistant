import { app, BrowserWindow } from 'electron';
import { WindowManager } from '@main/window';
import { TrayManager } from '@main/tray';
import { setupIpcHandlers } from '@main/ipc-handlers';
import { DatabaseService } from '@main/services/DatabaseService';
import { MainConfigService } from '@main/services/ConfigService';
import { HotkeyService } from '@main/services/HotkeyService';
import { ResidencyService } from '@main/services/ResidencyService';

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
    
    console.log('🔧 DesktopAssistant components created');
    console.log('📍 Environment:', this.isDev ? 'DEVELOPMENT' : 'PRODUCTION');
    console.log('📂 User Data Path:', app.getPath('userData'));
    console.log('📍 App Path:', app.getAppPath());
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.log('⚠️ DesktopAssistant already initialized');
      return;
    }
    try {
      console.log('🚀 Initializing Desktop Assistant...');
      
      if (this.isDev) {
        this.enableDevelopmentFeatures();
      }
      
      console.log('⚙️ Loading configuration...');
      await this.configService.loadConfig();

      console.log('🏠 Applying residency (single-instance + login item)...');
      ResidencyService.getInstance().apply(this.configService.getConfig().preferences?.autostart ?? false);
      
      console.log('📊 Initializing database...');
      await this.databaseService.initialize();
      
      console.log('🪟 Creating main window...');
      await this.windowManager.createMainWindow();

      console.log('⌨️ Initializing Hotkey Service...');
      this.hotkeyService = HotkeyService.getInstance(this.configService, this.windowManager);
      
      console.log('🔌 Setting up IPC handlers...');
      setupIpcHandlers(this.databaseService, this.windowManager, this.hotkeyService);

      console.log('📱 Initializing system tray...');
      this.trayManager.initialize();

      console.log('⌨️ Registering global shortcuts...');
      this.hotkeyService.registerAll();

      console.log('🔗 Binding events...');
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
    app.on('ready', () => console.log('App is ready'));
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
        console.log('Window was allowed to close.');
    });
    this.windowManager.on('window-hidden', () => console.log('Window hidden to tray'));

    this.trayManager.on('show-window', () => this.windowManager.showMainWindow());
    this.trayManager.on('hide-window', () => this.windowManager.hideMainWindow());
    this.trayManager.on('toggle-window', () => this.windowManager.toggleMainWindow());
    this.trayManager.on('open-desktop', () => void this.windowManager.showDesktopWindow());
    this.trayManager.on('open-settings', () => this.windowManager.showSettingsWindow());
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
    console.log('🛠️ Enabling development features...');
    
    if (!process.debugPort) {
      console.log('🔍 Main process inspector available at chrome://inspect');
    }
    
    console.log('🌍 Environment Info:', {
      NODE_ENV: process.env.NODE_ENV,
      ELECTRON_IS_DEV: process.env.ELECTRON_IS_DEV,
      userDataPath: app.getPath('userData'),
      version: app.getVersion()
    });
  }

}