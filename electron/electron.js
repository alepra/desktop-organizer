const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const { registerHandlers } = require('./ipcHandlers');

let mainWindow;

const devUrl = "http://localhost:51234";

// Wait for Vite server with retries
async function waitForVite(maxRetries = 20) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const found = await new Promise((resolve, reject) => {
        const req = http.get(devUrl, (res) => {
          // Check if it's actually Vite (should return HTML or have vite headers)
          if (res.statusCode === 200 || res.statusCode === 304) {
            resolve(true);
          } else {
            reject(new Error(`Server responded with status ${res.statusCode}`));
          }
        });
        req.on('error', () => reject());
        req.setTimeout(500, () => {
          req.destroy();
          reject(new Error('Timeout'));
        });
      });
      if (found) {
        return devUrl;
      }
    } catch (e) {
      // Continue retrying
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Vite server not found after retries');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Load from Vite dev server in development, or from built files in production
  if (!app.isPackaged) {
    waitForVite()
      .then(url => {
        console.log(`Loading Vite dev server at ${url}`);
        mainWindow.loadURL(url);
      })
      .catch(err => {
        console.error('Failed to find Vite dev server:', err);
        console.log(`Trying ${devUrl} directly...`);
        mainWindow.loadURL(devUrl);
      });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Open DevTools in development mode only
  // if (!app.isPackaged) {
  //   mainWindow.webContents.openDevTools();
  // }
}

app.whenReady().then(() => {
  // Register IPC handlers
  registerHandlers(ipcMain);
  
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
