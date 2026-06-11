/**
 * DroidGrid Pro — Electron main process
 * Starts Express backend, waits for health endpoint, then opens window.
 */
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

let mainWindow;
let serverProcess = null;
const SERVER_PORT = process.env.DROIDGRID_PORT || 3000;
const STARTUP_TIMEOUT_MS = 30_000;

function resolveServerCommand() {
  const root = __dirname;
  // 1. Compiled output (production / packaged)
  const compiled = path.join(root, 'dist', 'server.js');
  if (fs.existsSync(compiled)) {
    return { cmd: process.execPath, args: [compiled], label: 'node dist/server.js' };
  }
  // 2. Local tsx binary (dev — bundled dependency)
  const tsxBin = path.join(
    root, 'node_modules', '.bin',
    process.platform === 'win32' ? 'tsx.cmd' : 'tsx'
  );
  if (fs.existsSync(tsxBin)) {
    return { cmd: tsxBin, args: [path.join(root, 'server.ts')], label: 'tsx server.ts' };
  }
  // 3. tsx via its JS entry (when .bin shims break)
  const tsxCli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  if (fs.existsSync(tsxCli)) {
    return { cmd: process.execPath, args: [tsxCli, path.join(root, 'server.ts')], label: 'node tsx/cli.mjs' };
  }
  return null;
}

function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(
        { host: '127.0.0.1', port: SERVER_PORT, path: '/api/health', timeout: 2000 },
        (res) => {
          res.resume();
          if (res.statusCode === 200) return resolve();
          retry();
        }
      );
      req.on('error', retry);
      req.on('timeout', () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() > deadline) return reject(new Error('Server did not become healthy in time'));
      setTimeout(tick, 500);
    };
    tick();
  });
}

function startServer() {
  const resolved = resolveServerCommand();
  if (!resolved) {
    throw new Error(
      'Cannot start backend: no dist/server.js and no local tsx found.\n' +
      'Run `npm run build` or `npm install` in DroidGrid Pro/.'
    );
  }
  console.log(`[electron] starting backend via: ${resolved.label}`);
  serverProcess = spawn(resolved.cmd, resolved.args, {
    cwd: __dirname,
    env: { ...process.env, PORT: String(SERVER_PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProcess.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
  serverProcess.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  serverProcess.on('exit', (code) => {
    console.error(`[electron] backend exited with code ${code}`);
    serverProcess = null;
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
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

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  try {
    startServer();
    console.log('[electron] Waiting for backend...');
    await waitForServer(STARTUP_TIMEOUT_MS);
    console.log('[electron] Backend ready — loading UI');
    await mainWindow.loadURL(`http://127.0.0.1:${SERVER_PORT}`);
  } catch (err) {
    console.error('[electron] Backend never started:', err.message);
    await mainWindow.loadURL(
      'data:text/html;charset=utf-8,' +
      encodeURIComponent(`<body style="background:#111;color:#eee;font-family:sans-serif;padding:2rem">
        <h2 style="color:#f44">DROIDGRIDD failed to start</h2>
        <pre style="color:#aaa">${String(err.message || err)}</pre>
        <p>Make sure dependencies are installed: <code>npm install</code></p>
      </body>`)
    );
  }
}

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (serverProcess) serverProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (serverProcess) serverProcess.kill();
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
});
