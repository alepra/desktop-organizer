export function groupFiles(files) {
  const groups = {};

  for (const f of files) {
    // crude grouping: use first word (before space, dash, or underscore)
    const key = f.name.split(/[-_ ]/)[0].toLowerCase();
    
    // Prevent filenames from being used as group identifiers
    // If the group key equals THIS file's name, treat it as ungrouped
    // This prevents a file from being grouped into a group named after itself
    if (key === f.name.toLowerCase()) {
      // Group name equals this file's filename - skip grouping this file
      // It will remain ungrouped but will still be included in execution
      continue;
    }

    if (!groups[key]) groups[key] = [];
    groups[key].push(f);
  }

  return groups;
}
