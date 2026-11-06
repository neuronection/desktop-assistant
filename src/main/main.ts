import { app, BrowserWindow, shell} from 'electron';
import { loadEnvFile } from '@main/loadEnv';
import { DesktopAssistant } from '@main/DesktopAssistant';
import { verifyRendererBridge, verifyProviderCatalog, reportSmoke } from '@main/smoke';
import { registerSpeechCacheScheme } from '@main/services/SpeechCacheProtocol';
import { applyDemoDataDir, isDemoLaunch } from '@main/demo';
import { installCrashHandlers } from '@main/crash';
import { resolvePermissionRequest } from '@main/security/permissions';

installCrashHandlers();

// `.env` must reach `process.env` before anything reads it (the calendar
// client ids live there). An already-set env var always wins.
loadEnvFile();

// Privileged custom schemes must be declared before the ready event; the
// speech-cache handler itself is bound during initialization.
registerSpeechCacheScheme();

// CI packaged-bundle smoke mode: boot, prove readiness, exit 0.
const SMOKE = process.argv.includes('--smoke');
// Demo mode (family identity-auth §13, Class L content-only): must run
// before any service resolves paths, so the whole workspace (config,
// database, secrets, tool results) lands in the isolated demo data dir.
const DEMO = isDemoLaunch(process.argv);
if (DEMO) {
  applyDemoDataDir(process.argv);
}

if (process.env.DESKTOP_ASSISTANT_DISABLE_GPU === '1') {
  app.disableHardwareAcceleration();
}

// Initialize the application
const desktopAssistant = new DesktopAssistant();

// Handle app ready event
app.whenReady().then(async () => {
  await desktopAssistant.initialize();
  if (SMOKE) {
    const initError = desktopAssistant.getInitializationError();
    if (initError) {
      const message = initError instanceof Error ? initError.message : String(initError);
      await reportSmoke(`SMOKE_INIT_FAILED: ${message}`, process.stderr);
      app.exit(1);
      return;
    }
    // Initialization completed: config, database, windows, tray and
    // hotkeys are up. A packaged renderer must ALSO carry the preload
    // bridge — a sandboxed preload that requires anything but electron
    // leaves window.electronAPI undefined. Dev runs use sandbox: false,
    // so the probe is meaningful only in the frozen bundle.
    await reportSmoke('SMOKE_OK');
    const catalog = verifyProviderCatalog();
    if (catalog !== 'ok') {
      await reportSmoke(`SMOKE_CATALOG_FAILED: ${catalog}`, process.stderr);
      app.exit(1);
      return;
    }
    await reportSmoke('SMOKE_CATALOG_OK');
    if (app.isPackaged) {
      const bridge = await verifyRendererBridge();
      if (bridge !== 'ok') {
        await reportSmoke(`SMOKE_BRIDGE_FAILED: ${bridge}`, process.stderr);
        app.exit(1);
        return;
      }
      await reportSmoke('SMOKE_BRIDGE_OK');
    }
    app.exit(0);
  }
});

// Handle second instance (single instance lock)
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Someone tried to run a second instance, focus our window instead
    const mainWindow = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('index.html'));
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });
}
  
// Security: Control window creation and navigation
app.on('web-contents-created', (_, contents) => {
  // Modern way to handle window opening (replaces the older 'new-window' event)
  contents.setWindowOpenHandler(({ url }) => {
    console.log(`Window open requested: ${url}`);
    
    // Allow opening external URLs in default browser
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url).catch(err => {
        console.error('Failed to open external URL:', err);
      });
    }
    
    // Always deny creating new electron windows
    return { action: 'deny' };
  });

  // Prevent navigation away from our app
  contents.on('will-navigate', (event, navigationUrl) => {
    try {
      const parsedUrl = new URL(navigationUrl);
      
      // Allow navigation patterns based on environment
      const allowedPatterns = process.env.NODE_ENV === 'development' 
        ? ['localhost', '127.0.0.1', 'file:']
        : ['file:'];
      
      const isAllowed = allowedPatterns.some(pattern => 
        navigationUrl.includes(pattern) || parsedUrl.protocol === 'file:'
      );
      
      if (!isAllowed) {
        console.log(`Blocked navigation to: ${navigationUrl}`);
        event.preventDefault();
      }
    } catch (error) {
      console.error('Error parsing navigation URL:', error);
      event.preventDefault();
    }
  });

  // Permission matrix (plan 46 S1): microphone only, on the app origin —
  // camera-carrying media requests and every other permission are denied.
  contents.session.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const decision = resolvePermissionRequest({
      url: contents.getURL(),
      permission,
      mediaTypes: 'mediaTypes' in details ? (details.mediaTypes as readonly string[]) : undefined,
      isDev: process.env.NODE_ENV === 'development',
    });
    callback(decision === 'granted');
  });
  contents.session.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return resolvePermissionRequest({
      url: requestingOrigin,
      permission,
      isDev: process.env.NODE_ENV === 'development',
    }) === 'granted';
  });

  // Additional security headers and CSP
  contents.on('did-finish-load', () => {
    if (process.env.NODE_ENV === 'development') {
      // In development, allow some flexibility
      contents.executeJavaScript(`
        if (!window.process) {
          console.log('Security: Node integration properly disabled');
        }
      `);
    }
  });
});

// Handle certificate errors in development
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  if (process.env.NODE_ENV === 'development') {
    // In development, ignore certificate errors for localhost
    if (url.startsWith('https://localhost') || url.startsWith('https://127.0.0.1')) {
      event.preventDefault();
      callback(true);
      return;
    }
  }
  
  // In production, always validate certificates
  callback(false);
});

// Disable experimental features that could pose security risks
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');

export default desktopAssistant;