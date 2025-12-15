const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

/**
 * Recursively searches for a file by name starting from a directory.
 * Returns the absolute path if found, null otherwise.
 */
function findFileRecursive(dirPath, filename, visited = new Set()) {
  // Prevent infinite loops from symlinks
  const normalizedPath = path.resolve(dirPath);
  if (visited.has(normalizedPath)) {
    return null;
  }
  visited.add(normalizedPath);
  
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      
      if (entry.isFile() && entry.name === filename) {
        return entryPath;
      } else if (entry.isDirectory() && entry.name !== '.desktop_organizer_baseline.json') {
        // Recursively search in subdirectories
        const found = findFileRecursive(entryPath, filename, visited);
        if (found) {
          return found;
        }
      }
    }
  } catch (error) {
    // Skip directories we can't read
  }
  
  return null;
}

/**
 * Recursively finds ALL organizer-created folders (not in baseline).
 * Returns all folders that were created by the organizer, regardless of contents.
 */
function findAllOrganizerFolders(desktopPath, baselineFolders, visited = new Set()) {
  const organizerFolders = [];
  const normalizedPath = path.resolve(desktopPath);
  
  if (visited.has(normalizedPath)) {
    return organizerFolders;
  }
  visited.add(normalizedPath);
  
  try {
    const entries = fs.readdirSync(desktopPath, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== '.desktop_organizer_baseline.json') {
        const folderPath = path.join(desktopPath, entry.name);
        const absoluteFolderPath = path.resolve(folderPath);
        
        // Check if this is an organizer-created folder (not in baseline)
        if (!baselineFolders.has(absoluteFolderPath)) {
          // This is an organizer-created folder - add it and all subfolders
          organizerFolders.push(folderPath);
          
          // Recursively find all subfolders
          try {
            const subFolders = findAllOrganizerFolders(folderPath, baselineFolders, visited);
            organizerFolders.push(...subFolders);
          } catch (error) {
            // Skip if we can't read subdirectories
          }
        } else {
          // Baseline folder - still check subdirectories for organizer-created nested folders
          const subFolders = findAllOrganizerFolders(folderPath, baselineFolders, visited);
          organizerFolders.push(...subFolders);
        }
      }
    }
  } catch (error) {
    // Skip if we can't read directory
  }
  
  return organizerFolders;
}

