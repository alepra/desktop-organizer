const { ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

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
    
    // [DIAG SCAN] Diagnostic logging immediately after scan result is built
    console.log(`[DIAG SCAN] Total items: ${items.length} (files: ${filesCount}, folders: ${foldersCount})`);
    console.log(`[DIAG SCAN] First 10 items:`);
    items.slice(0, 10).forEach((item, idx) => {
      const hasAbsolutePath = item.absolutePath !== undefined && item.absolutePath !== null;
      console.log(`[DIAG SCAN]   [${idx}] name="${item.name}", type=${item.type}, path="${item.path}", absolutePath=${hasAbsolutePath ? `"${item.absolutePath}"` : 'MISSING'}`);
    });
    const itemsWithAbsolutePath = items.filter(item => item.absolutePath !== undefined && item.absolutePath !== null).length;
    console.log(`[DIAG SCAN] Items with absolutePath: ${itemsWithAbsolutePath}/${items.length}`);
    
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
