const { ipcMain, screen } = require("electron");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync, execFile } = require("child_process");
const { updateOverlayHalos } = require("./overlayWindow");

// Load native addon for desktop icon positions
let desktopIconsAddon = null;
try {
  desktopIconsAddon = require(path.join(__dirname, "..", "native-helper", "build", "Release", "desktop_icons.node"));
} catch (error) {
  console.error("[NATIVE] Failed to load desktop_icons native addon:", error.message);
  console.error("[NATIVE] Make sure to run: npm run rebuild-native");
}

/**
 * Protected organizer metadata paths
 */
const DESKTOP_PATH = "C:\\Users\\alepr\\OneDrive\\Desktop";
const PROTECTED_FOLDER = path.join(DESKTOP_PATH, ".desktop");
const BASELINE_PATH = path.join(PROTECTED_FOLDER, ".desktop_organizer_baseline.json");
const HISTORY_PATH = path.join(PROTECTED_FOLDER, ".desktop_organizer_history.json");

/**
 * Check if a file or folder is protected organizer metadata
 */
function isProtectedItem(itemPath, itemName) {
  const normalizedPath = itemPath.replace(/\\/g, '/').toLowerCase();
  const normalizedDesktop = DESKTOP_PATH.replace(/\\/g, '/').toLowerCase();
  const normalizedProtected = PROTECTED_FOLDER.replace(/\\/g, '/').toLowerCase();
  
  // Check if path is inside .desktop folder
  if (normalizedPath.startsWith(normalizedProtected + '/') || normalizedPath === normalizedProtected) {
    return true;
  }
  
  // Check if basename is a protected file
  if (itemName === '.desktop_organizer_baseline.json' || 
      itemName === '.desktop_organizer_history.json') {
    return true;
  }
  
  return false;
}

ipcMain.handle("scan-desktop", async () => {
  // Use canonical desktop path ONLY - no fallbacks, no platform detection
  const canonicalDesktopPath = DESKTOP_PATH;
  
  // Verify canonical path exists
  if (!fs.existsSync(canonicalDesktopPath)) {
    console.error(`Desktop scan failed: Canonical desktop path does not exist: ${canonicalDesktopPath}`);
    return [{ name: "Desktop not found", path: "" }];
  }
  
  try {
    // Read directory entries with file type information
    // withFileTypes: true ensures we get Dirent objects with isDirectory() and isFile() methods
    const entries = fs.readdirSync(canonicalDesktopPath, { withFileTypes: true });
    
    // Process ALL entries - files and folders
    const items = [];
    let filesCount = 0;
    let foldersCount = 0;
    
    for (const entry of entries) {
      const itemPath = path.join(canonicalDesktopPath, entry.name);
      const itemName = entry.name;
      
      // 🚨 PROTECTED EXCLUSIONS: Only exclude protected organizer metadata
      if (isProtectedItem(itemPath, itemName)) {
        continue; // Skip protected items
      }
      
      // Determine if entry is a directory or file using Dirent methods
      // isDirectory() returns true for directories, false for files (including .lnk, .url.lnk, etc.)
      const isDir = entry.isDirectory();
      
      // Build absolute path (full path)
      const absolutePath = path.resolve(itemPath);
      
      // Extract extension for files only (not for folders)
      let extension = undefined;
      if (!isDir) {
        const lastDot = itemName.lastIndexOf('.');
        extension = lastDot >= 0 ? itemName.substring(lastDot) : '';
      }
      
      // Create item object with required fields
      const item = {
        name: itemName,
        type: isDir ? "folder" : "file",
        path: absolutePath,
        absolutePath: absolutePath,
        isDirectory: isDir,
        extension: extension
      };
      
      items.push(item);
      
      // Count for diagnostic logging
      if (isDir) {
        foldersCount++;
      } else {
        filesCount++;
      }
    }
    
    // Log total items scanned (after filtering)
    // X MUST equal (files + folders) per diagnostic guarantee
    console.log(`Desktop scan completed: ${items.length} items scanned (protected items excluded)`);
    console.log(`  Canonical Desktop Path: ${canonicalDesktopPath}`);
    
    return items;
  } catch (error) {
    console.error(`Desktop scan failed: ${error.message}`);
    return [{ name: "Desktop scan error", path: "", error: error.message }];
  }
});

