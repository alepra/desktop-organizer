export function groupFiles(files) {
  const groups = {};

  for (const f of files) {
    // crude grouping: use first word (before space, dash, or underscore)
    const key = f.name.split(/[-_ ]/)[0].toLowerCase();

    if (!groups[key]) groups[key] = [];
    groups[key].push(f);
  }

  return groups;
}
