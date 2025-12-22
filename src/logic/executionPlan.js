/**
 * Canonical desktop path - single source of truth
 * Default group MUST be: C:\Users\alepr\OneDrive\Desktop\Unsorted
 */
const CANONICAL_DESKTOP_PATH = "C:\\Users\\alepr\\OneDrive\\Desktop";

/**
 * Normalize path for comparison (handles slashes and case)
 * @param {string} path - Path to normalize
 * @returns {string} Normalized path (forward slashes, lowercase)
 */
function normalizePath(path) {
  if (!path) return '';
  return path.replace(/\\/g, '/').toLowerCase().trim();
}

/**
 * Get canonical file key - single source of truth for file identity
 * Uses the SAME key format as scanDesktop results
 * @param {Object} file - File object with path, absolutePath, or sourcePath
 * @returns {string} Canonical normalized absolute path
 */
function fileKey(file) {
  // Use absolutePath first (from scanDesktop), then path, then sourcePath
  const canonicalPath = file.absolutePath ?? file.path ?? file.sourcePath;
  if (!canonicalPath) {
    throw new Error(`File missing path: ${JSON.stringify(file)}`);
  }
  return normalizePath(canonicalPath);
}

/**
 * Get canonical absolute path from file object
 * @param {Object} file - File object with path, absolutePath, or sourcePath
 * @returns {string} Absolute path (original format, not normalized)
 */
function getCanonicalSourcePath(file) {
  // Use absolutePath first (from scanDesktop), then path, then sourcePath
  return file.absolutePath ?? file.path ?? file.sourcePath;
}

/**
 * Check if a file or folder is protected organizer metadata.
 * Protected items must NEVER be moved or grouped.
 */
function isProtectedItem(itemPath, itemName, desktopPath) {
  const normalizedPath = normalizePath(itemPath);
  const normalizedDesktop = normalizePath(desktopPath);
  const protectedFolderName = '.desktop';
  
  // Check if path is inside .desktop folder
  const protectedFolderPath = `${normalizedDesktop}/${protectedFolderName}`;
  if (normalizedPath.startsWith(protectedFolderPath + '/') || normalizedPath === protectedFolderPath) {
    return true;
  }
  
  // Check if basename is a protected file
  if (itemName === '.desktop_organizer_baseline.json' || 
      itemName === '.desktop_organizer_history.json') {
    return true;
  }
  
  return false;
}

/**
 * Check if a file is eligible for assignment (not protected, not directory)
 * @param {Object} file - File object from scanDesktop
 * @param {string} desktopPath - Desktop path for protection checking
 * @returns {boolean} True if file is eligible for assignment
 */
function isEligibleFile(file, desktopPath) {
  // Must be a file (not directory)
  if (file.isDirectory === true) {
    return false;
  }
  
  // Must not be protected
  const filePath = getCanonicalSourcePath(file);
  if (isProtectedItem(filePath, file.name, desktopPath)) {
    return false;
  }
  
  return true;
}

/**
 * Generates a deterministic filesystem execution plan from the current grouped state.
 * 
 * This is a pure function with no side effects - it only generates a plan without
 * executing, validating, or checking filesystem state.
 * 
 * @param {Object} groups - Object mapping group names to arrays of file objects
 *   Format: { groupName: [{ name: string, path: string }, ...] }
 * @param {string} desktopPath - Absolute path to the Desktop directory
 * @param {Array} scannedFiles - Array of all scanned desktop items (files and folders)
 *   Format: [{ name: string, path: string, absolutePath: string, isDirectory: boolean, extension?: string }, ...]
 * @returns {Object} Execution plan with shape:
 *   {
 *     foldersToCreate: string[], // Absolute paths of folders to create
 *     filesToMove: Array<{ sourcePath: string, destinationPath: string }>
 *   }
 */
