import { useState, useMemo, useRef, useEffect } from "react";
import { groupFiles } from "./logic/groupFiles";
import { getGroupColor } from "./logic/colors";
import { generateExecutionPlan, normalizeExecutionPlan } from "./logic/executionPlan";
import { executePlan } from "./logic/executor";
import "./FadeItem.css";

function FadeItem({ children, style, group, delay, onMouseDown, reviewMode }) {
  const color = getGroupColor(group);
  // Remove halos entirely in Review Mode
  const haloThickness = reviewMode ? 0 : 6;

  return (
    <div
      className="fade-item"
      style={{
        ...style,
        "--halo-color": color,
        boxShadow: reviewMode ? "none" : `0 0 0 ${haloThickness}px ${color}`,
        animation: reviewMode
          ? `fadeInSoft 0.5s ease ${delay}ms forwards`
          : `
            fadeInSoft 0.5s ease ${delay}ms forwards,
            pulseHalo 2.4s ease-in-out ${delay + 500}ms infinite
          `
      }}
      onMouseDown={onMouseDown}
    >
      {children}
    </div>
  );
}

export default function App() {
  const [files, setFiles] = useState([]);
  const [positions, setPositions] = useState({});
  const [mode, setMode] = useState("idle");
  const [reviewMode, setReviewMode] = useState(false);
  const [draggedPositions, setDraggedPositions] = useState({});
  const [itemGroups, setItemGroups] = useState({}); // Track which group each item belongs to
  const [isDragging, setIsDragging] = useState(false);
  const [hoveredGroup, setHoveredGroup] = useState(null);
  const [dragStart, setDragStart] = useState({ filePath: null, offsetX: 0, offsetY: 0, originalGroup: null, initialMouseX: 0, initialMouseY: 0, initialElementX: 0, initialElementY: 0, hasDragged: false });
  const [undoStack, setUndoStack] = useState([]); // Stack of undo actions: [{ itemPath, fromGroup, toGroup }, ...]
  const [isRestoring, setIsRestoring] = useState(false); // Track if restore is in progress (for button disable)
  
  // Drag threshold in pixels - must move this far before drag starts
  const DRAG_THRESHOLD = 5;
  const [viewportSize, setViewportSize] = useState({ width: 1200, height: 800 });
  const containerRef = useRef(null);
  const centersDuringDragRef = useRef(null); // Store centers during drag to prevent recalculation
  const initialItemGroupsRef = useRef(null); // Store initial itemGroups state when Review Mode first enters
  const hasExecutedRef = useRef(false); // Track if execution has occurred
  const isRestoringRef = useRef(false); // Guard: prevent multiple simultaneous restore calls

  // Track viewport size for layout calculations
  useEffect(() => {
    function updateViewportSize() {
      // Don't update viewport size during drag to prevent layout recalculation
      if (isDragging) return;
      
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setViewportSize({
          width: rect.width,
          height: rect.height
        });
      } else {
        // Fallback: use window dimensions minus padding
        setViewportSize({
          width: typeof window !== 'undefined' ? window.innerWidth - 40 : 1160,
          height: 650 // Container height is fixed at 650px
        });
      }
    }

    // Initial calculation
    updateViewportSize();
    
    // Update on window resize
    window.addEventListener('resize', updateViewportSize);
    
    // Also update when container might change
    const resizeObserver = new ResizeObserver(updateViewportSize);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }
    
    return () => {
      window.removeEventListener('resize', updateViewportSize);
      resizeObserver.disconnect();
    };
  }, [isDragging]);

  async function scanDesktop(isPostExecutionRefresh = false) {
    console.log("Scan Desktop button clicked - calling scan-desktop IPC");
    const result = await window.electron.invoke("scan-desktop");
    
    // Log scan completion with item count
    console.log(`Desktop scan completed: ${result.length} items scanned`);
    
    setFiles(result);

    const scatter = {};
    result.forEach((f) => {
      scatter[f.path] = {
        x: Math.random() * 900,
        y: Math.random() * 500
      };
    });

    setPositions(scatter);
    setDraggedPositions({}); // Reset dragged positions on new scan
    setItemGroups({}); // Reset item group assignments
    setReviewMode(false); // Reset review mode
    initialItemGroupsRef.current = null; // Clear initial state reference on new scan
    setUndoStack([]); // Clear undo stack on new scan
    
    // If this is a post-execution refresh, keep hasExecutedRef true to prevent re-execution
    // Otherwise, reset it for a fresh scan
    if (!isPostExecutionRefresh) {
      hasExecutedRef.current = false; // Reset execution tracking on new scan
    }
    
    setMode("scatter");

    setTimeout(() => setMode("migrate"), 700);
    setTimeout(() => setMode("organize"), 1600); // After migrate completes (700 + 900ms transition)
    setTimeout(() => setReviewMode(true), 2500); // Enter review mode after organize completes (1600 + 900ms transition)
  }

  function handleMouseDown(e, filePath, currentX, currentY, currentGroup) {
    // Only allow dragging after organize mode completes
    if (mode !== "organize") return;
    
    // In Review Mode, keep review mode active during drag
    // Don't exit review mode when dragging starts
    
    e.preventDefault();
    
    // Capture mouse position in viewport coordinates
    const mouseX = e.clientX;
    const mouseY = e.clientY;
    
    // Capture element's bounding box in viewport coordinates
    const elementRect = e.currentTarget.getBoundingClientRect();
    
    // Compute offset from mouse to element's top-left corner (viewport coordinates)
    const offsetX = mouseX - elementRect.left;
    const offsetY = mouseY - elementRect.top;
    
    // Store current centers before starting drag to prevent recalculation
    centersDuringDragRef.current = { ...groupCenters };
    
    // Initialize drag state but don't start visual dragging until threshold is exceeded
    setIsDragging(true);
    setDragStart({
      filePath,
      offsetX: offsetX,
      offsetY: offsetY,
      originalGroup: currentGroup,
      initialMouseX: mouseX,
      initialMouseY: mouseY,
      initialElementX: elementRect.left,
      initialElementY: elementRect.top,
      hasDragged: false
    });
    
    // Don't set initial dragged position yet - wait for threshold
  }

  function handleMouseMove(e) {
    if (!isDragging || !dragStart.filePath || !containerRef.current) return;
    
    // Capture mouse position in viewport coordinates
    const mouseX = e.clientX;
    const mouseY = e.clientY;
    
    // Calculate distance from initial mouse position
    const deltaX = mouseX - dragStart.initialMouseX;
    const deltaY = mouseY - dragStart.initialMouseY;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    
    // Only start visual dragging if mouse moved beyond threshold
    if (!dragStart.hasDragged && distance < DRAG_THRESHOLD) {
      // Not yet dragged - don't update position or check hover
      return;
    }
    
    // Mark that actual dragging has occurred
    if (!dragStart.hasDragged) {
      setDragStart(prev => ({
        ...prev,
        hasDragged: true
      }));
      
      // Set initial dragged position from stored element position
      setDraggedPositions(prev => ({
        ...prev,
        [dragStart.filePath]: {
          x: dragStart.initialElementX,
          y: dragStart.initialElementY
        }
      }));
    }
    
    // Position element so it stays under the cursor (viewport coordinates for position: fixed)
    const elementLeft = mouseX - dragStart.offsetX;
    const elementTop = mouseY - dragStart.offsetY;
    
    // Update dragged position using viewport coordinates
    setDraggedPositions(prev => ({
      ...prev,
      [dragStart.filePath]: {
        x: elementLeft,
        y: elementTop
      }
    }));
    
    // Check which group (if any) the mouse is hovering over
    // Convert to container-relative coordinates for hover detection
    const containerRect = containerRef.current.getBoundingClientRect();
    const containerX = mouseX - containerRect.left;
    const containerY = mouseY - containerRect.top;
    const hovered = findGroupAtPosition(containerX, containerY);
    setHoveredGroup(hovered);
  }
  
  function findGroupAtPosition(x, y) {
    if (reviewMode) {
      // In Review Mode, find group by checking which card element contains the point
      // Use DOM query to find the actual card element at this position
      // Only check non-empty clusters (empty clusters are filtered out in rendering)
      if (containerRef.current) {
        const elements = containerRef.current.querySelectorAll('[data-cluster-card]');
        for (const card of elements) {
          const rect = card.getBoundingClientRect();
          const containerRect = containerRef.current.getBoundingClientRect();
          const relativeX = x;
          const relativeY = y;
          
          // Check if point is within card bounds (relative to container)
          const cardLeft = rect.left - containerRect.left;
          const cardRight = rect.right - containerRect.left;
          const cardTop = rect.top - containerRect.top;
          const cardBottom = rect.bottom - containerRect.top;
          
          if (relativeX >= cardLeft && relativeX <= cardRight && 
              relativeY >= cardTop && relativeY <= cardBottom) {
            const groupName = card.getAttribute('data-cluster-name');
            // Verify the group actually has items (should always be true since empty clusters are filtered)
            if (groupName && groups[groupName] && groups[groupName].length > 0) {
              return groupName;
            }
          }
        }
      }
      return null;
    } else {
      // Normal mode: use spatial positioning
      const clusterMaxWidth = 400;
      const clusterPadding = 10;
      const clusterHalfWidth = clusterMaxWidth / 2;
      const clusterMaxHeight = 350;
      
      for (const [groupName, center] of Object.entries(groupCenters)) {
        const left = center.x - clusterHalfWidth;
        const right = center.x + clusterHalfWidth;
        const top = center.y - clusterMaxHeight / 2;
        const bottom = center.y + clusterMaxHeight / 2;
        
        if (x >= left && x <= right && y >= top && y <= bottom) {
          return groupName;
        }
      }
      return null;
    }
  }

  function handleMouseUp() {
    if (!isDragging || !dragStart.filePath) {
      setIsDragging(false);
      setHoveredGroup(null);
      return;
    }
    
    // If drag distance was less than threshold, treat as click - do nothing
    if (!dragStart.hasDragged) {
      // Cancel drag - no move occurred
      setIsDragging(false);
      setHoveredGroup(null);
      setDraggedPositions(prev => {
        const next = { ...prev };
        delete next[dragStart.filePath];
        return next;
      });
      setDragStart({ filePath: null, offsetX: 0, offsetY: 0, originalGroup: null, initialMouseX: 0, initialMouseY: 0, initialElementX: 0, initialElementY: 0, hasDragged: false });
      return;
    }
    
    // Only process drop if actual dragging occurred
    const wasDroppedIntoGroup = hoveredGroup && hoveredGroup !== dragStart.originalGroup;
    const wasDroppedFreeFloating = !hoveredGroup;
    
    // Track the move for undo functionality (only if actually moved)
    if (wasDroppedIntoGroup || wasDroppedFreeFloating) {
      // Capture the move information for undo and push onto stack
      const fromGroup = dragStart.originalGroup;
      const toGroup = wasDroppedIntoGroup ? hoveredGroup : null;
      
      setUndoStack(prev => [...prev, {
        itemPath: dragStart.filePath,
        fromGroup: fromGroup,
        toGroup: toGroup
      }]);
    }
    
    // If dropped on a different group, reassign the item
    if (wasDroppedIntoGroup) {
      // Update item's assigned group - this triggers groups recalculation
      setItemGroups(prev => ({
        ...prev,
        [dragStart.filePath]: hoveredGroup
      }));
      
      // Clear dragged position so item uses grid layout calculation
      // This allows smooth transition to new group position
      setDraggedPositions(prev => {
        const next = { ...prev };
        delete next[dragStart.filePath];
        return next;
      });
      
      // Enter review mode after reassignment completes
      setTimeout(() => setReviewMode(true), 900); // After transition completes
    } else if (wasDroppedFreeFloating) {
      // Dropped outside all groups - mark as explicitly ungrouped
      // Do NOT trigger auto-layout recalculation for free-floating items
      setItemGroups(prev => ({
        ...prev,
        [dragStart.filePath]: null // null means explicitly ungrouped
      }));
      // Keep dragged position (already set in handleMouseMove)
    } else {
      // Dropped on same group - clear drag but keep group assignment
      // Clear dragged position to snap back to grid
      setDraggedPositions(prev => {
        const next = { ...prev };
        delete next[dragStart.filePath];
        return next;
      });
    }
    
    // Clear stored centers before ending drag to ensure fresh recalculation
    // This ensures layout updates after dropping into a group
    if (wasDroppedIntoGroup) {
      centersDuringDragRef.current = null;
    }
    
    // End drag state - this will allow auto-layout to recalculate if needed
    // The groupCenters useMemo will recalculate once isDragging becomes false
    setIsDragging(false);
    setHoveredGroup(null);
    setDragStart({ filePath: null, offsetX: 0, offsetY: 0, originalGroup: null, initialMouseX: 0, initialMouseY: 0, hasDragged: false });
  }

  // Reset to initial auto-grouped state (UI only, no filesystem changes)
  function resetToAutoGroupedState() {
    // Restore itemGroups to initial auto-grouped state
    // Empty object {} means all items are in their original groups
    if (initialItemGroupsRef.current !== null) {
      setItemGroups({ ...initialItemGroupsRef.current });
    } else {
      // If snapshot doesn't exist yet, use empty object (default auto-grouped state)
      setItemGroups({});
    }
    
    // Clear all dragged positions to restore visual state
    setDraggedPositions({});
    
    // Clear any drag state
    setIsDragging(false);
    setHoveredGroup(null);
    setDragStart({ filePath: null, offsetX: 0, offsetY: 0, originalGroup: null });
    
    // Clear undo stack on reset
    setUndoStack([]);
  }

  // Restore Desktop - explicitly user-triggered, one-shot per click
  // Executes immediately: restore → scan → update UI
  // No file watchers or delayed execution - all operations complete synchronously
  async function restoreDesktop() {
    // Guard: If restore is already running, ignore additional calls
    if (isRestoringRef.current || isRestoring) {
      console.log("Restore already in progress, ignoring duplicate call");
      return;
    }
    
    // Set guards to prevent concurrent calls
    isRestoringRef.current = true;
    setIsRestoring(true);
    
    try {
      console.log("=".repeat(60));
      console.log("RESTORE DESKTOP - User triggered");
      console.log("=".repeat(60));
      
      // Restore real desktop from baseline snapshot
      // Uses ONLY .desktop_organizer_baseline.json
      // All file moves execute synchronously - function returns only after all moves complete
      const result = await window.desktopApi.restoreDesktop();
      
      // Restore has completed - all files have been physically moved
      // Now trigger immediate scan to refresh UI with new filesystem state
      console.log("=".repeat(60));
      if (result && result.ok === true) {
        console.log(`Desktop restore completed successfully: ${result.restoredCount} items restored`);
      } else {
        console.error("Desktop restore failed:", result?.error || "Unknown error");
      }
      console.log("=".repeat(60));
      
      // Force immediate desktop scan to refresh UI
      // This scan will pick up the restored filesystem state immediately
      // No file watchers needed - scan happens immediately after restore completes
      console.log("Refreshing UI from restored desktop...");
      await scanDesktop(true); // Pass true to indicate post-restore refresh
      
      console.log("Restore and UI refresh completed");
    } catch (error) {
      console.error("Restore error:", error);
      // On error, still refresh UI to show current state
      console.log("Refreshing UI after restore error...");
      await scanDesktop(true);
    } finally {
      // Always clear guards when restore completes (success or failure)
      isRestoringRef.current = false;
      setIsRestoring(false);
    }
  }

  // Undo last move from stack
  function undoLastMove() {
    if (undoStack.length === 0) return;
    
    // Pop the most recent action from the stack
    const stack = [...undoStack];
    const lastMove = stack.pop();
    
    if (!lastMove) return;
    
    const { itemPath, fromGroup } = lastMove;
    
    // Restore item to its previous group
    setItemGroups(prev => {
      const next = { ...prev };
      if (fromGroup === null) {
        // Was explicitly ungrouped, restore that state
        next[itemPath] = null;
      } else {
        // Was in a specific group, restore it
        // If it was in its original group, we set it to that group name
        // The groups useMemo will handle it correctly and restore empty clusters
        next[itemPath] = fromGroup;
      }
      return next;
    });
    
    // Clear dragged position to allow proper grid layout
    setDraggedPositions(prev => {
      const next = { ...prev };
      delete next[itemPath];
      return next;
    });
    
    // Update undo stack to remove the action we just undid
    setUndoStack(stack);
  }

  // Capture initial itemGroups state when Review Mode is first entered
  useEffect(() => {
    if (reviewMode && initialItemGroupsRef.current === null) {
      // Capture the initial state (empty object means all items in original groups)
      // This happens only once when Review Mode is first activated after auto-grouping
      initialItemGroupsRef.current = { ...itemGroups };
    }
  }, [reviewMode]); // Only depend on reviewMode, not itemGroups, to capture once

  const originalGroups = useMemo(() => groupFiles(files), [files]);
  
  // Reorganize groups based on item assignments (for display purposes)
  const groups = useMemo(() => {
    const reorganized = {};
    
    // Start with original groups
    Object.entries(originalGroups).forEach(([group, items]) => {
      reorganized[group] = [];
    });
    
    // Distribute items based on their assigned groups
    // Items with null assignment are ungrouped and excluded
    Object.entries(originalGroups).forEach(([originalGroup, items]) => {
      items.forEach(file => {
        const assignedGroup = itemGroups[file.path];
        // If explicitly set to null, item is ungrouped - skip it
        if (assignedGroup === null) {
          return;
        }
        // Use assigned group or fall back to original
        const targetGroup = assignedGroup !== undefined ? assignedGroup : originalGroup;
        if (!reorganized[targetGroup]) {
          reorganized[targetGroup] = [];
        }
        reorganized[targetGroup].push(file);
      });
    });
    
    return reorganized;
  }, [originalGroups, itemGroups]);
  
  // Get ungrouped items (those explicitly set to null)
  const ungroupedItems = useMemo(() => {
    return Object.entries(originalGroups)
      .flatMap(([group, items]) => items)
      .filter(file => itemGroups[file.path] === null);
  }, [originalGroups, itemGroups]);
  
  // Get ALL items that are not in any group (including those skipped by groupFiles)
  // This ensures ALL scanned items are rendered, regardless of grouping logic
  const trulyUngroupedItems = useMemo(() => {
    // Get all file paths that are in groups
    const groupedPaths = new Set(
      Object.values(originalGroups).flatMap(items => items.map(f => f.path))
    );
    
    // Return all files from scan that are:
    // 1. Not in any group (not in groupedPaths), OR
    // 2. Explicitly set to null in itemGroups
    return files.filter(file => {
      const isInGroup = groupedPaths.has(file.path);
      const isExplicitlyUngrouped = itemGroups[file.path] === null;
      return !isInGroup || isExplicitlyUngrouped;
    });
  }, [files, originalGroups, itemGroups]);

  // Organize Desktop - generates and executes execution plan
  // This function is called explicitly when user clicks "Organize" button
  // It does NOT run automatically on scan
  // 🚨 UI SAFETY: Errors in plan generation must NOT clear UI state
  async function organizeDesktop() {
    if (files.length === 0 || Object.keys(originalGroups).length === 0) {
      console.log("Cannot organize: no files or groups available");
      return;
    }
    
    // Prevent re-execution if we're refreshing UI after execution
    if (hasExecutedRef.current) {
      console.log("Execution already in progress or completed - skipping");
      return;
    }
    
    // Derive desktop path from first file's absolute path
    // Extract directory by finding last path separator (handles both \ and /)
    const firstFilePath = files[0].path;
    const lastBackslash = firstFilePath.lastIndexOf('\\');
    const lastSlash = firstFilePath.lastIndexOf('/');
    const lastSeparator = Math.max(lastBackslash, lastSlash);
    const desktopPath = lastSeparator >= 0 ? firstFilePath.substring(0, lastSeparator) : firstFilePath;
    
    // 🚨 UI SAFETY: Wrap plan generation in try-catch to prevent errors from clearing UI state
    let rawPlan;
    let normalizedPlan;
    
    try {
      // Use originalGroups (from auto-grouping) for execution plan, NOT groups (which includes UI drag changes)
      rawPlan = generateExecutionPlan(originalGroups, desktopPath, files);
      normalizedPlan = normalizeExecutionPlan(rawPlan, originalGroups, files);
    } catch (error) {
      // Plan generation failed - log error and exit cleanly WITHOUT mutating UI state
      console.error("=".repeat(60));
      console.error("EXECUTION PLAN GENERATION FAILED");
      console.error("Error:", error.message);
      console.error("=".repeat(60));
      console.error("UI state preserved - no changes made to desktop items, halos, or colors");
      // Exit cleanly - do NOT call scanDesktop, do NOT clear UI state, do NOT reset anything
      return;
    }
    
    console.log('Raw Execution Plan:', JSON.stringify(rawPlan, null, 2));
    console.log('Normalized Execution Plan:', JSON.stringify(normalizedPlan, null, 2));
    
    // VALIDATION: Filter out no-op moves (sourcePath === destinationPath)
    // Normalize paths for comparison (case-insensitive, handle path separators)
    const normalizePath = (p) => p.replace(/\\/g, '/').toLowerCase();
    const realMoves = normalizedPlan.filesToMove.filter(move => {
      const source = normalizePath(move.sourcePath);
      const dest = normalizePath(move.destinationPath);
      return source !== dest;
    });
    
    // Check if there are any real operations to perform
    const hasRealMoves = realMoves.length > 0;
    const hasFoldersToCreate = normalizedPlan.foldersToCreate.length > 0;
    const hasRealOperations = hasRealMoves || hasFoldersToCreate;
    
    // If ALL files are filtered out (no real moves) and no folders to create, abort execution
    if (!hasRealOperations) {
      console.log("=".repeat(60));
      console.log("NO-OP EXECUTION: all destinations equal sources");
      console.log(`  Filtered out ${normalizedPlan.filesToMove.length} no-op moves`);
      console.log(`  Folders to create: ${normalizedPlan.foldersToCreate.length}`);
      console.log("  Execution aborted - desktop will not change");
      console.log("  Baseline will NOT be overwritten");
      console.log("=".repeat(60));
      
      // Mark execution as occurred to prevent re-execution, but don't actually execute
      hasExecutedRef.current = true;
      
      // Don't call executor or save baseline for no-op execution
      // Trigger scan to refresh UI (but mark as post-execution to prevent re-execution)
      scanDesktop(true);
      return;
    }
    
    // Create filtered plan with only real moves
    const filteredPlan = {
      foldersToCreate: normalizedPlan.foldersToCreate,
      filesToMove: realMoves
    };
    
    if (realMoves.length < normalizedPlan.filesToMove.length) {
      console.log(`Filtered out ${normalizedPlan.filesToMove.length - realMoves.length} no-op moves (sourcePath === destinationPath)`);
      console.log(`Proceeding with ${realMoves.length} real moves`);
    }
    
    // Execute plan immediately after it's finalized
    console.log("EXECUTION STARTED");
    
    // Mark execution as occurred immediately to track state
    hasExecutedRef.current = true;
    
    // Call executor with filtered plan and handle completion
    // Skip baseline snapshot on re-execution (after first execution)
    const skipBaseline = false; // Always take baseline on first execution
    executePlan(filteredPlan, skipBaseline).then((result) => {
      if (result.success) {
        console.log("EXECUTION COMPLETED SUCCESSFULLY - Refreshing UI from desktop scan");
        // After successful execution, trigger fresh desktop scan to refresh UI
        // This will rebuild UI state from actual desktop contents post-execution
        // Pass true to indicate this is a post-execution refresh (prevents re-execution)
        scanDesktop(true);
      } else {
        console.log("EXECUTION COMPLETED WITH ERRORS - UI state unchanged");
        // On error, don't refresh - keep current UI state
        hasExecutedRef.current = false; // Allow retry on error
      }
    }).catch((error) => {
      console.error("EXECUTION FAILED:", error);
      // On failure, don't refresh - keep current UI state
      hasExecutedRef.current = false; // Allow retry on failure
    });
  }

  const groupCenters = useMemo(() => {
    // During drag, return stored centers to prevent layout recalculation
    // This guard prevents ALL auto-layout logic from running during drag
    if (isDragging) {
      if (centersDuringDragRef.current) {
        return centersDuringDragRef.current;
      }
      // If no stored centers, return empty (shouldn't happen, but safe fallback)
      return {};
    }
    
    const centers = {};
    // Use originalGroups for stable center calculation
    const groupKeys = Object.keys(originalGroups);
    const groupCount = groupKeys.length;
    
    if (groupCount === 0) {
      centersDuringDragRef.current = centers;
      return centers;
    }
    
    // Use actual viewport dimensions from container
    // viewportSize already accounts for container dimensions
    const containerWidth = viewportSize.width;
    const containerHeight = viewportSize.height;
    
    // Fixed-width cluster containers with wrapping
    const clusterMaxWidth = 400; // Fixed max width for cluster containers
    const itemSpacingX = 130;
    const itemSpacingY = 50;
    const itemWidth = 100;
    const itemHeight = 40;
    const clusterPadding = 10; // Internal padding inside cluster
    
    // Calculate how many items fit per row in fixed-width container
    const itemsPerRow = Math.floor((clusterMaxWidth - clusterPadding * 2) / itemSpacingX);
    const effectiveItemsPerRow = Math.max(1, itemsPerRow);
    
    // Calculate maximum cluster dimensions based on actual item counts
    let maxClusterWidth = clusterMaxWidth;
    let maxClusterHeight = itemHeight + clusterPadding * 2; // Minimum height
    
    Object.entries(originalGroups).forEach(([groupName, items]) => {
      const itemCount = items.length;
      const rows = Math.ceil(itemCount / effectiveItemsPerRow);
      const clusterHeight = rows * itemSpacingY + itemHeight + clusterPadding * 2;
      maxClusterHeight = Math.max(maxClusterHeight, clusterHeight);
    });
    
    // In Review Mode, use column-based layout for clean vertical scanning
    if (reviewMode) {
      // Fixed column width and consistent vertical spacing
      const columnWidth = maxClusterWidth; // Fixed column width
      const verticalSpacing = 30; // Consistent spacing between clusters vertically
      const horizontalSpacing = 20; // Spacing between columns
      
      // Calculate actual height for each cluster
      const clusterHeights = {};
      groupKeys.forEach((groupName) => {
        const items = originalGroups[groupName] || [];
        const itemCount = items.length;
        const rows = Math.ceil(itemCount / effectiveItemsPerRow);
        const clusterHeight = rows * itemSpacingY + itemHeight + clusterPadding * 2;
        clusterHeights[groupName] = clusterHeight;
      });
      
      // Column-based layout algorithm
      const topMargin = 10; // Small margin from top
      const bottomMargin = 10; // Small margin from bottom
      const availableHeight = containerHeight - topMargin - bottomMargin;
      
      let currentColumnX = columnWidth / 2; // Start at left edge, center of first column
      let currentY = topMargin; // Start at top margin (top edge of first cluster)
      
      groupKeys.forEach((groupName) => {
        const clusterHeight = clusterHeights[groupName];
        
        // Check if this cluster would exceed vertical capacity of current column
        if (currentY + clusterHeight > availableHeight && currentY > topMargin) {
          // Start new column to the right
          currentColumnX += columnWidth + horizontalSpacing;
          currentY = topMargin; // Reset to top of new column
        }
        
        // Position cluster in current column (center Y of cluster)
        centers[groupName] = {
          x: currentColumnX,
          y: currentY + clusterHeight / 2
        };
        
        // Move down for next cluster in column (top edge of next cluster)
        currentY += clusterHeight + verticalSpacing;
      });
    } else {
      // Normal mode: use original calculation with optional spacing multiplier
      const spacingMultiplier = reviewMode ? 1.25 : 1;
      
      // Calculate spacing between group centers
      const aspectRatio = containerWidth / containerHeight;
      const cols = Math.ceil(Math.sqrt(groupCount * aspectRatio));
      const rows = Math.ceil(groupCount / cols);
      
      const baseHorizontalSpacing = cols > 1 
        ? Math.max(300, (containerWidth - maxClusterWidth) / (cols - 1))
        : containerWidth / 2;
      const baseVerticalSpacing = rows > 1
        ? Math.max(200, (containerHeight - maxClusterHeight) / (rows - 1))
        : containerHeight / 2;
      
      const horizontalSpacing = baseHorizontalSpacing * spacingMultiplier;
      const verticalSpacing = baseVerticalSpacing * spacingMultiplier;
      
      const marginX = Math.max(50, (containerWidth - (cols - 1) * horizontalSpacing - maxClusterWidth) / 2);
      const marginY = Math.max(50, (containerHeight - (rows - 1) * verticalSpacing - maxClusterHeight) / 2);
      const startX = marginX + maxClusterWidth / 2;
      const startY = marginY + maxClusterHeight / 2;
      
      // Distribute groups in grid
      groupKeys.forEach((group, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        
        centers[group] = {
          x: startX + col * horizontalSpacing,
          y: startY + row * verticalSpacing
        };
      });
    }
    
    // Store centers for use during drag
    centersDuringDragRef.current = centers;
    return centers;
  }, [originalGroups, reviewMode, viewportSize, isDragging]); // Include isDragging to trigger recalculation after drag ends

  return (
    <div style={{ padding: 20, fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", gap: "10px", marginBottom: "10px", alignItems: "center" }}>
        <button onClick={() => scanDesktop()}>Scan Desktop</button>
        <button
          onClick={organizeDesktop}
          disabled={files.length === 0 || Object.keys(originalGroups).length === 0 || hasExecutedRef.current}
          style={{
            padding: "8px 16px",
            backgroundColor: (files.length === 0 || Object.keys(originalGroups).length === 0 || hasExecutedRef.current) ? "#cccccc" : "#28a745",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: (files.length === 0 || Object.keys(originalGroups).length === 0 || hasExecutedRef.current) ? "not-allowed" : "pointer",
            fontSize: "13px",
            fontWeight: "500",
            transition: "background-color 0.2s ease",
            opacity: (files.length === 0 || Object.keys(originalGroups).length === 0 || hasExecutedRef.current) ? 0.6 : 1
          }}
          onMouseEnter={(e) => {
            if (!(files.length === 0 || Object.keys(originalGroups).length === 0 || hasExecutedRef.current)) {
              e.currentTarget.style.backgroundColor = "#218838";
            }
          }}
          onMouseLeave={(e) => {
            if (!(files.length === 0 || Object.keys(originalGroups).length === 0 || hasExecutedRef.current)) {
              e.currentTarget.style.backgroundColor = "#28a745";
            }
          }}
        >
          Organize
        </button>
        {reviewMode && (
          <>
            <button
              onClick={undoLastMove}
              disabled={undoStack.length === 0}
              style={{
                padding: "8px 16px",
                backgroundColor: undoStack.length > 0 ? "#17a2b8" : "#cccccc",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: undoStack.length > 0 ? "pointer" : "not-allowed",
                fontSize: "13px",
                fontWeight: "500",
                transition: "background-color 0.2s ease",
                opacity: undoStack.length > 0 ? 1 : 0.6
              }}
              onMouseEnter={(e) => {
                if (undoStack.length > 0) {
                  e.currentTarget.style.backgroundColor = "#138496";
                }
              }}
              onMouseLeave={(e) => {
                if (undoStack.length > 0) {
                  e.currentTarget.style.backgroundColor = "#17a2b8";
                }
              }}
            >
              Undo{undoStack.length > 0 ? ` (${undoStack.length})` : ''}
            </button>
            <button
              onClick={resetToAutoGroupedState}
              style={{
                padding: "8px 16px",
                backgroundColor: "#6c757d",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "13px",
                fontWeight: "500",
                transition: "background-color 0.2s ease"
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#5a6268"}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "#6c757d"}
            >
              Reset to Auto-Grouped State
            </button>
            <button
              onClick={restoreDesktop}
              disabled={isRestoring}
              style={{
                padding: "8px 16px",
                backgroundColor: isRestoring ? "#cccccc" : "#dc3545",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: isRestoring ? "not-allowed" : "pointer",
                fontSize: "13px",
                fontWeight: "500",
                transition: "background-color 0.2s ease",
                opacity: isRestoring ? 0.6 : 1
              }}
              onMouseEnter={(e) => {
                if (!isRestoring) {
                  e.currentTarget.style.backgroundColor = "#c82333";
                }
              }}
              onMouseLeave={(e) => {
                if (!isRestoring) {
                  e.currentTarget.style.backgroundColor = "#dc3545";
                }
              }}
            >
              {isRestoring ? "Restoring..." : "Restore Desktop"}
            </button>
          </>
        )}
      </div>

      <div
        ref={containerRef}
        style={{
          position: "relative",
          width: "100%",
          height: "650px",
          marginTop: 20,
          overflow: reviewMode ? "auto" : "visible"
        }}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {reviewMode ? (
          /* Review Mode: Card-style cluster panels in responsive grid */
          <div
            style={{
              padding: "16px",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: "20px",
              alignContent: "start"
            }}
          >
            {Object.entries(groups)
              .filter(([groupName, items]) => items.length > 0) // Remove empty clusters in Review Mode
              .map(([groupName, items]) => {
              const isHovered = isDragging && hoveredGroup === groupName;
              const itemCount = items.length;
              const groupColor = getGroupColor(groupName);
              
              return (
                <div
                  key={groupName}
                  data-cluster-card
                  data-cluster-name={groupName}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    border: `1px solid ${isHovered ? groupColor : '#e0e0e0'}`,
                    borderLeft: `4px solid ${groupColor}`,
                    borderRadius: "8px",
                    backgroundColor: isHovered ? '#fafafa' : '#fff',
                    boxShadow: isHovered 
                      ? `0 4px 12px rgba(0, 0, 0, 0.1), 0 0 0 1px ${groupColor}20`
                      : "0 2px 4px rgba(0, 0, 0, 0.05)",
                    transition: "all 0.2s ease",
                    overflow: "hidden",
                    minHeight: "120px"
                  }}
                >
                  {/* Cluster header with color accent */}
                  <div
                    style={{
                      padding: "14px 16px",
                      backgroundColor: "#f8f9fa",
                      borderBottom: `2px solid ${groupColor}40`,
                      position: "relative"
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        bottom: 0,
                        left: 0,
                        right: 0,
                        height: "2px",
                        backgroundColor: groupColor,
                        opacity: 0.6
                      }}
                    />
                    <div
                      style={{
                        fontWeight: "600",
                        fontSize: "13px",
                        color: "#2c3e50",
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                        position: "relative",
                        zIndex: 1
                      }}
                    >
                      {groupName}
                    </div>
                    <div
                      style={{
                        fontSize: "11px",
                        color: "#6c757d",
                        marginTop: "4px",
                        fontWeight: "400",
                        textTransform: "none",
                        letterSpacing: "normal",
                        position: "relative",
                        zIndex: 1
                      }}
                    >
                      {itemCount} {itemCount === 1 ? 'item' : 'items'}
                    </div>
                  </div>
                  
                  {/* Items list */}
                  <div style={{ padding: "8px 0", flex: 1 }}>
                    {items.map((f, idx) => {
                      const draggedPos = draggedPositions[f.path];
                      const assignedGroup = itemGroups[f.path] !== undefined ? itemGroups[f.path] : groupName;
                      const isCurrentlyDragging = isDragging && dragStart.filePath === f.path;
                      
                      return (
                        <FadeItem
                          key={f.path}
                          group={assignedGroup}
                          delay={0}
                          reviewMode={reviewMode}
                          style={{
                            display: "block",
                            position: isCurrentlyDragging ? "fixed" : (draggedPos ? "absolute" : "relative"),
                            ...(isCurrentlyDragging && draggedPos && draggedPos.x !== undefined && draggedPos.y !== undefined ? {
                              left: `${draggedPos.x}px`,
                              top: `${draggedPos.y}px`,
                              transform: "none"
                            } : draggedPos && draggedPos.x !== undefined && draggedPos.y !== undefined ? {
                              transform: `translate(${draggedPos.x}px, ${draggedPos.y}px)`
                            } : {
                              transform: "none"
                            }),
                            padding: "8px 16px",
                            margin: "2px 0",
                            backgroundColor: isCurrentlyDragging ? "#f0f0f0" : "transparent",
                            cursor: isCurrentlyDragging ? "grabbing" : (mode === "organize" ? "grab" : "default"),
                            zIndex: isCurrentlyDragging ? 1000 : "auto",
                            userSelect: "none",
                            fontSize: "13px",
                            color: "#495057",
                            border: "none",
                            borderRadius: "0",
                            transition: isCurrentlyDragging ? "none" : "background-color 0.15s ease"
                          }}
                          onMouseEnter={(e) => {
                            if (!isCurrentlyDragging && mode === "organize") {
                              e.currentTarget.style.backgroundColor = "#f8f9fa";
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!isCurrentlyDragging) {
                              e.currentTarget.style.backgroundColor = "transparent";
                            }
                          }}
                          onMouseDown={(e) => {
                            if (mode === "organize") {
                              const rect = containerRef.current?.getBoundingClientRect();
                              if (rect) {
                                const mouseX = e.clientX - rect.left;
                                const mouseY = e.clientY - rect.top;
                                handleMouseDown(e, f.path, mouseX, mouseY, assignedGroup);
                              }
                            }
                          }}
                        >
                          {f.name}
                        </FadeItem>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            
            {/* Ungrouped items card */}
            {trulyUngroupedItems.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  border: "1px solid #e0e0e0",
                  borderLeft: "4px solid #9E9E9E",
                  borderRadius: "8px",
                  backgroundColor: "#fff",
                  boxShadow: "0 2px 4px rgba(0, 0, 0, 0.05)",
                  overflow: "hidden",
                  minHeight: "120px"
                }}
              >
                <div
                  style={{
                    padding: "14px 16px",
                    backgroundColor: "#f8f9fa",
                    borderBottom: "2px solid #9E9E9E40",
                    position: "relative"
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      bottom: 0,
                      left: 0,
                      right: 0,
                      height: "2px",
                      backgroundColor: "#9E9E9E",
                      opacity: 0.6
                    }}
                  />
                  <div
                    style={{
                      fontWeight: "600",
                      fontSize: "13px",
                      color: "#2c3e50",
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                      position: "relative",
                      zIndex: 1
                    }}
                  >
                    Ungrouped
                  </div>
                  <div
                    style={{
                      fontSize: "11px",
                      color: "#6c757d",
                      marginTop: "4px",
                      fontWeight: "400",
                      textTransform: "none",
                      letterSpacing: "normal",
                      position: "relative",
                      zIndex: 1
                    }}
                  >
                    {trulyUngroupedItems.length} {trulyUngroupedItems.length === 1 ? 'item' : 'items'}
                  </div>
                </div>
                <div style={{ padding: "8px 0", flex: 1 }}>
                  {trulyUngroupedItems.map((f) => {
                    const draggedPos = draggedPositions[f.path];
                    const isCurrentlyDragging = isDragging && dragStart.filePath === f.path;
                    
                    return (
                      <FadeItem
                        key={f.path}
                        group={null}
                        delay={0}
                        reviewMode={reviewMode}
                        style={{
                          display: "block",
                          position: isCurrentlyDragging ? "fixed" : (draggedPos ? "absolute" : "relative"),
                          ...(isCurrentlyDragging && draggedPos && draggedPos.x !== undefined && draggedPos.y !== undefined ? {
                            left: `${draggedPos.x}px`,
                            top: `${draggedPos.y}px`,
                            transform: "none"
                          } : draggedPos && draggedPos.x !== undefined && draggedPos.y !== undefined ? {
                            transform: `translate(${draggedPos.x}px, ${draggedPos.y}px)`
                          } : {
                            transform: "none"
                          }),
                          padding: "8px 16px",
                          margin: "2px 0",
                          backgroundColor: isCurrentlyDragging ? "#f0f0f0" : "transparent",
                          cursor: isCurrentlyDragging ? "grabbing" : (mode === "organize" ? "grab" : "default"),
                          zIndex: isCurrentlyDragging ? 1000 : "auto",
                          userSelect: "none",
                          fontSize: "13px",
                          color: "#495057",
                          border: "none",
                          borderRadius: "0",
                          transition: isCurrentlyDragging ? "none" : "background-color 0.15s ease"
                        }}
                        onMouseEnter={(e) => {
                          if (!isCurrentlyDragging && mode === "organize") {
                            e.currentTarget.style.backgroundColor = "#f8f9fa";
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isCurrentlyDragging) {
                            e.currentTarget.style.backgroundColor = "transparent";
                          }
                        }}
                        onMouseDown={(e) => {
                          if (mode === "organize") {
                            const rect = containerRef.current?.getBoundingClientRect();
                            if (rect) {
                              const mouseX = e.clientX - rect.left;
                              const mouseY = e.clientY - rect.top;
                              handleMouseDown(e, f.path, mouseX, mouseY, null);
                            }
                          }
                        }}
                      >
                        {f.name}
                      </FadeItem>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Normal Mode: Spatial layout */
          <>
            {/* Visual drop zones for groups when dragging */}
            {isDragging && Object.entries(groupCenters).map(([groupName, center]) => {
              const isHovered = hoveredGroup === groupName;
              const groupColor = getGroupColor(groupName);
              const clusterMaxWidth = 400;
              const clusterMaxHeight = 350;
              
              return (
                <div
                  key={`dropzone-${groupName}`}
                  style={{
                    position: "absolute",
                    left: center.x - clusterMaxWidth / 2,
                    top: center.y - clusterMaxHeight / 2,
                    width: clusterMaxWidth,
                    height: clusterMaxHeight,
                    borderRadius: 12,
                    border: `2px dashed ${isHovered ? groupColor : 'rgba(128, 128, 128, 0.3)'}`,
                    backgroundColor: isHovered ? `${groupColor}15` : 'transparent',
                    boxShadow: isHovered ? `0 0 20px ${groupColor}40` : 'none',
                    pointerEvents: "none",
                    transition: "all 0.2s ease",
                    zIndex: 100
                  }}
                />
              );
            })}
            
            {/* Render ungrouped items separately */}
            {trulyUngroupedItems.map((f) => {
              const base = positions[f.path] || { x: 0, y: 0 };
              const draggedPos = draggedPositions[f.path];
              const isCurrentlyDragging = isDragging && dragStart.filePath === f.path;
              
              let x, y;
              if (draggedPos && draggedPos.x !== undefined && draggedPos.y !== undefined) {
                x = draggedPos.x;
                y = draggedPos.y;
              } else {
                // Use scatter position from scan
                x = base.x;
                y = base.y;
              }
              
              return (
                <FadeItem
                  key={f.path}
                  group={null}
                  delay={0}
                  reviewMode={reviewMode}
                  style={{
                    position: isCurrentlyDragging ? "fixed" : "absolute",
                    ...(isCurrentlyDragging && draggedPos && draggedPos.x !== undefined && draggedPos.y !== undefined ? {
                      left: `${draggedPos.x}px`,
                      top: `${draggedPos.y}px`,
                      transform: "none"
                    } : {
                      transform: `translate(${x}px, ${y}px)`
                    }),
                    transition: isCurrentlyDragging ? "none" : "transform 0.9s ease",
                    cursor: mode === "organize" ? "grab" : "default",
                    userSelect: "none"
                  }}
                  onMouseDown={(e) => handleMouseDown(e, f.path, x, y, null)}
                >
                  {f.name}
                </FadeItem>
              );
            })}
            
            {Object.entries(groups).map(([group, items]) =>
              items.map((f, idx) => {
                const base = positions[f.path] || { x: 0, y: 0 };
                const center = groupCenters[group];
                const draggedPos = draggedPositions[f.path];
                const assignedGroup = itemGroups[f.path] !== undefined ? itemGroups[f.path] : group;
                if (assignedGroup === null) return null;
                const assignedCenter = groupCenters[assignedGroup] || center;
                
                const clusterMaxWidth = 400;
                const itemSpacingX = 130;
                const itemSpacingY = 50;
                const clusterPadding = 10;
                const itemsPerRow = Math.floor((clusterMaxWidth - clusterPadding * 2) / itemSpacingX);
                const effectiveItemsPerRow = Math.max(1, itemsPerRow);
                
                let finalX, finalY;
                if (assignedGroup !== group) {
                  const targetGroupItems = groups[assignedGroup] || [];
                  const itemIndexInTarget = targetGroupItems.findIndex(item => item.path === f.path);
                  if (itemIndexInTarget >= 0) {
                    const col = itemIndexInTarget % effectiveItemsPerRow;
                    const row = Math.floor(itemIndexInTarget / effectiveItemsPerRow);
                    const itemsInRow = Math.min(effectiveItemsPerRow, targetGroupItems.length - row * effectiveItemsPerRow);
                    const rowWidth = itemsInRow * itemSpacingX;
                    const rowStartX = assignedCenter.x - rowWidth / 2 + itemSpacingX / 2;
                    finalX = rowStartX + col * itemSpacingX;
                    const totalRows = Math.ceil(targetGroupItems.length / effectiveItemsPerRow);
                    const totalHeight = totalRows * itemSpacingY;
                    finalY = assignedCenter.y - totalHeight / 2 + row * itemSpacingY + clusterPadding;
                  } else {
                    finalX = assignedCenter.x;
                    finalY = assignedCenter.y;
                  }
                } else {
                  const col = idx % effectiveItemsPerRow;
                  const row = Math.floor(idx / effectiveItemsPerRow);
                  const itemsInRow = Math.min(effectiveItemsPerRow, items.length - row * effectiveItemsPerRow);
                  const rowWidth = itemsInRow * itemSpacingX;
                  const rowStartX = center.x - rowWidth / 2 + itemSpacingX / 2;
                  finalX = rowStartX + col * itemSpacingX;
                  const totalRows = Math.ceil(items.length / effectiveItemsPerRow);
                  const totalHeight = totalRows * itemSpacingY;
                  finalY = center.y - totalHeight / 2 + row * itemSpacingY + clusterPadding;
                }
                
                let x, y;
                if (draggedPos && draggedPos.x !== undefined && draggedPos.y !== undefined) {
                  x = draggedPos.x;
                  y = draggedPos.y;
                } else if (mode === "organize") {
                  x = finalX;
                  y = finalY;
                } else if (mode === "migrate") {
                  x = assignedCenter.x;
                  y = assignedCenter.y;
                } else {
                  x = base.x;
                  y = base.y;
                }

                const isCurrentlyDragging = isDragging && dragStart.filePath === f.path;

                return (
                  <FadeItem
                    key={f.path}
                    group={assignedGroup}
                    delay={idx * 40}
                    reviewMode={reviewMode}
                    style={{
                      position: isCurrentlyDragging ? "fixed" : "absolute",
                      ...(isCurrentlyDragging && draggedPos && draggedPos.x !== undefined && draggedPos.y !== undefined ? {
                        left: `${draggedPos.x}px`,
                        top: `${draggedPos.y}px`,
                        transform: "none"
                      } : {
                        transform: `translate(${x}px, ${y}px)`
                      }),
                      transition: isCurrentlyDragging ? "none" : "transform 0.9s ease",
                      cursor: isCurrentlyDragging ? "grabbing" : (mode === "organize" ? "grab" : "default"),
                      zIndex: isCurrentlyDragging ? 1000 : "auto",
                      userSelect: "none"
                    }}
                    onMouseDown={(e) => handleMouseDown(e, f.path, x, y, assignedGroup)}
                  >
                    {f.name}
                  </FadeItem>
                );
              })
            )}
          </>
        )}
      </div>
    </div>
  );
}