/**
 * Get Desktop ListView window rectangle in SCREEN coordinates using PowerShell.
 * Returns { left, top, right, bottom } or null on error.
 */
function getDesktopListViewRect() {
  try {
    // Write PowerShell script to temp file to avoid escaping issues
    const psScriptPath = path.join(os.tmpdir(), `get-listview-rect-${Date.now()}.ps1`);
    const psScript = `Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public class Win32 {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
  
  [DllImport("user32.dll", SetLastError = true)]
  public static extern IntPtr FindWindowEx(IntPtr hwndParent, IntPtr hwndChildAfter, string lpszClass, string lpszWindow);
  
  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }
}
'@
$progman = [Win32]::FindWindow("Progman", $null)
if ($progman -eq [IntPtr]::Zero) {
  Write-Output "null"
  exit
}
$shell = [Win32]::FindWindowEx($progman, [IntPtr]::Zero, "SHELLDLL_DefView", $null)
if ($shell -eq [IntPtr]::Zero) {
  Write-Output "null"
  exit
}
$listView = [Win32]::FindWindowEx($shell, [IntPtr]::Zero, "SysListView32", $null)
if ($listView -eq [IntPtr]::Zero) {
  Write-Output "null"
  exit
}
$rect = New-Object Win32+RECT
if ([Win32]::GetWindowRect($listView, [ref]$rect)) {
  $result = @{
    left = $rect.Left
    top = $rect.Top
    right = $rect.Right
    bottom = $rect.Bottom
  } | ConvertTo-Json -Compress
  Write-Output $result
} else {
  Write-Output "null"
}`;

    fs.writeFileSync(psScriptPath, psScript, 'utf8');

    const result = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psScriptPath}"`, {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();

    // Clean up temp file
    try {
      fs.unlinkSync(psScriptPath);
    } catch (e) {
      // Ignore cleanup errors
    }

    if (!result || result === 'null') {
      console.warn("[HALO] Could not retrieve Desktop ListView window rectangle");
      return null;
    }

    const rect = JSON.parse(result);
    return rect;
  } catch (error) {
    console.error("[HALO] Failed to get Desktop ListView rectangle:", error.message);
    return null;
  }
}

/**
 * Approximate desktop icon positions in SCREEN coordinates.
 * NOTE: This is a grid-based approximation for testing only.
 * Reading real Explorer ListView icon positions requires native interop.
 * 
 * CRITICAL: Icon coordinates are in DESKTOP LISTVIEW CLIENT COORDINATES.
 * Must translate to SCREEN coordinates by adding ListView window rectangle offset.
 */