export function generateExecutionPlan(groups, desktopPath, scannedFiles = []) {
  // [DIAG PLAN] Diagnostic logging at the very start
  console.log(`[DIAG PLAN] generateExecutionPlan called`);
  console.log(`[DIAG PLAN] Input type: typeof groups=${typeof groups}, typeof desktopPath=${typeof desktopPath}, typeof scannedFiles=${typeof scannedFiles}`);
  
  // Determine what contains the scanned items
  let scannedItemsArray = null;
  let scannedItemsField = null;
  if (Array.isArray(groups)) {
    scannedItemsArray = groups;
    scannedItemsField = 'groups (array)';
    console.log(`[DIAG PLAN] groups is array, length=${groups.length}`);
  } else if (typeof groups === 'object' && groups !== null) {
    // Check common field names
    if (Array.isArray(groups.items)) {
      scannedItemsArray = groups.items;
      scannedItemsField = 'groups.items';
    } else if (Array.isArray(groups.desktopItems)) {
      scannedItemsArray = groups.desktopItems;
      scannedItemsField = 'groups.desktopItems';
    } else if (Array.isArray(groups.files)) {
      scannedItemsArray = groups.files;
      scannedItemsField = 'groups.files';
    }
    console.log(`[DIAG PLAN] groups is object, keys: ${Object.keys(groups).join(', ')}`);
    if (scannedItemsField) {
      console.log(`[DIAG PLAN] Found scanned items in ${scannedItemsField}, length=${scannedItemsArray.length}`);
    }
  }
  
  // Log scannedFiles parameter
  console.log(`[DIAG PLAN] scannedFiles parameter: ${Array.isArray(scannedFiles) ? `array, length=${scannedFiles.length}` : `type=${typeof scannedFiles}`}`);
  
  // Log first 10 items from scannedFiles
  if (Array.isArray(scannedFiles) && scannedFiles.length > 0) {
    console.log(`[DIAG PLAN] First 10 items from scannedFiles:`);
    scannedFiles.slice(0, 10).forEach((item, idx) => {
      console.log(`[DIAG PLAN]   [${idx}] name="${item.name || 'MISSING'}", path="${item.path || 'MISSING'}", absolutePath=${item.absolutePath ? `"${item.absolutePath}"` : 'MISSING'}`);
    });
  }
  
  const foldersToCreate = [];
  const filesToMove = [];
  
  // Normalize desktopPath: ensure it doesn't end with a separator
  const normalizedDesktopPath = desktopPath.replace(/[\\/]+$/, '');
  
  // Determine path separator based on desktopPath (Windows uses \, Unix uses /)
  const pathSeparator = normalizedDesktopPath.includes('\\') ? '\\' : '/';
  
  // Helper to join paths relative to desktop
  const joinPath = (...parts) => {
    return parts.reduce((acc, part) => {
      if (!acc) return part;
      const cleanPart = part.replace(/^[\\/]+|[\\/]+$/g, ''); // Remove leading/trailing separators
      return `${acc}${pathSeparator}${cleanPart}`;
    }, normalizedDesktopPath);
  };
  
  // Count eligible files from scannedFiles (for assertion)
  let scannedEligibleCount = 0;
  const eligibleFiles = [];
  for (const file of scannedFiles) {
    if (isEligibleFile(file, desktopPath)) {
      scannedEligibleCount++;
      eligibleFiles.push(file);
    }
  }
  console.log(`[RAW PLAN] Eligible files from scan: ${scannedEligibleCount}`);
  console.log(`[DIAG PLAN] After protected exclusion: eligibleCount=${scannedEligibleCount}`);
  
  // Build a map of existing desktop folders from scan results
  // key: normalized folder name (case-insensitive)
  // value: absolute folder path
  const existingFoldersMap = new Map();
  // Also build a map of existing files to prevent treating files as folders
  const existingFilesMap = new Map();
  for (const item of scannedFiles) {
    // 🚨 PROTECTED ITEMS: Skip protected organizer metadata
    const itemPath = getCanonicalSourcePath(item);
    if (isProtectedItem(itemPath, item.name, desktopPath)) {
      continue; // Never process protected items
    }
    
    const normalizedName = item.name.toLowerCase();
    if (item.isDirectory === true) {
      // Store folder path
      const folderPath = getCanonicalSourcePath(item);
      existingFoldersMap.set(normalizedName, folderPath);
    } else {
      // Track files to prevent creating folders with file names
      existingFilesMap.set(normalizedName, true);
    }
  }
  
  // Get all group names and sort them deterministically for stable order
  const groupNames = Object.keys(groups).sort();
  
  // Build foldersToCreate: one folder per group (deduplicated)
  // Skip folders that already exist on desktop
  // NEVER create folders that match existing file names
  const folderSet = new Set();
  let skippedFileNames = 0;
  let skippedExistingFolders = 0;
  
  for (const groupName of groupNames) {
    const normalizedGroupName = groupName.toLowerCase();
    
    // Check if group name matches an existing desktop folder (case-insensitive)
    if (existingFoldersMap.has(normalizedGroupName)) {
      // Folder already exists - skip adding to foldersToCreate
      skippedExistingFolders++;
      continue;
    }
    
    // Check if group name matches an existing file - NEVER create a folder with a file name
    if (existingFilesMap.has(normalizedGroupName)) {
      // This is a file, not a folder - skip creating folder for it
      skippedFileNames++;
      continue;
    }
    
    // 🚨 PROTECTED ITEMS: Never create .desktop folder
    const folderPath = joinPath(groupName);
    if (isProtectedItem(folderPath, groupName, desktopPath)) {
      console.error(`[RAW PLAN] EXCLUDED: Cannot create protected folder "${groupName}"`);
      continue;
    }
    
    if (!folderSet.has(folderPath)) {
      folderSet.add(folderPath);
      foldersToCreate.push(folderPath);
    }
  }
  
  // Build filesToMove: for each group, move all files to the group's folder
  let directoriesSkipped = 0;
  let filesAdded = 0;
  const excludedGroups = [];
  const assignedFiles = new Set(); // Track files that have been assigned to groups (using canonical keys)
  
  for (const groupName of groupNames) {
    const files = groups[groupName];
    
    // Skip empty groups
    if (!files || files.length === 0) {
      continue;
    }
    
    // 🚨 EXCLUDE groups that match filenames - cannot create folder with file name
    const normalizedGroupName = groupName.toLowerCase();
    if (existingFilesMap.has(normalizedGroupName)) {
      // Group name matches a filename - EXCLUDE this group entirely
      console.error(`[RAW PLAN] EXCLUDED GROUP: "${groupName}" matches existing filename - cannot create folder`);
      excludedGroups.push(groupName);
      continue;
    }
    
    // Sort files by path for stable, deterministic order
    const sortedFiles = [...files].sort((a, b) => {
      const pathA = getCanonicalSourcePath(a);
      const pathB = getCanonicalSourcePath(b);
      return pathA.localeCompare(pathB);
    });
    
    // Determine target folder path: use existing folder if name matches, else use new folder path
    let targetFolderPath;
    
    if (existingFoldersMap.has(normalizedGroupName)) {
      // Use existing folder absolute path
      targetFolderPath = existingFoldersMap.get(normalizedGroupName);
    } else {
      // Use Desktop\<GroupFolder> - this folder will be created
      targetFolderPath = joinPath(groupName);
    }
    
    for (const file of sortedFiles) {
      // 🚨 PROTECTED ITEMS: Never move protected organizer metadata
      const filePath = getCanonicalSourcePath(file);
      if (isProtectedItem(filePath, file.name, desktopPath)) {
        console.error(`[RAW PLAN] EXCLUDED: Protected file "${file.name}" cannot be moved`);
        continue;
      }
      
      // EXCLUDE directories from filesToMove - existing desktop folders are immovable
      if (file.isDirectory === true) {
        directoriesSkipped++;
        continue; // Skip directories - never move or nest them
      }
      
      // Get canonical source path and key
      const sourcePath = getCanonicalSourcePath(file);
      const fileKeyValue = fileKey(file);
      
      // Build destination path: MUST be Desktop\<groupFolder>\<filename>
      // targetFolderPath is already Desktop\<groupFolder>, so destinationPath will be Desktop\<groupFolder>\<filename>
      const destinationPath = `${targetFolderPath}${pathSeparator}${file.name}`;
      
      // Normalize paths for comparison (case-insensitive, handle path separators)
      const normalizedSource = normalizePath(sourcePath);
      const normalizedDest = normalizePath(destinationPath);
      
      // EXCLUDE files where sourcePath === destinationPath (already in correct location)
      // This prevents no-op moves where file is already in the target folder
      if (normalizedSource === normalizedDest) {
        // File is already at destination - skip it
        continue;
      }
      
      // Verify destinationPath is in correct format: Desktop\<groupFolder>\<filename>
      // It should have at least 3 path segments: [Desktop, groupFolder, filename]
      const destParts = destinationPath.split(/[\\/]/);
      if (destParts.length < 3) {
        // Destination path is too short - should be Desktop\groupFolder\filename
        // This shouldn't happen, but skip if it does
        console.warn(`[RAW PLAN] Skipping file with invalid destination path: ${file.name} -> ${destinationPath}`);
        continue;
      }
      
      filesToMove.push({
        sourcePath: sourcePath, // Absolute source path
        destinationPath: destinationPath // Desktop\<groupFolder>\<filename>
      });
      assignedFiles.add(fileKeyValue); // Mark file as assigned using canonical key
      filesAdded++;
    }
  }
  
  console.log(`[DIAG PLAN] After grouped assignment: groupedAssignedCount=${filesAdded}`);
  
  // 🚨 DEFAULT GROUP: Assign unassigned files to "Unsorted" group
  // Default group destination MUST be: C:\Users\alepr\OneDrive\Desktop\Unsorted
  const DEFAULT_GROUP_NAME = "Unsorted";
  const normalizedDefaultGroupName = DEFAULT_GROUP_NAME.toLowerCase();
  
  // Determine default group folder path - MUST use canonical desktop path
  // Ensure we use the canonical path for default group, not the derived desktopPath
  const canonicalPathSeparator = CANONICAL_DESKTOP_PATH.includes('\\') ? '\\' : '/';
  const canonicalDefaultGroupPath = `${CANONICAL_DESKTOP_PATH}${canonicalPathSeparator}${DEFAULT_GROUP_NAME}`;
  
  let defaultGroupFolderPath;
  if (existingFoldersMap.has(normalizedDefaultGroupName)) {
    // Use existing folder (should match canonical path if it exists)
    const existingPath = existingFoldersMap.get(normalizedDefaultGroupName);
    defaultGroupFolderPath = existingPath;
    // Verify existing folder matches canonical path (log warning if not)
    const normalizedExisting = normalizePath(existingPath);
    const normalizedCanonical = normalizePath(canonicalDefaultGroupPath);
    if (normalizedExisting !== normalizedCanonical) {
      console.warn(`[RAW PLAN] WARNING: Existing "Unsorted" folder path differs from canonical: ${existingPath} vs ${canonicalDefaultGroupPath}`);
    }
  } else if (existingFilesMap.has(normalizedDefaultGroupName)) {
    // Default group name matches a filename - cannot use it, use fallback
    console.error(`[RAW PLAN] ERROR: Default group name "${DEFAULT_GROUP_NAME}" matches existing filename - using fallback`);
    const fallbackName = "Unsorted Files";
    defaultGroupFolderPath = `${CANONICAL_DESKTOP_PATH}${canonicalPathSeparator}${fallbackName}`;
    // Add fallback folder to foldersToCreate if it doesn't exist
    if (!folderSet.has(defaultGroupFolderPath) && !existingFoldersMap.has(fallbackName.toLowerCase())) {
      foldersToCreate.push(defaultGroupFolderPath);
      folderSet.add(defaultGroupFolderPath);
    }
  } else {
    // Create default group folder - MUST be canonical path: C:\Users\alepr\OneDrive\Desktop\Unsorted
    defaultGroupFolderPath = canonicalDefaultGroupPath;
    if (!folderSet.has(defaultGroupFolderPath)) {
      folderSet.add(defaultGroupFolderPath);
      foldersToCreate.push(defaultGroupFolderPath);
    }
  }
  
  // Log default group path for verification
  console.log(`[RAW PLAN] Default group folder: ${defaultGroupFolderPath}`);
  console.log(`[RAW PLAN] Canonical desktop path: ${CANONICAL_DESKTOP_PATH}`);
  
  // Find unassigned files from scannedFiles and assign to default group
  // 🚨 MANDATORY: EVERY eligible file MUST be assigned to a group (default if no other group)
  let defaultGroupFilesAdded = 0;
  let defaultGroupFilesSkipped = 0;
  
  if (scannedFiles && scannedFiles.length > 0) {
    for (const file of scannedFiles) {
      // Skip if not eligible (protected or directory)
      if (!isEligibleFile(file, desktopPath)) {
        continue;
      }
      
      // Get canonical source path and key
      const sourcePath = getCanonicalSourcePath(file);
      const fileKeyValue = fileKey(file);
      
      // Skip files already assigned to groups (use canonical key for comparison)
      if (assignedFiles.has(fileKeyValue)) {
        continue;
      }
      
      // File is unassigned - MUST assign to default group
      // Destination MUST be: Desktop\Unsorted\<filename>
      const destinationPath = `${defaultGroupFolderPath}${pathSeparator}${file.name}`;
      
      // Normalize paths for comparison
      const normalizedSource = normalizePath(sourcePath);
      const normalizedDest = normalizePath(destinationPath);
      
      // 🚨 NEVER allow destinationPath === sourcePath (no-op moves filtered later)
      if (normalizedSource === normalizedDest) {
        // File is already at destination - still assign to group but will be filtered as no-op
        // This ensures the file is "assigned" even if it's already in the right place
        defaultGroupFilesSkipped++;
        console.log(`[RAW PLAN] File already at default group destination (will be filtered as no-op): ${file.name}`);
        // Still add to filesToMove - validation will filter it out as no-op
        filesToMove.push({
          sourcePath: sourcePath,
          destinationPath: destinationPath // Desktop\Unsorted\<filename>
        });
        assignedFiles.add(fileKeyValue); // Mark as assigned using canonical key
        defaultGroupFilesAdded++; // Count as assigned even though it's a no-op
        continue;
      }
      
      // Verify destination path is in correct format: Desktop\<DefaultGroup>\<filename>
      const destParts = destinationPath.split(/[\\/]/);
      if (destParts.length < 3) {
        console.error(`[RAW PLAN] ERROR: Invalid destination path for default group assignment: ${file.name} -> ${destinationPath}`);
        // Still assign to prevent file from being unassigned - validation will catch this
        filesToMove.push({
          sourcePath: sourcePath,
          destinationPath: destinationPath
        });
        assignedFiles.add(fileKeyValue); // Mark as assigned using canonical key
        defaultGroupFilesAdded++;
        continue;
      }
      
      // File is unassigned and needs to be moved - assign to default group
      filesToMove.push({
        sourcePath: sourcePath, // Absolute source path
        destinationPath: destinationPath // Desktop\Unsorted\<filename>
      });
      assignedFiles.add(fileKeyValue); // Mark as assigned using canonical key
      defaultGroupFilesAdded++;
    }
  }
  
  // Log default group assignment summary
  if (defaultGroupFilesSkipped > 0) {
    console.log(`[RAW PLAN] Default group: ${defaultGroupFilesAdded} files assigned (${defaultGroupFilesSkipped} already at destination, will be filtered as no-ops)`);
  }
  
  console.log(`[DIAG PLAN] After default group assignment: defaultAssignedCount=${defaultGroupFilesAdded}`);
  console.log(`[DIAG PLAN] Total filesToMove before validation: ${filesToMove.length}`);
  
  // If eligibleCount > 0 and filesToMove === 0, log exclusion reasons for first 10 eligible items
  if (scannedEligibleCount > 0 && filesToMove.length === 0) {
    console.error(`[DIAG PLAN] ERROR: ${scannedEligibleCount} eligible files exist but 0 files in filesToMove (before validation)`);
    console.error(`[DIAG PLAN] First 10 eligible items and exclusion reasons:`);
    
    // Build a set of file keys that are in filesToMove
    const filesInMovePlan = new Set();
    for (const move of filesToMove) {
      filesInMovePlan.add(normalizePath(move.sourcePath));
    }
    
    for (const file of eligibleFiles.slice(0, 10)) {
      const fileKeyValue = fileKey(file);
      const sourcePath = getCanonicalSourcePath(file);
      const sourcePathNorm = normalizePath(sourcePath);
      let reason = 'UNKNOWN';
      
      // Check if file was assigned to a group
      if (assignedFiles.has(fileKeyValue)) {
        // File was assigned, check if it's in filesToMove
        if (filesInMovePlan.has(sourcePathNorm)) {
          reason = 'IN_MOVE_PLAN';
        } else {
          reason = 'ASSIGNED_BUT_NOT_IN_MOVE_PLAN';
        }
      } else {
        // File was never assigned
        reason = 'NEVER_ASSIGNED_TO_GROUP_OR_DEFAULT';
      }
      
      console.error(`[DIAG PLAN]   - "${file.name}" (${sourcePath}): ${reason}`);
    }
  }
  
  // 🚨 HARD ASSERTION: Catch path-key mismatch bugs BEFORE validation
  // If eligible files exist but none were added to filesToMove, there's a key mismatch
  if (scannedEligibleCount > 0 && filesToMove.length === 0) {
    const errorMsg = `BUG: ${scannedEligibleCount} eligible file(s) exist but none were added to filesToMove (path-key mismatch). Check fileKey() and assignedFiles tracking.`;
    console.error("=".repeat(60));
    console.error("[RAW PLAN] PATH-KEY MISMATCH DETECTED");
    console.error(errorMsg);
    console.error(`  Eligible files: ${scannedEligibleCount}`);
    console.error(`  Files in groups: ${filesAdded}`);
    console.error(`  Default group files: ${defaultGroupFilesAdded}`);
    console.error(`  Assigned files set size: ${assignedFiles.size}`);
    console.error("=".repeat(60));
    throw new Error(errorMsg);
  }
  
  // Ensure folders are created for all groups that have files to move
  // Extract group folder paths from destination paths in filesToMove
  const requiredFolders = new Set();
  for (const move of filesToMove) {
    const destPath = move.destinationPath;
    const destParts = destPath.split(/[\\/]/);
    if (destParts.length >= 3) {
      // Extract folder path: everything except the filename
      const folderPath = destParts.slice(0, -1).join(destPath.includes('\\') ? '\\' : '/');
      requiredFolders.add(folderPath);
    }
  }
  
  // Build set of existing folder absolute paths for quick lookup
  const existingFolderPaths = new Set();
  for (const folderPath of existingFoldersMap.values()) {
    existingFolderPaths.add(folderPath);
  }
  
  // Add any missing folders to foldersToCreate (ensures Unsorted folder is included if used)
  for (const folderPath of requiredFolders) {
    // 🚨 PROTECTED ITEMS: Never create .desktop folder
    const folderName = folderPath.split(/[\\/]/).pop();
    if (isProtectedItem(folderPath, folderName, desktopPath)) {
      console.error(`[RAW PLAN] EXCLUDED: Cannot create protected folder "${folderName}"`);
      continue;
    }
    
    // Check if folder is already in foldersToCreate or already exists
    if (!folderSet.has(folderPath) && !existingFolderPaths.has(folderPath)) {
      // Check if folder name matches an existing file name (safety check)
      if (!existingFilesMap.has(folderName.toLowerCase())) {
        foldersToCreate.push(folderPath);
        folderSet.add(folderPath);
      }
    }
  }
  
  // 🚨 VALIDATION: Ensure no moves have sourcePath === destinationPath
  // Filter out any moves that slipped through with identical paths
  const validMoves = [];
  let noOpMovesFiltered = 0;
  
  for (const move of filesToMove) {
    // 🚨 PROTECTED ITEMS: Filter out any protected items that slipped through
    const sourceFileName = move.sourcePath.split(/[\\/]/).pop();
    if (isProtectedItem(move.sourcePath, sourceFileName, desktopPath)) {
      noOpMovesFiltered++;
      console.error(`[RAW PLAN] Filtered protected item: ${move.sourcePath}`);
      continue;
    }
    
    const normalizedSource = normalizePath(move.sourcePath);
    const normalizedDest = normalizePath(move.destinationPath);
    
    // 🚨 NEVER allow destinationPath === sourcePath
    if (normalizedSource === normalizedDest) {
      noOpMovesFiltered++;
      console.warn(`[RAW PLAN] Filtered no-op move: ${move.sourcePath} -> ${move.destinationPath}`);
      continue;
    }
    
    // Validate destination path is in subfolder format: Desktop\<GroupFolder>\<filename>
    const destParts = move.destinationPath.split(/[\\/]/);
    if (destParts.length < 3) {
      console.error(`[RAW PLAN] Invalid destination path (too short): ${move.destinationPath}`);
      noOpMovesFiltered++;
      continue;
    }
    
    validMoves.push(move);
  }
  
  console.log(`[DIAG PLAN] After validation filtering: final filesToMove count=${validMoves.length}`);
  
  // If eligibleCount > 0 and final filesToMove === 0, log exclusion reasons for first 10 eligible items
  if (scannedEligibleCount > 0 && validMoves.length === 0) {
    console.error(`[DIAG PLAN] ERROR: ${scannedEligibleCount} eligible files exist but 0 files in final filesToMove (after validation)`);
    console.error(`[DIAG PLAN] First 10 eligible items and exclusion reasons:`);
    
    // Build sets for quick lookup
    const filesInMovePlan = new Set();
    for (const move of filesToMove) {
      filesInMovePlan.add(normalizePath(move.sourcePath));
    }
    const filesInValidMoves = new Set();
    for (const move of validMoves) {
      filesInValidMoves.add(normalizePath(move.sourcePath));
    }
    
    for (const file of eligibleFiles.slice(0, 10)) {
      const fileKeyValue = fileKey(file);
      const sourcePath = getCanonicalSourcePath(file);
      const sourcePathNorm = normalizePath(sourcePath);
      let reason = 'UNKNOWN';
      
      // Check if file was assigned to a group
      if (assignedFiles.has(fileKeyValue)) {
        // File was assigned, check if it's in filesToMove
        if (filesInMovePlan.has(sourcePathNorm)) {
          // File is in move plan, check if it survived validation
          if (filesInValidMoves.has(sourcePathNorm)) {
            reason = 'IN_FINAL_PLAN';
          } else {
            reason = 'FILTERED_IN_VALIDATION';
          }
        } else {
          reason = 'ASSIGNED_BUT_NOT_IN_MOVE_PLAN';
        }
      } else {
        // File was never assigned
        reason = 'NEVER_ASSIGNED_TO_GROUP_OR_DEFAULT';
      }
      
      console.error(`[DIAG PLAN]   - "${file.name}" (${sourcePath}): ${reason}`);
    }
  }
  
  // Validation logging
  console.log(`[RAW PLAN] foldersToCreate: ${foldersToCreate.length}`);
  console.log(`[RAW PLAN] filesToMove: ${validMoves.length} (${noOpMovesFiltered} no-op moves filtered)`);
  console.log(`[RAW PLAN] Skipped: ${skippedFileNames} file names (not creating folders), ${skippedExistingFolders} existing folders, ${directoriesSkipped} directories from moves`);
  if (excludedGroups.length > 0) {
    console.error(`[RAW PLAN] EXCLUDED GROUPS (${excludedGroups.length}): ${excludedGroups.join(', ')}`);
  }
  console.log(`[RAW PLAN] Files added to move plan: ${filesAdded} grouped, ${defaultGroupFilesAdded} assigned to default group "${DEFAULT_GROUP_NAME}"`);
  
  // 🚨 MANDATORY VALIDATION: Assert plan has valid moves AFTER default grouping
  if (validMoves.length === 0) {
    const errorMsg = `Execution plan validation failed: 0 valid file moves AFTER default grouping. Excluded groups: ${excludedGroups.length}, No-op moves filtered: ${noOpMovesFiltered}, Default group files: ${defaultGroupFilesAdded}, Eligible files from scan: ${scannedEligibleCount}`;
    console.error("=".repeat(60));
    console.error("[RAW PLAN] VALIDATION FAILED");
    console.error(errorMsg);
    console.error("=".repeat(60));
    throw new Error(errorMsg);
  }
  
  // 🚨 MANDATORY VALIDATION: Assert no moves have sourcePath === destinationPath
  for (const move of validMoves) {
    const normalizedSource = normalizePath(move.sourcePath);
    const normalizedDest = normalizePath(move.destinationPath);
    if (normalizedSource === normalizedDest) {
      const errorMsg = `Execution plan validation failed: Move has sourcePath === destinationPath: ${move.sourcePath}`;
      console.error("=".repeat(60));
      console.error("[RAW PLAN] VALIDATION FAILED");
      console.error(errorMsg);
      console.error("=".repeat(60));
      throw new Error(errorMsg);
    }
  }
  
  return {
    foldersToCreate,
    filesToMove: validMoves
  };
}

