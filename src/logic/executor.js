/**
 * Filesystem executor for execution plans.
 * 
 * This module executes normalized execution plans by creating folders and moving files.
 * Execution is disabled by default and guarded behind EXECUTION_ENABLED flag.
 * 
 * DO NOT enable this flag unless you are certain you want to modify the filesystem.
 */

// Hard-coded flag to prevent accidental execution
const EXECUTION_ENABLED = true;

/**
 * Canonical desktop path - single source of truth
 * NO fallbacks, NO platform detection, NO alternate paths
 */
const CANONICAL_DESKTOP_PATH = "C:\\Users\\alepr\\OneDrive\\Desktop";

/**
 * Executes a normalized execution plan.
 * 
 * @param {Object} normalizedPlan - Normalized execution plan
 *   Format: { foldersToCreate: string[], filesToMove: Array<{ sourcePath, destinationPath }> }
 * @param {boolean} skipBaselineSnapshot - If true, skip baseline snapshot (for re-execution)
 * @returns {Promise<Object>} Execution result with success status and any errors
 */
export async function executePlan(normalizedPlan, skipBaselineSnapshot = false) {
  // Guard: Exit early if execution is disabled
  if (!EXECUTION_ENABLED) {
    console.log('Execution disabled — no filesystem actions performed');
    return {
      success: false,
      enabled: false,
      message: 'Execution disabled — no filesystem actions performed',
      foldersCreated: 0,
      filesMoved: 0,
      errors: []
    };
  }
  
  // 🚨 MANDATORY: Verify canonical desktop path exists before execution
  console.log("=".repeat(60));
  console.log("EXECUTION PRE-FLIGHT CHECK");
  console.log(`  Canonical Desktop Path: ${CANONICAL_DESKTOP_PATH}`);
  
  // Use Node.js fs module via IPC to check path existence
  try {
    const pathCheck = await window.electron.invoke('check-path-exists', CANONICAL_DESKTOP_PATH);
    if (!pathCheck.exists) {
      const errorMsg = `Canonical desktop path does not exist: ${CANONICAL_DESKTOP_PATH}`;
      console.error("=".repeat(60));
      console.error("EXECUTION ABORTED");
      console.error(errorMsg);
      console.error("=".repeat(60));
      return {
        success: false,
        enabled: true,
        message: errorMsg,
        foldersCreated: 0,
        filesMoved: 0,
        errors: [{ type: 'preflight', error: errorMsg }]
      };
    }
    console.log(`  ✓ Desktop path exists`);
  } catch (error) {
    const errorMsg = `Failed to verify desktop path: ${error.message}`;
    console.error("=".repeat(60));
    console.error("EXECUTION ABORTED");
    console.error(errorMsg);
    console.error("=".repeat(60));
    return {
      success: false,
      enabled: true,
      message: errorMsg,
      foldersCreated: 0,
      filesMoved: 0,
      errors: [{ type: 'preflight', error: errorMsg }]
    };
  }
  console.log("=".repeat(60));
  
  // 🚨 HARD ABORT — NO-OP EXECUTION
  // Check if plan is missing or has no files to move
  if (!normalizedPlan) {
    console.error('🚨 Execution aborted: Execution plan missing');
    return {
      success: false,
      enabled: true,
      message: 'Execution aborted: Execution plan missing',
      foldersCreated: 0,
      filesMoved: 0,
      errors: [{ type: 'validation', error: 'Execution plan missing' }]
    };
  }
  
  const { foldersToCreate = [], filesToMove = [] } = normalizedPlan;
  
  // 🚨 HARD ABORT — NO-OP EXECUTION
  if (filesToMove.length === 0) {
    console.error('🚨 Execution aborted: 0 real file moves detected');
    return {
      success: false,
      enabled: true,
      message: 'Execution aborted: 0 real file moves detected',
      foldersCreated: 0,
      filesMoved: 0,
      errors: [{ type: 'validation', error: 'Execution aborted: 0 real file moves detected' }]
    };
  }
  
  // 🚨 HARD ABORT — PATH IDENTITY CHECK
  for (const move of filesToMove) {
    if (move.sourcePath === move.destinationPath) {
      console.error('🚨 Execution aborted: sourcePath equals destinationPath');
      console.error('  Details:', move);
      return {
        success: false,
        enabled: true,
        message: 'Execution aborted: sourcePath equals destinationPath',
        foldersCreated: 0,
        filesMoved: 0,
        errors: [{ 
          type: 'validation', 
          error: 'Execution aborted: sourcePath equals destinationPath',
          details: move
        }]
      };
    }
  }
  
  const errors = [];
  let foldersCreated = 0;
  let filesMoved = 0;
  
  try {
    // Use canonical desktop path for baseline snapshot
    const desktopPath = CANONICAL_DESKTOP_PATH;
    
    // Capture baseline snapshot ONLY AFTER confirming real moves
    // This ensures we don't overwrite baseline for no-op executions
    if (!skipBaselineSnapshot) {
      try {
        const snapshotResult = await window.electron.invoke('save-baseline-snapshot', desktopPath);
        if (snapshotResult.success) {
          console.log('Desktop baseline snapshot saved.');
        }
      } catch (error) {
        // Log but don't fail execution if snapshot fails
        console.warn('Failed to save baseline snapshot:', error.message);
      }
    }
    
    // Step 1: Create folders in deterministic order
    console.log(`Creating ${foldersToCreate.length} folders...`);
    for (const folderPath of foldersToCreate) {
      try {
        const result = await window.electron.invoke('create-folder', folderPath);
        if (result.success) {
          foldersCreated++;
        } else {
          errors.push({ type: 'folder', path: folderPath, error: result.message });
        }
      } catch (error) {
        errors.push({ type: 'folder', path: folderPath, error: error.message });
      }
    }
    
    // Step 2: Move files in deterministic order
    // Assert: filesToMove must contain FILES ONLY - directories are immovable
    console.log(`Moving ${filesToMove.length} files...`);
    const moveResults = []; // Track moves for verification
    
    for (const move of filesToMove) {
      try {
        // Safety override: Assert filesToMove contains FILES ONLY
        // If a directory slips through, log error and skip it
        const dirCheck = await window.electron.invoke('is-directory', move.sourcePath);
        if (dirCheck.isDirectory) {
          console.error(`ERROR: Directory found in filesToMove (should never happen): ${move.sourcePath}`);
          errors.push({ type: 'directory-in-move-plan', path: move.sourcePath, error: 'Directory should never be in filesToMove' });
          continue;
        }
        
        const result = await window.electron.invoke('move-file', move.sourcePath, move.destinationPath);
        if (result.success) {
          filesMoved++;
          moveResults.push({ sourcePath: move.sourcePath, destinationPath: move.destinationPath, success: true });
        } else {
          errors.push({ type: 'move', source: move.sourcePath, destination: move.destinationPath, error: result.message });
          moveResults.push({ sourcePath: move.sourcePath, destinationPath: move.destinationPath, success: false });
        }
      } catch (error) {
        errors.push({ type: 'move', source: move.sourcePath, destination: move.destinationPath, error: error.message });
        moveResults.push({ sourcePath: move.sourcePath, destinationPath: move.destinationPath, success: false });
      }
    }
    
    // 🚨 MANDATORY POST-EXECUTION VERIFICATION
    // Verify each moved file actually exists at destination and no longer exists at source
    console.log("=".repeat(60));
    console.log("POST-EXECUTION VERIFICATION");
    console.log(`  Verifying ${moveResults.length} file moves...`);
    
    const verificationErrors = [];
    for (const move of moveResults) {
      if (!move.success) {
        // Skip verification for moves that already failed
        continue;
      }
      
      try {
        // Verify destination exists
        const destExists = await window.electron.invoke('check-path-exists', move.destinationPath);
        if (!destExists.exists) {
          const errorMsg = `VERIFICATION FAILED: File does not exist at destination: ${move.destinationPath}`;
          console.error(`  ✗ ${errorMsg}`);
          verificationErrors.push({
            type: 'verification',
            error: errorMsg,
            source: move.sourcePath,
            destination: move.destinationPath
          });
          continue;
        }
        
        // Verify source no longer exists (file was moved, not copied)
        const sourceExists = await window.electron.invoke('check-path-exists', move.sourcePath);
        if (sourceExists.exists) {
          const errorMsg = `VERIFICATION FAILED: File still exists at source (move failed): ${move.sourcePath}`;
          console.error(`  ✗ ${errorMsg}`);
          verificationErrors.push({
            type: 'verification',
            error: errorMsg,
            source: move.sourcePath,
            destination: move.destinationPath
          });
          continue;
        }
        
        console.log(`  ✓ Verified: ${move.destinationPath.split(/[\\/]/).pop()}`);
      } catch (error) {
        const errorMsg = `VERIFICATION ERROR: Failed to verify move: ${error.message}`;
        console.error(`  ✗ ${errorMsg}`);
        verificationErrors.push({
          type: 'verification',
          error: errorMsg,
          source: move.sourcePath,
          destination: move.destinationPath
        });
      }
    }
    
    console.log("=".repeat(60));
    
    // 🚨 ABORT IF VERIFICATION FAILS
    if (verificationErrors.length > 0) {
      const errorMsg = `EXECUTION VERIFICATION FAILED: ${verificationErrors.length} file(s) failed verification`;
      console.error("=".repeat(60));
      console.error("EXECUTION FAILED - VERIFICATION ERRORS");
      console.error(errorMsg);
      verificationErrors.forEach(err => {
        console.error(`  - ${err.error}`);
        console.error(`    Source: ${err.source}`);
        console.error(`    Destination: ${err.destination}`);
      });
      console.error("=".repeat(60));
      
      // Add verification errors to errors array
      errors.push(...verificationErrors);
      
      return {
        success: false,
        enabled: true,
        message: errorMsg,
        foldersCreated,
        filesMoved,
        errors
      };
    }
    
    console.log(`✓ All ${moveResults.filter(m => m.success).length} file moves verified successfully`);
    console.log("=".repeat(60));
    
    const success = errors.length === 0;
    const message = success 
      ? `Successfully created ${foldersCreated} folders and moved ${filesMoved} files`
      : `Completed with ${errors.length} error(s). Created ${foldersCreated} folders, moved ${filesMoved} files`;
    
    console.log(message);
    if (errors.length > 0) {
      console.error('Execution errors:', errors);
    }
    
    // Notify Windows Explorer that Desktop directory has changed (only on success)
    if (success) {
      try {
        await window.electron.invoke('refresh-desktop-explorer');
      } catch (error) {
        // Log but don't fail execution if refresh fails
        console.warn('Failed to refresh Windows Explorer:', error.message);
      }
    }
    
    return {
      success,
      enabled: true,
      message,
      foldersCreated,
      filesMoved,
      errors
    };
    
  } catch (error) {
    const errorMessage = `Execution failed: ${error.message}`;
    console.error(errorMessage, error);
    return {
      success: false,
      enabled: true,
      message: errorMessage,
      foldersCreated,
      filesMoved,
      errors: [...errors, { type: 'execution', error: error.message }]
    };
  }
}