async function getDesktopIconPositionsApprox() {
  try {
    const desktopPath = DESKTOP_PATH;
    if (!fs.existsSync(desktopPath)) {
      console.warn("[HALO] Desktop path does not exist for icon positions:", desktopPath);
      return [];
    }

    // Get Desktop ListView window rectangle in LOGICAL SCREEN coordinates
    let listViewRect = getDesktopListViewRect();

    // Get DPI scale factor and bounds for primary display
    const primaryDisplay = screen.getPrimaryDisplay();
    const { scaleFactor, bounds } = primaryDisplay;

    if (!listViewRect) {
      // Fallback to workArea if ListView rect unavailable
      const workArea = primaryDisplay.workArea;
      console.warn("[HALO] Using workArea fallback for ListView origin");
      listViewRect = {
        left: workArea.x + 12,
        top: workArea.y + 12,
        right: workArea.x + workArea.width,
        bottom: workArea.y + workArea.height
      };
    }

    const entries = fs.readdirSync(desktopPath, { withFileTypes: true });
    const icons = [];

    // Desktop icon spacing (typical Windows desktop values)
    const ICON_SPACING_X = 120; // Horizontal spacing between icons
    const ICON_SPACING_Y = 110; // Vertical spacing between icons
    const listViewWidth = listViewRect.right - listViewRect.left;
    const MAX_COLUMNS = Math.floor((listViewWidth - 24) / ICON_SPACING_X);

    let index = 0;
    for (const entry of entries) {
      const itemPath = path.join(desktopPath, entry.name);

      // Skip protected organizer metadata
      if (isProtectedItem(itemPath, entry.name)) {
        continue;
      }

      // Calculate grid position (ListView CLIENT coordinates)
      const col = index % MAX_COLUMNS;
      const row = Math.floor(index / MAX_COLUMNS);
      const iconX = col * ICON_SPACING_X + 12; // Client X with padding
      const iconY = row * ICON_SPACING_Y + 12; // Client Y with padding

      // CRITICAL: Translate ListView CLIENT coordinates (logical) to PHYSICAL SCREEN coordinates
      // logicalScreenX = listViewRect.left + iconX
      // logicalScreenY = listViewRect.top + iconY
      // physicalX = logicalScreenX * scaleFactor
      // physicalY = logicalScreenY * scaleFactor
      const logicalScreenX = listViewRect.left + iconX;
      const logicalScreenY = listViewRect.top + iconY;
      const physicalScreenX = logicalScreenX * scaleFactor;
      const physicalScreenY = logicalScreenY * scaleFactor;

      // Align with overlay window origin: convert to OVERLAY-LOCAL coordinates
      // Overlay window is created at primaryDisplay.bounds.{x,y}.
      // localX = physicalScreenX - bounds.x * scaleFactor
      // localY = physicalScreenY - bounds.y * scaleFactor
      const localX = physicalScreenX - bounds.x * scaleFactor;
      const localY = physicalScreenY - bounds.y * scaleFactor;

      icons.push({
        name: entry.name,
        x: localX,
        y: localY
      });

      index++;
    }

    return icons;
  } catch (error) {
    console.error("[HALO] Failed to generate desktop icon positions (approx):", error);
    return [];
  }
}

// IPC: get REAL desktop icon positions from native helper EXE
ipcMain.handle("get-desktop-icon-positions", async () => {
  try {
    // Find native helper EXE (published self-contained executable)
    const repoRoot = path.join(__dirname, "..");
    const nativeHelperDir = path.join(repoRoot, "native-helper");
    const exePath = path.join(nativeHelperDir, "bin", "Release", "net8.0", "win-x64", "IconPositionHelper.exe");
    
    if (!fs.existsSync(exePath)) {
      console.error("[NATIVE] IconPositionHelper.exe not found at:", exePath);
      console.error("[NATIVE] Run 'npm run publish-helper' to build the self-contained EXE.");
      return [];
    }

    // Run native helper EXE directly and capture STDOUT
    return new Promise((resolve, reject) => {
      execFile(exePath, [], {
        maxBuffer: 1024 * 1024, // 1MB buffer for JSON output
        timeout: 10000 // 10 second timeout
      }, (error, stdout, stderr) => {
        if (error) {
          console.error("[NATIVE] Native helper execution failed:", error.message);
          if (stderr) {
            console.error("[NATIVE] STDERR:", stderr);
          }
          resolve([]);
          return;
        }

        // Log STDERR diagnostics (but don't fail on them)
        if (stderr) {
          console.log("[NATIVE] Helper diagnostics:", stderr.trim());
        }

        // Parse JSON from STDOUT
        try {
          const data = JSON.parse(stdout.trim());
          
          // Handle both old format (array) and new format (object with icons and desktopBounds)
          let icons = [];
          let desktopBounds = null;
          
          if (Array.isArray(data)) {
            // Old format: just array of icons
            icons = data;
          } else if (data && Array.isArray(data.icons)) {
            // New format: object with icons and desktopBounds
            icons = data.icons;
            desktopBounds = data.desktopBounds || null;
          } else {
            console.error("[NATIVE] Native helper returned invalid format:", typeof data);
            resolve([]);
            return;
          }
          
          console.log(`[NATIVE] Retrieved ${icons.length} icon positions from native helper`);
          if (desktopBounds) {
            console.log(`[NATIVE] Desktop bounds: x=${desktopBounds.x}, y=${desktopBounds.y}, width=${desktopBounds.width}, height=${desktopBounds.height}`);
          }
          
          // DPI scaling diagnostics
          const primary = screen.getPrimaryDisplay();
          console.log("[DPI_DIAG]", {
            scaleFactor: primary.scaleFactor,
            displayBounds: primary.bounds,
            workArea: primary.workArea
          });
          
          // Show overlay with icons
          const { showOverlayWithIcons } = require("./overlayWindow");
          showOverlayWithIcons(icons);
          
          resolve(icons);
        } catch (parseError) {
          console.error("[NATIVE] Failed to parse JSON from native helper:", parseError.message);
          console.error("[NATIVE] STDOUT was:", stdout.substring(0, 200));
          resolve([]);
        }
      });
    });
  } catch (error) {
    console.error("[NATIVE] get-desktop-icon-positions failed:", error);
    return [];
  }
});