async function restoreDesktopFromBaseline(desktopPath) {
  console.log("=".repeat(60));
  console.log("RESTORE STARTED");
  console.log("=".repeat(60));
  
  // Auto-detect desktop path if not provided
  if (!desktopPath) {
    const possible = [
      path.join(os.homedir(), "Desktop"),
      path.join(os.homedir(), "OneDrive", "Desktop"),
      "C:\\Users\\alepr\\OneDrive\\Desktop",
      "C:\\Users\\Public\\Desktop"
    ];

    for (const p of possible) {
      try {
        if (fs.existsSync(p)) {
          desktopPath = p;
          break;
        }
      } catch (_) {}
    }

    if (!desktopPath) {
      const errorMsg = 'Desktop path not found. Cannot restore desktop.';
      console.error("=".repeat(60));
      console.error("RESTORE FAILED:", errorMsg);
      console.error("=".repeat(60));
      return { 
        success: false, 
        message: errorMsg
      };
    }
  }
  
  try {
    // A. BASELINE VALIDATION (FAIL LOUD)
    const snapshotPath = path.join(desktopPath, '.desktop_organizer_baseline.json');
    
    if (!fs.existsSync(snapshotPath)) {
      const errorMsg = 'Baseline snapshot not found. Cannot restore desktop.';
      console.error("=".repeat(60));
      console.error("RESTORE FAILED:", errorMsg);
      console.error("=".repeat(60));
      return { 
        success: false, 
        message: errorMsg
      };
    }
    
    const snapshotContent = fs.readFileSync(snapshotPath, 'utf8');
    
    // Validate baseline is not empty
    if (!snapshotContent || snapshotContent.trim().length === 0) {
      const errorMsg = 'Baseline snapshot is empty. Cannot restore desktop.';
      console.error("=".repeat(60));
      console.error("RESTORE FAILED:", errorMsg);
      console.error("=".repeat(60));
      return { 
        success: false, 
        message: errorMsg
      };
    }
    
    let snapshot;
    try {
      snapshot = JSON.parse(snapshotContent);
    } catch (parseError) {
      const errorMsg = `Baseline snapshot is invalid JSON: ${parseError.message}`;
      console.error("=".repeat(60));
      console.error("RESTORE FAILED:", errorMsg);
      console.error("=".repeat(60));
      return { 
        success: false, 
        message: errorMsg
      };
    }
    
    // Validate snapshot is an array
    if (!Array.isArray(snapshot)) {
      const errorMsg = 'Baseline snapshot is not an array. Cannot restore desktop.';
      console.error("=".repeat(60));
      console.error("RESTORE FAILED:", errorMsg);
      console.error("=".repeat(60));
      return { 
        success: false, 
        message: errorMsg
      };
    }
    
    // Log number of entries BEFORE doing anything
    console.log(`Baseline snapshot loaded: ${snapshot.length} entries`);
    if (snapshot.length === 0) {
      const errorMsg = 'Baseline snapshot contains 0 entries. Cannot restore desktop.';
      console.error("=".repeat(60));
      console.error("RESTORE FAILED:", errorMsg);
      console.error("=".repeat(60));
      return { 
        success: false, 
        message: errorMsg
      };
    }
    
    // Simplified restore: find and restore each file from baseline
    let restoredCount = 0;
    
    console.log("Restoring files...");
    for (const item of snapshot) {
      // Only restore files (skip folders for now)
      if (!item.isFile) {
        continue;
      }
      
      const originalPath = item.absolutePath; // Baseline uses absolutePath
      const fileName = path.basename(originalPath);
      
      // Find file anywhere under Desktop (recursively)
      const currentPath = findFileRecursive(desktopPath, fileName);
      
      if (!currentPath) {
        // File not found - might have been deleted, skip
        continue;
      }
      
      // Skip if already at original location
      const normalizedCurrent = path.resolve(currentPath);
      const normalizedOriginal = path.resolve(originalPath);
      if (normalizedCurrent === normalizedOriginal) {
        continue;
      }
      
      // Ensure destination directory exists
      const destDir = path.dirname(originalPath);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      
      // Move file back to original location
      try {
        fs.renameSync(currentPath, originalPath);
        restoredCount++;
        console.log(`  RESTORED: ${fileName} -> ${path.relative(desktopPath, originalPath)}`);
      } catch (error) {
        console.error(`  ERROR restoring ${fileName}: ${error.message}`);
      }
    }
    
    // E. GUARANTEED VISIBILITY - Log completion with exact format
    console.log("=".repeat(60));
    if (restoredCount === 0) {
      // If X === 0, log ERROR (restore failure)
      console.error("RESTORE COMPLETED – 0 ITEMS RESTORED");
      console.error("ERROR: Restore failed - 0 items restored");
      console.log("=".repeat(60));
      
      return {
        success: false,
        message: 'Restore failed: 0 items restored',
        filesRestored: 0,
        foldersRecreated: 0,
        emptyFoldersRemoved: 0,
        totalItemsRestored: 0,
        errors: [{ type: 'restore-validation', error: 'Restore failed: 0 items restored' }]
      };
    } else {
      // Log success with exact format: "RESTORE COMPLETED – X ITEMS RESTORED"
      console.log(`RESTORE COMPLETED – ${restoredCount} ITEMS RESTORED`);
      console.log("=".repeat(60));
      
      return {
        success: true,
        message: `Restored ${restoredCount} items`,
        filesRestored: restoredCount,
        foldersRecreated: 0,
        emptyFoldersRemoved: 0,
        totalItemsRestored: restoredCount,
        errors: []
      };
    }
    
  } catch (error) {
    const errorMessage = `Desktop restore failed: ${error.message}`;
    console.error("=".repeat(60));
    console.error("RESTORE FAILED:", errorMessage);
    console.error("RESTORE COMPLETED – 0 ITEMS RESTORED");
    console.error(error);
    console.error("=".repeat(60));
    return {
      success: false,
      message: errorMessage,
      filesRestored: 0,
      foldersRecreated: 0,
      emptyFoldersRemoved: 0,
      totalItemsRestored: 0,
      errors: [{ type: 'restore', error: error.message }]
    };
  }
}

// Export for use in IPC handlers
module.exports = { restoreDesktopFromBaseline };

// IPC handler for restore-desktop
ipcMain.handle("restore-desktop", async () => {
  // Auto-detect desktop path
  const possible = [
    path.join(os.homedir(), "Desktop"),
    path.join(os.homedir(), "OneDrive", "Desktop"),
    "C:\\Users\\alepr\\OneDrive\\Desktop",
    "C:\\Users\\Public\\Desktop"
  ];

  let desktopPath = null;
  for (const p of possible) {
    try {
      if (fs.existsSync(p)) {
        desktopPath = p;
        break;
      }
    } catch (_) {}
  }

  if (!desktopPath) {
    return {
      success: false,
      message: 'Desktop path not found. Cannot restore desktop.'
    };
  }

  // Call restore function and return its result
  return await restoreDesktopFromBaseline(desktopPath);
});

// IPC handlers MUST be registered (after exports to avoid circular dependency)
require("./ipcHandlers");

// Import overlay window functions for cleanup on app close
const { destroyOverlayWindow } = require("./overlayWindow");

// Import overlay window for visual testing
const { createOverlayWindow } = require("./overlayWindow");

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

app.whenReady().then(() => {
  createWindow();
});

app.on("window-all-closed", () => {
  // Clean up overlay window before quitting
  destroyOverlayWindow();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  // Ensure overlay is destroyed on quit
  destroyOverlayWindow();
});
