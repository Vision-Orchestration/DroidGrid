/**
 * DroidGrid Pro — Electron main process
 * Starts Express backend, waits for health endpoint, then opens window.
 */
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

let mainWindow;
let serverProcess;

function waitForServer(url, retries, delay, cb) {
  http.get(url, (res) => {
    if (res.statusCode === 200) return cb(null);
    retry();
  }).on('error', () => retry());

  function retry() {
    if (retries <= 0) return cb(new Error('Server never became ready'));
    setTimeout(() => waitForServer(url, retries - 1, delay, cb), delay);
  }
}

function startBackend() {
  const serverScript = path.join(__dirname, 'server.ts');
  serverProcess = spawn('npx', ['tsx', serverScript], {
    env: { ...process.env, NODE_ENV: 'production' },
    shell: true,
    cwd: __dirname,
  });
  serverProcess.stdout.on('data', d => process.stdout.write(`[server] ${d}`));
  serverProcess.stderr.on('data', d => process.stderr.write(`[server:err] ${d}`));
  serverProcess.on('exit', code => console.log(`[server] exited ${code}`));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'DroidGrid Pro',
    backgroundColor: '#0f0f13',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Wait until backend is ready
  console.log('[electron] Waiting for backend...');
  waitForServer('http://localhost:3000/api/health', 30, 500, (err) => {
    if (err) {
      console.error('[electron] Backend never started:', err.message);
      mainWindow.loadURL(`data:text/html,<h1 style="color:white;font-family:monospace;padding:2rem">Backend failed to start.<br>Run: npm run dev</h1>`);
      return;
    }
    console.log('[electron] Backend ready — loading UI');
    mainWindow.loadURL('http://localhost:3000');
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.on('ready', () => {
  startBackend();
  createWindow();
});

app.on('window-all-closed', () => {
  if (serverProcess) serverProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
});
