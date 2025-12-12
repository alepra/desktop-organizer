const { app, BrowserWindow } = require("electron");
const path = require("path");
require(path.join(__dirname, "ipcHandlers"));

console.log("ELECTRON MAIN FILE LOADED");

let mainWindow = null;

function createWindow() {
  console.log("System reduced motion:", require("electron").nativeTheme.shouldUseReducedMotion);

  let win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      enableBlinkFeatures: "CSSAnimations,CSSTransitions",
      backgroundThrottling: false
    }
  });

  mainWindow = win;

  win.loadURL("http://localhost:53001");

  win.on("closed", () => {
  });
}

app.whenReady().then(() => {
  require("electron").app.commandLine.appendSwitch("disable-renderer-backgrounding");
  require("electron").nativeTheme.themeSource = "light";
  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});
