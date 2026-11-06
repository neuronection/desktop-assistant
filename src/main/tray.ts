import { Tray, Menu, nativeImage } from 'electron';
import { join } from 'path';
import { EventEmitter } from 'events';
import { TEXT, interpolate } from '@shared/constants/index';
import { trayBadgeSupport } from '@shared/notifications';
import { hasConfiguredProvider } from '@shared/ai/providerPresets';
import { MainConfigService } from '@main/services/ConfigService';
import { getAssetsPath } from '@main/utils/config';
import type { SpeechSnapshot } from '@shared/speech';
import type { LiveSnapshot } from '@shared/live';
import { SPEECH_HUD_STYLES, type SpeechHudStyle } from '@shared/speechHud';

export class TrayManager extends EventEmitter {
  private tray: Tray | null = null;
  private isInitialized = false;
  private unreadBadge = 0;
  private speechState: SpeechSnapshot | null = null;
  private speechReplayAvailable = false;
  private liveState: LiveSnapshot | null = null;

  private speechHudStyle(): SpeechHudStyle {
    return MainConfigService.getInstance().getConfig().voice?.speechHudStyle ?? 'card';
  }

  private speechHudStyleLabel(style: SpeechHudStyle): string {
    switch (style) {
      case 'edge':
        return TEXT.VOICE_SPEECH_HUD_STYLE_EDGE;
      case 'dot':
        return TEXT.VOICE_SPEECH_HUD_STYLE_DOT;
      default:
        return TEXT.VOICE_SPEECH_HUD_STYLE_CARD;
    }
  }

  /** Rebuilds the menu after an out-of-band change (the style cycle). */
  public refreshMenu(): void {
    if (this.tray) {
      this.updateTrayMenu();
    }
  }

  public initialize(): void {
    if (this.isInitialized) return;

    try {
      const iconPath = this.getTrayIconPath();
      const icon = nativeImage.createFromPath(iconPath);
      
      const trayIcon = icon.resize({ width: 16, height: 16 });
      
      this.tray = new Tray(trayIcon);
      
      this.tray.setToolTip(TEXT.TRAY_TOOLTIP);
      this.tray.setIgnoreDoubleClickEvents(false);
      
      this.updateTrayMenu();
      this.bindTrayEvents();
      this.setUnreadBadge(this.unreadBadge);
      
      this.isInitialized = true;
      console.log('System tray initialized');
    } catch (error) {
      console.error('Failed to initialize system tray:', error);
    }
  }

  private getTrayIconPath(): string {
      const assetsPath = getAssetsPath();
      const iconsPath = join(assetsPath, 'icons');

      if (process.platform === 'win32') {
        return join(iconsPath, 'tray-icon.ico');
      } else if (process.platform === 'darwin') {
        return join(iconsPath, 'tray-iconTemplate.png');
      } else {
        return join(iconsPath, 'tray-icon.png');
      }
  }

  private bindTrayEvents(): void {
    if (!this.tray) return;

    // Single click to toggle window
    this.tray.on('click', () => {
      this.emit('toggle-window');
    });

    // Double click to show window
    this.tray.on('double-click', () => {
      this.emit('show-window');
    });

    // Right click to show context menu
    this.tray.on('right-click', () => {
      if (this.tray) {
        this.updateTrayMenu();
        this.tray.popUpContextMenu();
      }
    });
  }

  /** Mirrors the bus into the tray (plan 58 S3b): labels, enablement, progress tooltip. */
  public setSpeechState(snapshot: SpeechSnapshot): void {
    const previousState = this.speechState?.state;
    this.speechState = snapshot;
    if (!this.tray) {
      return;
    }
    this.tray.setToolTip(this.speechTooltip());
    if (previousState !== snapshot.state) {
      this.updateTrayMenu();
    }
  }

  /** Live presence drives Start/End enablement (no mic = no live). */
  public setLiveState(snapshot: LiveSnapshot | null): void {
    this.liveState = snapshot;
    this.updateTrayMenu();
  }

  /** A terminal live error still owns the session (End works, Start retries). */
  private liveSessionExists(): boolean {
    return this.liveState !== null && this.liveState.state !== 'idle';
  }

  private liveRunning(): boolean {
    return this.liveSessionExists() && this.liveState?.state !== 'error';
  }

  public setSpeechReplayAvailable(available: boolean): void {
    if (this.speechReplayAvailable === available) {
      return;
    }
    this.speechReplayAvailable = available;
    if (this.tray) {
      this.updateTrayMenu();
    }
  }

  private speechTooltip(): string {
    const snapshot = this.speechState;
    if (!snapshot || snapshot.state === 'idle') {
      return TEXT.TRAY_TOOLTIP;
    }
    const current = Math.min(Math.max(snapshot.chunkIndex + 1, 1), Math.max(snapshot.chunkCount, 1));
    return interpolate(snapshot.state === 'paused' ? TEXT.TRAY_SPEECH_PAUSED : TEXT.TRAY_SPEECH_SPEAKING, {
      current,
      total: Math.max(snapshot.chunkCount, 1),
    });
  }

  private speechActive(): boolean {
    return this.speechState !== null && this.speechState.state !== 'idle';
  }

