const { app, BrowserWindow } = require("electron");
const path = require("path");

// IPC handlers MUST be registered
require("./ipcHandlers");

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: "#ffffff",
    show: true,
    webPreferences: {
      // ✅ preload is inside /electron
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadURL("http://localhost:53001");

  // Safety: show window even if ready event is skipped
  win.on("ready-to-show", () => win.show());
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
