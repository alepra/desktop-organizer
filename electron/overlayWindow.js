const { BrowserWindow, screen } = require("electron");
const path = require("path");

let overlayWindow = null;

function destroyOverlayWindow() {
  if (overlayWindow) {
    overlayWindow.destroy();
    overlayWindow = null;
  }
}

function createOverlayWindow() {
  // If overlay already exists and is visible, just show it (don't recreate)
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    if (!overlayWindow.isVisible()) {
      overlayWindow.show();
    }
    return overlayWindow;
  }
  
  // Destroy any existing overlay before creating a new one
  if (overlayWindow) {
    destroyOverlayWindow();
  }

  const { width, height } = screen.getPrimaryDisplay().bounds;

  overlayWindow = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    fullscreen: true,
    alwaysOnTop: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Click-through - overlay must not interfere with desktop interaction
  overlayWindow.setIgnoreMouseEvents(true);

  // Load minimal HTML with ONE visible blue halo at fixed position (300px, 300px)
  overlayWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          html, body {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            background: transparent;
            overflow: hidden;
          }
          .halo {
            position: absolute;
            left: 300px;
            top: 300px;
            width: 100px;
            height: 100px;
            border-radius: 50%;
            border: 4px solid #3b82f6;
            box-shadow: 0 0 20px rgba(59, 130, 246, 0.8), 0 0 40px rgba(59, 130, 246, 0.5);
            pointer-events: none;
          }
        </style>
      </head>
      <body>
        <div class="halo"></div>
      </body>
    </html>
  `));

  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });

  return overlayWindow;
}

function hideOverlayWindow() {
  if (overlayWindow && overlayWindow.isVisible()) {
    overlayWindow.hide();
  }
}

module.exports = { createOverlayWindow, destroyOverlayWindow, hideOverlayWindow };