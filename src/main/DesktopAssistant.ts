import { app, BrowserWindow, powerMonitor } from 'electron';
import { WindowManager } from '@main/window';
import { TrayManager } from '@main/tray';
import { setupIpcHandlers } from '@main/ipc-handlers';
import { DatabaseService } from '@main/services/DatabaseService';
import { MainConfigService } from '@main/services/ConfigService';
import { HotkeyService } from '@main/services/HotkeyService';
import { ResidencyService } from '@main/services/ResidencyService';
import { UpdateService } from '@main/services/updates';
import { SpeechCacheService } from '@main/services/SpeechCacheService';
import { attachSpeechPowerEvents } from '@main/services/speechPower';
import type { SpeechService } from '@main/services/SpeechService';
import type { SpeechHudStyle } from '@shared/speechHud';
import { registerSpeechCacheProtocol } from '@main/services/SpeechCacheProtocol';
import { applyDemoConfig, isDemoLaunch, seedDemoWorkspace } from '@main/demo';

export class DesktopAssistant {
  private isDev = process.env.NODE_ENV === 'development';
  private windowManager: WindowManager;
  private trayManager: TrayManager;
  private hotkeyService!: HotkeyService;
  private databaseService: DatabaseService;
  private configService: MainConfigService;
  private updateService!: UpdateService;
  private speechService: SpeechService | null = null;
  private isInitialized = false;
  private initializationError: unknown = null;

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
    this.initializationError = null;
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

      const speechCache = SpeechCacheService.getInstance();
      registerSpeechCacheProtocol(speechCache);
      await speechCache.load();

      await this.windowManager.createMainWindow(process.argv.includes('--hidden'));

      this.hotkeyService = HotkeyService.getInstance(this.configService, this.windowManager);

      this.updateService = new UpdateService({
        getAppVersion: () => app.getVersion(),
        getChannel: () => this.configService.getConfig().updates.channel,
        installerIsPackaged: app.isPackaged,
        onProgressPush: (percent) => {
          for (const window of BrowserWindow.getAllWindows()) {
            window.webContents.send('updates:progress', { percent });
          }
        },
        onStateChange: (state) => {
          for (const window of BrowserWindow.getAllWindows()) {
            if (!window.isDestroyed()) {
              window.webContents.send('updates:state', state);
            }
          }
          this.trayManager.setUpdateVersion(state.release?.tag ?? null);
        },
      });
      this.updateService.start();

      const ipcHandlers = setupIpcHandlers(
        this.databaseService,
        this.windowManager,
        this.hotkeyService,
        this.trayManager,
        this.updateService
      );
      this.speechService = ipcHandlers?.speech ?? null;

      this.windowManager.setHudMenuControls({
        togglePause: () => this.hotkeyService.triggerPauseSpeaking(),
        stopSpeech: () => this.hotkeyService.triggerStopSpeaking(),
        endLive: () => this.hotkeyService.triggerEndLive(),
      });
      this.trayManager.initialize();

      if (this.speechService) {
        this.trayManager.setSpeechState(this.speechService.getSnapshot());
        attachSpeechPowerEvents(powerMonitor, this.speechService);
      }

      this.hotkeyService.registerAll();

      this.bindEvents();

      // The page load must never gate the tray/hotkeys above: a failed or
      // hung renderer load otherwise leaves the app unreachable (no tray,
      // no summon hotkey) — the 2026-09 Electron-36 zygote incident.
      await this.windowManager.loadApp();
      this.windowManager.refreshSpeechHud();
      
      this.isInitialized = true;
      console.log('✅ Desktop Assistant initialized successfully');
      
      this.showStartupNotification();
      
    } catch (error) {
      this.initializationError = error;
      console.error('❌ Failed to initialize Desktop Assistant:', error);
      if (this.isDev) {
        console.error('📋 Error:', error);
        throw error;
      }
    }
  }

  public getInitializationError(): unknown {
    return this.initializationError;
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
    app.on('before-quit', () => {
      this.speechService?.suspend();
      this.windowManager.destroySpeechOverlay();
      this.windowManager.setQuitting(true);
    });
    app.on('will-quit', () => this.cleanup());

    this.windowManager.on('window-closed', () => {
    });

    this.trayManager.on('show-window', () => this.windowManager.showMainWindow());
    this.trayManager.on('hide-window', () => this.windowManager.hideMainWindow());
    this.trayManager.on('show-hud', () => this.windowManager.showSpeechHud());
    this.trayManager.on('toggle-window', () => this.windowManager.toggleMainWindow());
    this.trayManager.on('open-desktop', () => void this.windowManager.showDesktopWindow());
    this.trayManager.on('open-settings', () => this.windowManager.showSettingsWindow());
    this.trayManager.on('open-about', () => this.windowManager.showSettingsWindow({ tab: 'about' }));
    this.trayManager.on('check-updates', () => {
      void this.updateService.checkNow().then((state) => {
        if (state.release) {
          this.windowManager.showSettingsWindow({ tab: 'about' });
        }
      });
    });
    this.trayManager.on('open-setup', () => this.windowManager.showSettingsWindow({ tab: 'api' }));
    this.trayManager.on('stop-speaking', () => this.hotkeyService.triggerStopSpeaking());
    this.trayManager.on('speak-clipboard', () => this.hotkeyService.triggerSpeakClipboard());
    this.trayManager.on('pause-speaking', () => this.hotkeyService.triggerPauseSpeaking());
    this.trayManager.on('replay-speaking', () => this.hotkeyService.triggerReplayLast());
    this.trayManager.on('set-hud-style', (style: SpeechHudStyle) => {
      this.setSpeechHudStyle(style);
    });
    this.windowManager.on('hud-style-changed', () => this.trayManager.refreshMenu());
    this.trayManager.on('start-live', () => this.hotkeyService.triggerStartLive());
    this.trayManager.on('end-live', () => this.hotkeyService.triggerEndLive());
    this.trayManager.on('quit-app', () => this.quit());
    
  }

  private setSpeechHudStyle(style: SpeechHudStyle): void {
    const current = this.configService.getConfig();
    if ((current.voice?.speechHudStyle ?? 'card') === style) {
      this.trayManager.refreshMenu();
      return;
    }
    void this.configService
      .updateConfig({ ...current, voice: { ...current.voice, speechHudStyle: style } })
      .then(() => {
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) {
            window.webContents.send('config-updated', { voice: { speechHudStyle: style } });
          }
        }
        this.windowManager.applySpeechHudStyle();
        this.trayManager.refreshMenu();
      })
      .catch((error) => console.error('Failed to set the HUD style:', error));
  }

  private cleanup(): void {
    try {
      if (this.hotkeyService) {
        this.hotkeyService.unregisterAll();
      }
      this.updateService?.stop();
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