
const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let serverProcess;

function startServer() {
  // Start the Express server as a background process
  // In production, we point to the compiled server file
  const serverPath = path.join(__dirname, 'server.ts'); 
  
  // Note: For a real EXE, you'd use a bundled version of the server
  // This is a setup for running Electron in development/pre-build mode
  serverProcess = spawn('npx', ['tsx', serverPath], {
    env: { ...process.env, NODE_ENV: 'production' },
    shell: true
  });

  serverProcess.stdout.on('data', (data) => {
    console.log(`[Server]: ${data}`);
  });

  serverProcess.stderr.on('data', (data) => {
    console.error(`[Server Error]: ${data}`);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'DroidGrid Pro',
    backgroundColor: '#050505',
    icon: path.join(__dirname, 'public/icon.png'), // Future icon path
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  // Wait for server to be ready, then load
  // In a real app, we check health endpoint before loading
  setTimeout(() => {
    mainWindow.loadURL('http://localhost:3000');
  }, 3000);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('ready', () => {
  startServer();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (serverProcess) serverProcess.kill();
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
