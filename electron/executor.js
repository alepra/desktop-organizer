const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

/**
 * Authoritative desktop path - hardcoded for restore operations
 */
const DESKTOP_PATH = "C:\\Users\\alepr\\OneDrive\\Desktop";

/**
 * Protected organizer metadata folder
 */
const PROTECTED_FOLDER = path.join(DESKTOP_PATH, ".desktop");
const BASELINE_PATH = path.join(PROTECTED_FOLDER, ".desktop_organizer_baseline.json");

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

/**
 * Recursively gets all folder paths under a directory.
 * Returns array of absolute folder paths.
 */
function getAllFoldersRecursive(dirPath, visited = new Set()) {
  const folders = [];
  const normalizedPath = path.resolve(dirPath);
  
  // Prevent infinite loops from symlinks
  if (visited.has(normalizedPath)) {
    return folders;
  }
  visited.add(normalizedPath);
  
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      
      // 🚨 PROTECTED ITEMS: Skip .desktop folder entirely
      if (entry.name === '.desktop' && entry.isDirectory()) {
        continue;
      }
      
      if (entry.isDirectory()) {
        folders.push(entryPath);
        // Recursively get subfolders
        const subfolders = getAllFoldersRecursive(entryPath, visited);
        folders.push(...subfolders);
      }
    }
  } catch (error) {
    // Skip directories we can't read
  }
  
  return folders;
}

/**
 * Recursively gets all file paths under a directory.
 * Returns array of absolute file paths.
 */
function getAllFilesRecursive(dirPath, visited = new Set()) {
  const files = [];
  const normalizedPath = path.resolve(dirPath);
  
  // Prevent infinite loops from symlinks
  if (visited.has(normalizedPath)) {
    return files;
  }
  visited.add(normalizedPath);
  
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      
      // 🚨 PROTECTED ITEMS: Skip .desktop folder entirely
      if (entry.name === '.desktop' && entry.isDirectory()) {
        continue;
      }
      
      // 🚨 PROTECTED ITEMS: Skip protected metadata files
      if (entry.name === '.desktop_organizer_baseline.json' || 
          entry.name === '.desktop_organizer_history.json') {
        continue;
      }
      
      if (entry.isFile()) {
        files.push(entryPath);
      } else if (entry.isDirectory()) {
        // Recursively get files in subdirectories
        const subfiles = getAllFilesRecursive(entryPath, visited);
        files.push(...subfiles);
      }
    }
  } catch (error) {
    // Skip directories we can't read
  }
  
  return files;
}

/**
 * Recursively deletes a folder and all its contents.
 * Returns true if successful, false otherwise.
 */
function deleteFolderRecursive(folderPath) {
  try {
    if (!fs.existsSync(folderPath)) {
      return true; // Already deleted
    }
    
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const entryPath = path.join(folderPath, entry.name);
      
      if (entry.isDirectory()) {
        // Recursively delete subdirectories
        deleteFolderRecursive(entryPath);
      } else {
        // Delete file
        fs.unlinkSync(entryPath);
      }
    }
    
    // Delete the folder itself
    fs.rmdirSync(folderPath);
    return true;
  } catch (error) {
    console.error(`  ERROR: Failed to delete folder ${folderPath}: ${error.message}`);
    return false;
  }
}

/**
 * Authoritative desktop restore (filesystem-level rollback).
 * 
 * Operates at filesystem level only - ignores UI state and execution plans.
 * Reads baseline from hardcoded desktop path and physically moves items
 * back to their original baseline paths using EXACT path matching.
 * 
 * CRITICAL: Uses exact baseline paths, NOT filename-only matching.
 * 
 * @returns {Object} { ok: boolean, error?: string, restoredCount?: number, details?: any }
 */