// IPC: get-desktop-icons-native (diagnostic test handler)
ipcMain.handle("get-desktop-icons-native", async () => {
  try {
    if (!desktopIconsAddon) {
      console.error("[NATIVE] Native addon not loaded");
      return [];
    }

    const icons = desktopIconsAddon.getDesktopIcons();
    console.log(`Native icon count: ${icons.length}`);
    if (icons.length > 0) {
      console.log("First 3 icons:");
      icons.slice(0, 3).forEach((icon, idx) => {
        console.log(`  [${idx}] name="${icon.name}", x=${icon.x}, y=${icon.y}`);
      });
    }
    return icons;
  } catch (error) {
    console.error("[NATIVE] get-desktop-icons-native failed:", error);
    return [];
  }
});

ipcMain.handle("create-folder", async (event, folderPath) => {
  try {
    // Create directory recursively (mkdir -p equivalent)
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
      return { success: true, message: `Folder created: ${folderPath}` };
    } else {
      return { success: true, message: `Folder already exists: ${folderPath}` };
    }
  } catch (error) {
    return { success: false, message: `Failed to create folder ${folderPath}: ${error.message}` };
  }
});

ipcMain.handle("is-directory", async (event, filePath) => {
  try {
    const stats = fs.statSync(filePath);
    return { isDirectory: stats.isDirectory() };
  } catch (error) {
    return { isDirectory: false, error: error.message };
  }
});

ipcMain.handle("move-file", async (event, sourcePath, destinationPath) => {
  try {
    // Ensure destination directory exists
    const destDir = path.dirname(destinationPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    
    // Move the file
    fs.renameSync(sourcePath, destinationPath);
    return { success: true, message: `File moved: ${sourcePath} -> ${destinationPath}` };
  } catch (error) {
    return { success: false, message: `Failed to move file ${sourcePath} to ${destinationPath}: ${error.message}` };
  }
});

ipcMain.handle("save-baseline-snapshot", async (event, desktopPath) => {
  try {
    // Ensure protected folder exists
    if (!fs.existsSync(PROTECTED_FOLDER)) {
      fs.mkdirSync(PROTECTED_FOLDER, { recursive: true });
      console.log(`Created protected folder: ${PROTECTED_FOLDER}`);
    }
    
    const snapshot = [];
    
    // Scan desktop directory for all items (files and folders)
    // EXCLUDE protected items from snapshot
    const entries = fs.readdirSync(desktopPath, { withFileTypes: true });
    
    for (const entry of entries) {
      // Skip protected organizer metadata
      if (isProtectedItem(path.join(desktopPath, entry.name), entry.name)) {
        continue;
      }
      
      const absolutePath = path.join(desktopPath, entry.name);
      snapshot.push({
        absolutePath: absolutePath,
        filename: entry.name,
        isFile: entry.isFile(),
        isFolder: entry.isDirectory()
      });
    }
    
    // Sort snapshot for deterministic ordering
    snapshot.sort((a, b) => a.absolutePath.localeCompare(b.absolutePath));
    
    // Save snapshot to protected location
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(snapshot, null, 2), 'utf8');
    
    console.log(`Baseline snapshot saved to: ${BASELINE_PATH}`);
    return { success: true, message: 'Baseline snapshot saved', itemCount: snapshot.length };
  } catch (error) {
    return { success: false, message: `Failed to save baseline snapshot: ${error.message}` };
  }
});

