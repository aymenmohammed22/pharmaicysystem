import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
const SERVER_PORT = 3399;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function checkServerHealth(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/api/bootstrap`, (res) => {
      resolve(res.statusCode === 200 || res.statusCode === 401);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(port: number, maxAttempts = 35): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    const ok = await checkServerHealth(port);
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 600));
  }
  return false;
}

function startLocalServer() {
  const userDataPath = app.getPath('userData');
  const appPath = app.getAppPath();
  const serverEntry = path.join(appPath, 'server.ts');

  serverProcess = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      PORT: String(SERVER_PORT),
      NODE_ENV: 'production',
      OMNI_USER_DATA_DIR: userDataPath,
    },
    stdio: 'inherit',
  });

  serverProcess.on('error', (err) => {
    console.error('Failed to start local Express server process:', err);
  });
}

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 480,
    height: 300,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  splashWindow.loadURL(`data:text/html;charset=utf-8,
    <html>
      <body style="margin:0; font-family:system-ui, sans-serif; background:linear-gradient(135deg, %23071D3B, %230B4F9C); color:white; display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; border-radius:16px; border:2px solid %23F97316;">
        <h2 style="margin:0 0 6px; font-size:22px; font-weight:900;">Omni Pharmacy System</h2>
        <p style="margin:0 0 16px; font-size:13px; color:%23BAE6FD;">إتقان سوفت · itQAN Soft</p>
        <div style="font-size:13px; font-weight:bold; background:rgba(255,255,255,0.18); padding:8px 18px; border-radius:8px; border:1px solid rgba(255,255,255,0.3);">جاري تهيئة قاعدة البيانات المحلية والخادم الآمن...</div>
      </body>
    </html>
  `);
}

async function createWindow() {
  createSplashWindow();
  startLocalServer();

  const serverReady = await waitForServer(SERVER_PORT);
  if (!serverReady) {
    if (splashWindow) {
      splashWindow.close();
      splashWindow = null;
    }
    dialog.showErrorBox(
      'خطأ في تشغيل الخادم المحلي',
      'تعذر بدء خادم النظام المحلي ضمن الوقت المخصص. يرجى إعادة تشغيل التطبيق.',
    );
    app.quit();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0F1F38',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.loadURL(`http://localhost:${SERVER_PORT}`);

  mainWindow.once('ready-to-show', () => {
    if (splashWindow) {
      splashWindow.close();
      splashWindow = null;
    }
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});

ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('show-notification', (_evt, { title, body }) => {
  return true;
});