  private hasNoProviders(): boolean {
    return !hasConfiguredProvider(MainConfigService.getInstance().getLLMProviders());
  }

  private updateVersion: string | null = null;

  private updateTrayMenu(): void {
    if (!this.tray) return;

    const setupEntry = this.hasNoProviders()
      ? [
          {
            label: TEXT.SETUP_TRAY_ITEM,
            click: () => {
              this.emit('open-setup');
            }
          },
        ]
      : [];

    const updateEntry =
      this.updateVersion !== null
        ? [
            {
              label: interpolate(TEXT.TRAY_UPDATE_AVAILABLE, { version: this.updateVersion }),
              click: () => {
                this.emit('open-about');
              }
            },
          ]
        : [];

    const contextMenu = Menu.buildFromTemplate([
      {
        label: TEXT.TRAY_SHOW,
        click: () => {
          this.emit('show-window');
        }
      },
      {
        label: TEXT.TRAY_HIDE,
        click: () => {
          this.emit('hide-window');
        }
      },
      {
        label: TEXT.HUB_TRAY_SHOW_HUB,
        click: () => {
          this.emit('show-hud');
        }
      },
      { type: 'separator' },
      {
        label: TEXT.TRAY_DESKTOP,
        click: () => {
          this.emit('open-desktop');
        }
      },
      {
        label: TEXT.TRAY_SETTINGS,
        click: () => {
          this.emit('open-settings');
        }
      },
      {
        label: TEXT.TRAY_CHECK_UPDATES,
        click: () => {
          this.emit('check-updates');
        }
      },
      ...updateEntry,
      ...setupEntry,
      { type: 'separator' },
      {
        label: TEXT.TRAY_SPEAK_CLIPBOARD,
        click: () => {
          this.emit('speak-clipboard');
        }
      },
      {
        label: this.speechState?.state === 'paused' ? TEXT.TRAY_RESUME_SPEAKING : TEXT.TRAY_PAUSE_SPEAKING,
        enabled: this.speechActive(),
        click: () => {
          this.emit('pause-speaking');
        }
      },
      {
        label: TEXT.TRAY_STOP_SPEAKING,
        enabled: this.speechActive(),
        click: () => {
          this.emit('stop-speaking');
        }
      },
      {
        label: TEXT.TRAY_REPLAY_LAST,
        enabled: this.speechReplayAvailable,
        click: () => {
          this.emit('replay-speaking');
        }
      },
      {
        label: TEXT.VOICE_SPEECH_HUD_STYLE,
        submenu: SPEECH_HUD_STYLES.map((style) => ({
          label: this.speechHudStyleLabel(style),
          type: 'radio' as const,
          checked: style === this.speechHudStyle(),
          click: () => {
            this.emit('set-hud-style', style);
          }
        }))
      },
      {
        label: TEXT.TRAY_START_LIVE,
        enabled: !this.liveRunning(),
        click: () => {
          this.emit('start-live');
        }
      },
      {
        label: TEXT.TRAY_END_LIVE,
        enabled: this.liveSessionExists(),
        click: () => {
          this.emit('end-live');
        }
      },
      { type: 'separator' },
      {
        label: TEXT.TRAY_QUIT,
        click: () => {
          this.emit('quit-app');
        }
      }
    ]);

    this.tray.setContextMenu(contextMenu);
  }

  public showNotification(title: string, body: string): void {
    if (this.tray) {
      this.tray.displayBalloon({
        title,
        content: body,
        icon: nativeImage.createFromPath(this.getTrayIconPath())
      });
    }
  }

    /** Remember the offered version so the context menu surfaces it until
   * the app catches up (plan 48 W5a amendment: updates are not hidden). */
  public setUpdateVersion(version: string | null): void {
    this.updateVersion = version;
    this.updateTrayMenu();
  }

  public setTrayIcon(iconPath: string): void {
    if (this.tray) {
        const icon = nativeImage.createFromPath(iconPath);
        // this.tray.setIcon(icon.resize({ width: 16, height: 16 }));
        this.tray.setImage(icon.resize({ width: 16, height: 16 }));
    }
    }

  public updateTrayTitle(title: string): void {
    if (this.tray) {
      this.tray.setTitle(title);
    }
  }

  /**
   * Unread warn/error badge (plan 42 S2). macOS renders a numeric title
   * beside the icon; Windows and Linux tray icons have no badge API, so
   * the count rides the tooltip there — degrade honestly, never fake one.
   */
  public setUnreadBadge(count: number): void {
    this.unreadBadge = Math.max(0, Math.floor(count));
    if (!this.tray) {
      return;
    }
    const suffix = this.unreadBadge > 0 ? ` — ${this.unreadBadge} unread` : '';
    this.tray.setToolTip(`${TEXT.TRAY_TOOLTIP}${suffix}`);
    if (process.platform === 'darwin') {
      this.tray.setTitle(this.unreadBadge > 0 ? String(this.unreadBadge) : '');
    }
  }

  public getUnreadBadge(): number {
    return this.unreadBadge;
  }

  /** What the current platform actually shows for the badge. */
  public static badgeSupport(platform: string = process.platform): { native: boolean; description: string } {
    return trayBadgeSupport(platform);
  }

  public destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
      this.isInitialized = false;
    }
  }
}

