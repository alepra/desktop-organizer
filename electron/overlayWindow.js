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
  // CRITICAL: Ensure ONLY ONE overlay window ever exists
  // If overlay exists and is not destroyed, reuse it
  if (overlayWindow) {
    if (overlayWindow.isDestroyed()) {
      // Window was destroyed externally, clear reference
      overlayWindow = null;
    } else {
      // Window exists and is valid - reuse it (idempotent)
      if (!overlayWindow.isVisible()) {
        overlayWindow.show();
      }
      return overlayWindow;
    }
  }
  
  // No valid overlay exists - create a new one

  // Create overlay at VIRTUAL SCREEN ORIGIN to match coordinate space
  // Compute full virtual screen bounds covering all displays ONCE
  const displays = screen.getAllDisplays();
  
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  
  displays.forEach(display => {
    const { x, y, width, height } = display.bounds;
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x + width);
    bottom = Math.max(bottom, y + height);
  });
  
  const width = right - left;
  const height = bottom - top;
  const x = left;
  const y = top;

  overlayWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    show: false,
    // Do NOT rely on fullscreen for positioning – we explicitly set x/y/width/height
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      // For testing-only overlay renderer, allow direct ipcRenderer access
      contextIsolation: false,
      nodeIntegration: true
    }
  });

  // Click-through - overlay must not interfere with desktop interaction
  overlayWindow.setIgnoreMouseEvents(true);

  // Log overlay bounds after creation (main process)
  console.log("[OVERLAY_BOUNDS]", overlayWindow.getBounds());

  // Load minimal HTML that renders halos at icon positions
  overlayWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          html, body {
            margin: 0;
            padding: 0;
            width: 100vw;
            height: 100vh;
            background: transparent;
            overflow: visible;
            transform: none;
          }
          #halo-root {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            margin: 0;
            padding: 0;
            overflow: visible;
            pointer-events: none;
            transform: none;
          }
          .halo {
            position: absolute;
            width: 120px;
            height: 120px;
            border-radius: 50%;
            border: 2px solid rgba(0, 150, 255, 0.8);
            background: transparent;
            pointer-events: none;
          }
        </style>
      </head>
      <body>
        <div id="halo-root"></div>
        <script>
          const { ipcRenderer } = require('electron');

          // Diagnostic log after mount
          document.addEventListener('DOMContentLoaded', () => {
            const haloRoot = document.getElementById('halo-root');
            if (haloRoot) {
              console.log("[HALO_ROOT_RECT]", haloRoot.getBoundingClientRect());
            }
          });

          function renderHalos(payload) {
            const root = document.getElementById('halo-root');
            if (!root) return;

            // Clear previous render
            root.innerHTML = '';

            if (!payload || !payload.icons || !Array.isArray(payload.icons)) {
              return;
            }

            const { icons, bounds } = payload;

            if (!bounds) {
              return;
            }

            // Use overlay bounds as the only coordinate space
            const overlayBounds = bounds;

            // DPI normalization: Native helper reports ListView DPI = 120, renderer uses 96-DPI CSS pixels
            const listViewDPI = 120;
            const scaleFactor = listViewDPI / 96;

            // Coordinate-space diagnostic logs
            const screenX = window.screenX;
            const screenY = window.screenY;
            const innerWidth = window.innerWidth;
            const innerHeight = window.innerHeight;
            const devicePixelRatio = window.devicePixelRatio;
            const rootRect = root.getBoundingClientRect();

            // Calculate icon coordinate ranges (before DPI normalization for diagnostic)
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;

            icons.forEach((icon) => {
              if (typeof icon.x === 'number' && typeof icon.y === 'number') {
                minX = Math.min(minX, icon.x);
                minY = Math.min(minY, icon.y);
                maxX = Math.max(maxX, icon.x);
                maxY = Math.max(maxY, icon.y);
              }
            });

            // Sample icon for DPI diagnostic log
            const sampleIcon = icons.find(icon => typeof icon.x === 'number' && typeof icon.y === 'number');
            const sampleNative = sampleIcon ? { x: sampleIcon.x, y: sampleIcon.y } : null;
            const sampleCSS = sampleIcon ? { x: sampleIcon.x / scaleFactor, y: sampleIcon.y / scaleFactor } : null;

            // DPI normalization diagnostic log
            console.log("[DPI_FIX]", { listViewDPI: listViewDPI, scaleFactor: scaleFactor, sampleNative: sampleNative, sampleCSS: sampleCSS });

            // Log coordinate-space report
            console.log("screenX=" + screenX + " screenY=" + screenY + " innerWxH=" + innerWidth + "x" + innerHeight + " dpr=" + devicePixelRatio + " rootRect=" + rootRect.left + "," + rootRect.top + "," + rootRect.width + "," + rootRect.height + " iconsRange=" + minX + "," + minY + ".." + maxX + "," + maxY);

            // Render halos for ALL icons
            icons.forEach((icon, iconIndex) => {
              // Guard: skip icons with missing coordinates
              if (typeof icon.x !== 'number' || typeof icon.y !== 'number') {
                return;
              }

              // DPI normalization: Convert native coordinates to CSS pixel coordinates
              const cssX = icon.x / scaleFactor;
              const cssY = icon.y / scaleFactor;

              // Convert CSS pixel coordinates to overlay-local coordinates
              // screenX = cssX - virtualBounds.left
              // screenY = cssY - virtualBounds.top
              const screenX = cssX - overlayBounds.x;
              const screenY = cssY - overlayBounds.y;

              // Circle with diameter 120px, radius 60px
              const RADIUS = 60;

              // Position halo centered on icon
              const haloX = screenX - RADIUS;
              const haloY = screenY - RADIUS;

              // Create halo div
              const halo = document.createElement('div');
              halo.className = 'halo';
              halo.style.left = haloX + 'px';
              halo.style.top = haloY + 'px';
              halo.style.width = '120px';
              halo.style.height = '120px';
              halo.style.borderRadius = '50%';
              root.appendChild(halo);
            });
          }

          // Listen for render-halos event
          ipcRenderer.on('render-halos', (_event, payload) => {
            renderHalos(payload);
          });
        </script>
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

function updateOverlayHalos(iconPositions) {
  const win = createOverlayWindow();
  if (!win) return;
  // Send only the first icon if array is not empty
  const iconsToSend = Array.isArray(iconPositions) && iconPositions.length > 0 ? [iconPositions[0]] : [];
  win.webContents.send("update-halos", iconsToSend);
}

function showOverlayWithIcons(iconPositions) {
  // Ensure overlay window exists
  const win = createOverlayWindow();
  if (!win) return;

  // Get all displays to compute virtual screen bounds
  const allDisplays = screen.getAllDisplays();
  
  // Compute virtual bounds across all displays
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  allDisplays.forEach(display => {
    const { x, y, width, height } = display.bounds;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  });

  const virtualBounds = {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };

  // Overlay window is already created at virtual origin, no need to resize
  // Show the overlay window
  win.show();

  // Prepare display info with scale factors
  const displays = allDisplays.map(d => ({
    bounds: d.bounds,
    scaleFactor: d.scaleFactor
  }));

  // Send icon positions, bounds, and display info to renderer
  const payload = {
    icons: Array.isArray(iconPositions) ? iconPositions : [],
    bounds: virtualBounds,
    displays: displays
  };

  win.webContents.send("render-halos", payload);
}

module.exports = { createOverlayWindow, destroyOverlayWindow, hideOverlayWindow, updateOverlayHalos, showOverlayWithIcons };