function restoreDesktop() {
  // Validate desktop path exists
  if (!fs.existsSync(DESKTOP_PATH)) {
    console.error("=".repeat(60));
    console.error("RESTORE FAILED: Desktop path does not exist");
    console.error(`  Path: ${DESKTOP_PATH}`);
    console.error("=".repeat(60));
    return { 
      ok: false, 
      error: `Desktop path does not exist: ${DESKTOP_PATH}`,
      details: { path: DESKTOP_PATH }
    };
  }

  // Ensure protected folder exists
  if (!fs.existsSync(PROTECTED_FOLDER)) {
    try {
      fs.mkdirSync(PROTECTED_FOLDER, { recursive: true });
      console.log(`Created protected folder: ${PROTECTED_FOLDER}`);
    } catch (error) {
      console.error(`Failed to create protected folder: ${error.message}`);
    }
  }
  
  // Validate baseline file exists at protected location
  if (!fs.existsSync(BASELINE_PATH)) {
    console.error("=".repeat(60));
    console.error("RESTORE FAILED: Baseline missing");
    console.error(`  Path: ${BASELINE_PATH}`);
    console.error("=".repeat(60));
    return { 
      ok: false, 
      error: `Baseline missing: ${BASELINE_PATH}`,
      details: { baselinePath: BASELINE_PATH }
    };
  }

  // Load and parse baseline
  let baseline;
  try {
    const baselineContent = fs.readFileSync(BASELINE_PATH, "utf-8");
    baseline = JSON.parse(baselineContent);
  } catch (error) {
    console.error("=".repeat(60));
    console.error("RESTORE FAILED: Baseline parse error");
    console.error(`  Error: ${error.message}`);
    console.error("=".repeat(60));
    return { 
      ok: false, 
      error: `Baseline parse error: ${error.message}`,
      details: { parseError: error.message }
    };
  }

  // Validate baseline structure
  if (!Array.isArray(baseline)) {
    console.error("=".repeat(60));
    console.error("RESTORE FAILED: Baseline is not an array");
    console.error("=".repeat(60));
    return { 
      ok: false, 
      error: "Baseline is not an array",
      details: { type: typeof baseline }
    };
  }

  if (baseline.length === 0) {
    console.error("=".repeat(60));
    console.error("RESTORE FAILED: Baseline is empty");
    console.error("=".repeat(60));
    return { 
      ok: false, 
      error: "Baseline is empty",
      details: { entryCount: 0 }
    };
  }

  console.log("=".repeat(60));
  console.log("RESTORE STARTED");
  console.log(`  Desktop: ${DESKTOP_PATH}`);
  console.log(`  Baseline: ${BASELINE_PATH}`);
  console.log(`  Baseline entries: ${baseline.length}`);
  console.log("=".repeat(60));

  // Build sets for quick lookup
  // Baseline folder paths (for comparison later)
  const baselineFolderPaths = new Set();
  // Baseline file paths (exact paths to restore) - normalized for comparison
  const baselineFilePaths = new Map(); // Map: normalized path -> original baseline item
  
  for (const item of baseline) {
    const itemPath = path.resolve(item.absolutePath);
    if (item.isFolder) {
      baselineFolderPaths.add(itemPath);
    } else if (item.isFile) {
      baselineFilePaths.set(itemPath, item);
    }
  }

  // Get all current files on desktop (one-time scan)
  console.log("Scanning desktop for current files...");
  const currentFiles = getAllFilesRecursive(DESKTOP_PATH);
  console.log(`  Found ${currentFiles.length} files on desktop`);
  
  // Build map of current files by normalized path
  const currentFilesMap = new Map();
  for (const filePath of currentFiles) {
    const normalizedPath = path.resolve(filePath);
    currentFilesMap.set(normalizedPath, filePath);
  }

  let restoredCount = 0;
  const errors = [];
  const skipped = [];

  // STEP 1: Restore files using EXACT baseline paths
  console.log("Restoring files from baseline...");
  for (const item of baseline) {
    // Only restore files (folders handled separately)
    if (!item.isFile) {
      continue;
    }

    const originalPath = path.resolve(item.absolutePath);
    const fileName = path.basename(originalPath);

    // Check if file exists at original path (exact path match)
    if (fs.existsSync(originalPath) && currentFilesMap.has(originalPath)) {
      // File already at original location - skip
      skipped.push({ fileName, reason: "Already at original location" });
      console.log(`  SKIP: Already at original location: ${fileName}`);
      continue;
    }

    // File not at original path - need to find it in current files
    // Find file that matches filename but is at different path
    let currentPath = null;
    for (const filePath of currentFiles) {
      const normalizedFilePath = path.resolve(filePath);
      // Skip if this is the original path (already checked)
      if (normalizedFilePath === originalPath) {
        continue;
      }
      // Match by filename (this is the best we can do without content hashing)
      if (path.basename(filePath) === fileName) {
        currentPath = filePath;
        break; // Use first match (assumes no duplicates, which is reasonable for desktop)
      }
    }

    if (!currentPath || !fs.existsSync(currentPath)) {
      // File not found - might have been deleted, log and continue
      skipped.push({ fileName, reason: "File not found" });
      console.log(`  SKIP: File not found: ${fileName}`);
      continue;
    }

    // Ensure destination directory exists (recreate if missing)
    const destDir = path.dirname(originalPath);
    if (!fs.existsSync(destDir)) {
      try {
        fs.mkdirSync(destDir, { recursive: true });
        console.log(`  CREATED: Directory ${path.relative(DESKTOP_PATH, destDir)}`);
      } catch (error) {
        errors.push({ file: fileName, error: `Failed to create directory: ${error.message}` });
        console.error(`  ERROR: Failed to create directory for ${fileName}: ${error.message}`);
        continue;
      }
    }

    // Physically move file back to original location
    try {
      fs.renameSync(currentPath, originalPath);
      restoredCount++;
      console.log(`  RESTORED: ${fileName} -> ${path.relative(DESKTOP_PATH, originalPath)}`);
      // Update currentFilesMap to reflect the move
      currentFilesMap.delete(path.resolve(currentPath));
      currentFilesMap.set(originalPath, originalPath);
    } catch (error) {
      errors.push({ file: fileName, error: error.message });
      console.error(`  ERROR: Failed to restore ${fileName}: ${error.message}`);
    }
  }

  // STEP 2: Remove folders that were created during execution
  // These are folders that exist now but were NOT in the baseline
  console.log("Removing organizer-created folders...");
  let deletedFoldersCount = 0;
  
  try {
    // Get all current folders on desktop (recursively)
    const currentFolders = getAllFoldersRecursive(DESKTOP_PATH);
    
    for (const folderPath of currentFolders) {
      const normalizedFolderPath = path.resolve(folderPath);
      
      // Skip if folder was in baseline (it should remain)
      if (baselineFolderPaths.has(normalizedFolderPath)) {
        continue;
      }
      
      // 🚨 PROTECTED ITEMS: Never delete .desktop folder
      const normalizedProtected = path.resolve(PROTECTED_FOLDER);
      if (normalizedFolderPath === normalizedProtected) {
        continue; // Skip .desktop folder - it's protected
      }
      
      // Folder exists but wasn't in baseline - it was created during execution
      // Delete it
      const folderName = path.relative(DESKTOP_PATH, folderPath);
      console.log(`  DELETING: Folder ${folderName} (not in baseline)`);
      
      if (deleteFolderRecursive(folderPath)) {
        deletedFoldersCount++;
        console.log(`  DELETED: Folder ${folderName}`);
      }
    }
  } catch (error) {
    console.error(`  ERROR: Failed to scan/delete folders: ${error.message}`);
    errors.push({ file: "folder cleanup", error: error.message });
  }

  // 🚨 LOUD FAILURE if 0 items restored
  console.log("=".repeat(60));
  if (restoredCount === 0) {
    console.error("RESTORE COMPLETED – 0 ITEMS RESTORED");
    console.error("ERROR: Restore failed - 0 items restored");
    if (errors.length > 0) {
      console.error(`  ERRORS: ${errors.length} error(s) encountered`);
      errors.forEach(err => console.error(`    - ${err.file}: ${err.error}`));
    }
    if (skipped.length > 0) {
      console.error(`  SKIPPED: ${skipped.length} item(s) skipped`);
    }
    console.error(`  DELETED FOLDERS: ${deletedFoldersCount}`);
    console.error("=".repeat(60));
    return {
      ok: false,
      error: "Restore failed: 0 items restored",
      details: {
        errors,
        skipped,
        baselineEntryCount: baseline.length,
        deletedFoldersCount
      }
    };
  } else {
    console.log(`RESTORE COMPLETED – ${restoredCount} ITEMS RESTORED`);
    if (deletedFoldersCount > 0) {
      console.log(`  DELETED FOLDERS: ${deletedFoldersCount} organizer-created folder(s) removed`);
    }
    if (errors.length > 0) {
      console.error(`  WARNINGS: ${errors.length} error(s) encountered`);
      errors.forEach(err => console.error(`    - ${err.file}: ${err.error}`));
    }
    if (skipped.length > 0) {
      console.log(`  SKIPPED: ${skipped.length} item(s) skipped`);
    }
    console.log("=".repeat(60));
    
    // Notify Windows Explorer that Desktop directory has changed
    notifyWindowsExplorerRefresh();
    
    return { 
      ok: true, 
      restoredCount,
      details: {
        deletedFoldersCount,
        errors: errors.length > 0 ? errors : undefined,
        skipped: skipped.length > 0 ? skipped : undefined
      }
    };
  }
}

module.exports = { restoreDesktop };