// Authoritative desktop restore - filesystem level only
const { restoreDesktop } = require("./executor.js");

ipcMain.handle("restoreDesktop", async () => {
  // Execute restore synchronously - all file moves complete before returning
  // No file watchers or delayed execution - immediate filesystem operations
  const result = restoreDesktop();
  // Return result immediately after all operations complete
  return result;
});

// IPC handler to check if a path exists (for verification)
ipcMain.handle("check-path-exists", async (event, filePath) => {
  try {
    const exists = fs.existsSync(filePath);
    return { exists };
  } catch (error) {
    return { exists: false, error: error.message };
  }
});

/**
 * Notifies Windows Explorer that the Desktop directory has changed.
 * Uses PowerShell to refresh the Desktop folder view and force icon refresh.
 */
function notifyWindowsExplorerRefresh() {
  try {
    // STEP 1: Trigger standard shell change notification
    // This is equivalent to SHChangeNotify(SHCNE_UPDATEDIR, SHCNF_PATH, desktopPath, NULL)
    const shellNotifyCommand = `$shell = New-Object -ComObject Shell.Application; $shell.Namespace(0).ParseName('${DESKTOP_PATH.replace(/'/g, "''")}').InvokeVerb('refresh')`;
    execSync(`powershell -Command "${shellNotifyCommand}"`, { stdio: 'ignore', timeout: 5000 });
    console.log("Desktop shell refresh triggered");
  } catch (error) {
    // Fallback: Try alternative PowerShell command for shell notification
    try {
      const fallbackCommand = `powershell -Command "(New-Object -ComObject Shell.Application).Namespace(0).ParseName('${DESKTOP_PATH.replace(/'/g, "''")}').InvokeVerb('refresh')"`;
      execSync(fallbackCommand, { stdio: 'ignore', timeout: 5000 });
      console.log("Desktop shell refresh triggered (fallback method)");
    } catch (fallbackError) {
      console.warn(`Failed to trigger shell change notification: ${error.message}`);
    }
  }
  
  // STEP 2: Force Desktop icon refresh (Option A - Preferred)
  // Refresh Explorer Desktop view without restarting Explorer
  try {
    const iconRefreshCommand = `(New-Object -ComObject Shell.Application).Windows() | Where-Object { $_.Name -eq 'File Explorer' } | ForEach-Object { $_.Refresh() }`;
    execSync(`powershell -Command "${iconRefreshCommand}"`, { stdio: 'ignore', timeout: 5000 });
    console.log("Desktop icon refresh triggered");
    return true;
  } catch (error) {
    console.warn(`Failed to refresh Desktop icons (Option A): ${error.message}`);
    // Option A failed, but we already did shell notification, so return true
    return true;
  }
}

// IPC handler to refresh Windows Explorer Desktop view
ipcMain.handle("refresh-desktop-explorer", async () => {
  try {
    notifyWindowsExplorerRefresh();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// IPC handler to hide overlay window (testing mode)
ipcMain.handle("hide-overlay", async () => {
  try {
    const { hideOverlayWindow } = require("./overlayWindow");
    hideOverlayWindow();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// IPC handler to update overlay halos with icon positions
ipcMain.handle("update-overlay-halos", async (event, iconPositions) => {
  try {
    updateOverlayHalos(iconPositions);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});