/**
 * Normalizes and sanitizes an execution plan by applying validation rules.
 * 
 * This is a pure function with no side effects - it only transforms the plan data.
 * 
 * Rules applied:
 * A. Folder name validation - groups ending with file extensions are treated as single-file groups
 * B. Single-file group rule - groups with exactly one file matching the group label are excluded
 * C. Organizer-internal file exclusion - only known organizer-internal files (baseline, history) are excluded
 * D. Directory exclusion - existing desktop folders are never moved or nested (safety override)
 * 
 * @param {Object} rawPlan - Raw execution plan from generateExecutionPlan
 *   Format: { foldersToCreate: string[], filesToMove: Array<{ sourcePath, destinationPath }> }
 * @param {Object} groups - Original groups object mapping group names to file arrays
 *   Format: { groupName: [{ name: string, path: string }, ...] }
 * @param {Array} scannedFiles - Optional array of all scanned desktop items (for existing folder detection)
 *   Format: [{ name: string, path: string, absolutePath: string, isDirectory: boolean, extension?: string }, ...]
 * @returns {Object} Normalized execution plan with same shape as input
 */
export function normalizeExecutionPlan(rawPlan, groups, scannedFiles = []) {
  // Common file extensions to detect
  const fileExtensions = [
    '.lnk', '.docx', '.pdf', '.txt', '.jpg', '.jpeg', '.png', '.gif', '.bmp',
    '.doc', '.xls', '.xlsx', '.ppt', '.pptx', '.zip', '.rar', '.7z',
    '.mp3', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm',
    '.html', '.htm', '.css', '.js', '.json', '.xml', '.csv',
    '.exe', '.msi', '.bat', '.cmd', '.ps1', '.sh',
    '.ico', '.svg', '.webp', '.tiff', '.tif'
  ];
  
  // Helper to check if a string ends with a known file extension (case-insensitive)
  const hasFileExtension = (str) => {
    const lowerStr = str.toLowerCase();
    return fileExtensions.some(ext => lowerStr.endsWith(ext.toLowerCase()));
  };
  
  // Helper to extract base filename without extension for comparison
  const getBaseName = (filename) => {
    const lastDot = filename.lastIndexOf('.');
    return lastDot >= 0 ? filename.substring(0, lastDot).toLowerCase() : filename.toLowerCase();
  };
  
  // Helper to check if a file is an organizer-internal file that should be excluded
  // ONLY filters known organizer-internal files, not general hidden files
  const isOrganizerInternalFile = (filename) => {
    // Desktop organizer internal files (baseline snapshots, history, etc.)
    if (filename === '.desktop_organizer_baseline.json') {
      return true;
    }
    if (filename.includes('.desktop_organizer_') || filename.startsWith('desktop_organizer_')) {
      return true;
    }
    // Do NOT filter files just because they start with "." - that's too aggressive
    // Only filter explicit organizer-internal files
    return false;
  };
  
  // Build a map of group names to files for quick lookup
  const groupToFilesMap = {};
  Object.entries(groups).forEach(([groupName, files]) => {
    groupToFilesMap[groupName] = files;
  });
  
  // Get sorted group names for deterministic processing
  const sortedGroupNames = Object.keys(groups).sort();
  
  const excludedGroups = new Set();
  
  // Track orphaned files (from Rule B exclusions)
  const orphanedFiles = [];
  
  // Rule A & B: Process each group to identify excluded groups
  for (const groupName of sortedGroupNames) {
    const files = groupToFilesMap[groupName] || [];
    
    // Skip empty groups
    if (files.length === 0) {
      continue;
    }
    
    // Rule A: Check if group name ends with file extension
    if (hasFileExtension(groupName)) {
      // Treat as single-file group - exclude from plan
      excludedGroups.add(groupName);
      continue;
    }
    
    // Rule B: Check if single-file group where label matches filename
    // NOTE: This rule is now handled in grouping logic - groups with names matching filenames
    // are not created. This check remains as a safety net but should rarely trigger.
    if (files.length === 1) {
      const file = files[0];
      const groupBaseName = getBaseName(groupName);
      const fileBaseName = getBaseName(file.name);
      
      if (groupBaseName === fileBaseName) {
        // Group label matches filename - do NOT exclude from execution
        // Files should remain in execution plan even if group name matches filename
        // This is a safety check - grouping logic should prevent this case
        // Don't add to excludedGroups - let files pass through to execution
        orphanedFiles.push(file);
        continue;
      }
    }
  }
  
  // Rule C: Filter filesToMove, excluding excluded groups
  // Note: Organizer-internal files are excluded from UI/grouping but NOT from execution
  // Rule D: Exclude directories (safety override - existing desktop folders must never be moved)
  const normalizedFilesToMove = [];
  const validFolderPaths = new Set();
  
  // Log files entering normalization
  const filesEnteringNormalization = rawPlan.filesToMove.length;
  console.log(`[NORMALIZATION] Files entering: ${filesEnteringNormalization}`);
  
  // Build a map of normalized sourcePath -> isDirectory from scannedFiles for proper directory detection
  // Use case-insensitive path matching for Windows compatibility
  const sourcePathToIsDirectory = new Map();
  if (scannedFiles && scannedFiles.length > 0) {
    for (const item of scannedFiles) {
      const itemPath = getCanonicalSourcePath(item);
      // Normalize path: lowercase and replace backslashes with forward slashes for reliable matching
      const normalizedPath = normalizePath(itemPath);
      sourcePathToIsDirectory.set(normalizedPath, item.isDirectory === true);
    }
  }
  
  let directoriesSkipped = 0;
  let excludedGroupsSkipped = 0;
  const skippedFilesLog = []; // Track each skipped file with reason
  
  // Extract desktop path for protected item checking
  let desktopPathForProtection = '';
  if (scannedFiles && scannedFiles.length > 0) {
    const firstItem = scannedFiles[0];
    const firstPath = getCanonicalSourcePath(firstItem);
    const parts = firstPath.split(/[\\/]/);
    // Remove last part (filename/folder) to get desktop path
    if (parts.length > 1) {
      parts.pop();
      desktopPathForProtection = parts.join(firstPath.includes('\\') ? '\\' : '/');
    }
  }
  
  for (const move of rawPlan.filesToMove) {
    // Extract filename from source path
    const sourcePath = move.sourcePath;
    const lastSeparator = Math.max(sourcePath.lastIndexOf('\\'), sourcePath.lastIndexOf('/'));
    const filename = lastSeparator >= 0 ? sourcePath.substring(lastSeparator + 1) : sourcePath;
    
    // 🚨 PROTECTED ITEMS: Filter out protected items
    if (desktopPathForProtection && isProtectedItem(sourcePath, filename, desktopPathForProtection)) {
      skippedFilesLog.push({ file: filename, reason: 'protected organizer metadata' });
      excludedGroupsSkipped++;
      continue;
    }
    
    // Rule D: Exclude directories - use isDirectory flag from scan (not heuristics)
    // Normalize sourcePath for matching (case-insensitive, forward slashes)
    const normalizedSourcePath = normalizePath(sourcePath);
    const isDirectory = sourcePathToIsDirectory.get(normalizedSourcePath);
    
    // ONLY exclude if isDirectory is explicitly true from scan data
    // If undefined (not in map), treat as file - this is correct behavior
    if (isDirectory === true) {
      skippedFilesLog.push({ file: filename, reason: 'directory (isDirectory flag)' });
      directoriesSkipped++;
      continue;
    }
    // Files (isDirectory === false or undefined) continue processing
    
    // Note: Organizer-internal files are NOT excluded from execution
    // They may be excluded from UI/grouping, but execution should process them
    
    // Exclude moves for excluded groups
    // Extract group name from destination path (second-to-last segment)
    const destPath = move.destinationPath;
    const destParts = destPath.split(/[\\/]/);
    if (destParts.length >= 2) {
      const groupNameFromDest = destParts[destParts.length - 2]; // Folder name is second-to-last
      if (excludedGroups.has(groupNameFromDest)) {
        skippedFilesLog.push({ file: filename, reason: `excluded group: ${groupNameFromDest}` });
        excludedGroupsSkipped++;
        continue;
      }
      
      // Extract folder path (everything except the filename) for valid moves
      const folderPath = destParts.slice(0, -1).join(destPath.includes('\\') ? '\\' : '/');
      validFolderPaths.add(folderPath);
    }
    
    normalizedFilesToMove.push(move);
  }
  
  // Log files leaving normalization
  const filesLeavingNormalization = normalizedFilesToMove.length;
  console.log(`[NORMALIZATION] Files leaving: ${filesLeavingNormalization}`);
  console.log(`[NORMALIZATION] Skipped: ${directoriesSkipped} directories [execution skip], ${excludedGroupsSkipped} excluded groups [execution skip]`);
  console.log(`[NORMALIZATION] Validation: ${filesEnteringNormalization} entered, ${filesLeavingNormalization} + ${directoriesSkipped + excludedGroupsSkipped} skipped = ${filesLeavingNormalization + directoriesSkipped + excludedGroupsSkipped} total`);
  
  // Log each skipped file with exact reason and category
  if (skippedFilesLog.length > 0) {
    console.log(`[NORMALIZATION] Skipped files details (execution skips only):`);
    skippedFilesLog.forEach(({ file, reason }) => {
      console.log(`  - ${file}: ${reason} [execution skip]`);
    });
  }
  
  // Note: Organizer-internal files are excluded from UI/grouping but pass through to execution
  // They are valid filesToMove entries and will be processed by executor
  
  // Build a map of existing desktop folders from scan results (if provided)
  // key: absolute folder path
  // value: true (for quick lookup)
  const existingFoldersSet = new Set();
  if (scannedFiles && scannedFiles.length > 0) {
    for (const item of scannedFiles) {
      if (item.isDirectory === true) {
        const folderPath = getCanonicalSourcePath(item);
        existingFoldersSet.add(folderPath);
      }
    }
  }
  
  // Build normalized foldersToCreate from valid folder paths, excluding existing folders
  // 🚨 PROTECTED ITEMS: Filter out .desktop folder
  const normalizedFoldersToCreate = Array.from(validFolderPaths)
    .filter(folderPath => {
      // Never create .desktop folder
      if (desktopPathForProtection) {
        const folderName = folderPath.split(/[\\/]/).pop();
        if (isProtectedItem(folderPath, folderName, desktopPathForProtection)) {
          return false;
        }
      }
      return !existingFoldersSet.has(folderPath);
    })
    .sort();
  
  // Type-based fallback grouping for orphaned files
  // Extract desktop path from first folder or file move destination
  let desktopPath = '';
  if (normalizedFoldersToCreate.length > 0) {
    const folderPath = normalizedFoldersToCreate[0];
    const lastSeparator = Math.max(folderPath.lastIndexOf('\\'), folderPath.lastIndexOf('/'));
    if (lastSeparator >= 0) {
      desktopPath = folderPath.substring(0, lastSeparator);
    }
  } else if (normalizedFilesToMove.length > 0) {
    const destPath = normalizedFilesToMove[0].destinationPath;
    const parts = destPath.split(/[\\/]/);
    if (parts.length >= 2) {
      parts.splice(-2);
      desktopPath = parts.join(destPath.includes('\\') ? '\\' : '/');
    }
  } else if (rawPlan.foldersToCreate.length > 0) {
    const folderPath = rawPlan.foldersToCreate[0];
    const lastSeparator = Math.max(folderPath.lastIndexOf('\\'), folderPath.lastIndexOf('/'));
    if (lastSeparator >= 0) {
      desktopPath = folderPath.substring(0, lastSeparator);
    }
  } else if (rawPlan.filesToMove.length > 0) {
    const destPath = rawPlan.filesToMove[0].destinationPath;
    const parts = destPath.split(/[\\/]/);
    if (parts.length >= 2) {
      parts.splice(-2);
      desktopPath = parts.join(destPath.includes('\\') ? '\\' : '/');
    }
  }
  
  // Helper to get file extension (lowercase)
  const getFileExtension = (filename) => {
    const lastDot = filename.lastIndexOf('.');
    return lastDot >= 0 ? filename.substring(lastDot).toLowerCase() : '';
  };
  
  // Helper to join paths relative to desktop
  const joinPath = (...parts) => {
    if (!desktopPath) return '';
    const pathSeparator = desktopPath.includes('\\') ? '\\' : '/';
    return parts.reduce((acc, part) => {
      if (!acc) return part;
      const cleanPart = part.replace(/^[\\/]+|[\\/]+$/g, '');
      return `${acc}${pathSeparator}${cleanPart}`;
    }, desktopPath);
  };
  
  // Fallback rules mapping extensions to target folders
  const fallbackRules = {
    '.doc': 'Word Documents',
    '.docx': 'Word Documents',
    '.jpg': 'Images',
    '.jpeg': 'Images',
    '.png': 'Images',
    '.gif': 'Images',
    '.webp': 'Images'
  };
  
  // Process orphaned files with fallback rules
  const fallbackFolders = new Set();
  const fallbackMoves = [];
  
  if (desktopPath && orphanedFiles.length > 0) {
    for (const file of orphanedFiles) {
      // EXCLUDE directories from fallback moves - existing desktop folders are immovable
      if (file.isDirectory === true) {
        continue; // Skip directories - never move or nest them
      }
      
      const extension = getFileExtension(file.name);
      const targetFolder = fallbackRules[extension];
      
      if (targetFolder) {
        const folderPath = joinPath(targetFolder);
        if (folderPath) {
          fallbackFolders.add(folderPath);
          fallbackMoves.push({
            sourcePath: getCanonicalSourcePath(file),
            destinationPath: joinPath(targetFolder, file.name)
          });
        }
      }
    }
  }
  
  // Merge fallback folders into normalized folders
  for (const folderPath of Array.from(fallbackFolders).sort()) {
    if (!normalizedFoldersToCreate.includes(folderPath)) {
      normalizedFoldersToCreate.push(folderPath);
    }
  }
  normalizedFoldersToCreate.sort();
  
  // Merge fallback moves into normalized moves
  normalizedFilesToMove.push(...fallbackMoves);
  
  // Sort filesToMove for deterministic ordering
  normalizedFilesToMove.sort((a, b) => {
    const pathCompare = a.sourcePath.localeCompare(b.sourcePath);
    return pathCompare !== 0 ? pathCompare : a.destinationPath.localeCompare(b.destinationPath);
  });
  
  // 🚨 MANDATORY VALIDATION: Assert plan has valid moves
  if (normalizedFilesToMove.length === 0) {
    const errorMsg = `Normalized execution plan validation failed: 0 valid file moves after normalization`;
    console.error("=".repeat(60));
    console.error("[NORMALIZATION] VALIDATION FAILED");
    console.error(errorMsg);
    console.error("=".repeat(60));
    throw new Error(errorMsg);
  }
  
  // 🚨 MANDATORY VALIDATION: Assert no moves have sourcePath === destinationPath
  for (const move of normalizedFilesToMove) {
    const normalizedSource = normalizePath(move.sourcePath);
    const normalizedDest = normalizePath(move.destinationPath);
    if (normalizedSource === normalizedDest) {
      const errorMsg = `Normalized execution plan validation failed: Move has sourcePath === destinationPath: ${move.sourcePath}`;
      console.error("=".repeat(60));
      console.error("[NORMALIZATION] VALIDATION FAILED");
      console.error(errorMsg);
      console.error("=".repeat(60));
      throw new Error(errorMsg);
    }
    
    // Validate destination path is in subfolder format: Desktop\<GroupFolder>\<filename>
    const destParts = move.destinationPath.split(/[\\/]/);
    if (destParts.length < 3) {
      const errorMsg = `Normalized execution plan validation failed: Invalid destination path (too short): ${move.destinationPath}`;
      console.error("=".repeat(60));
      console.error("[NORMALIZATION] VALIDATION FAILED");
      console.error(errorMsg);
      console.error("=".repeat(60));
      throw new Error(errorMsg);
    }
  }
  
  return {
    foldersToCreate: normalizedFoldersToCreate,
    filesToMove: normalizedFilesToMove
  };
}
