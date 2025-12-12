// 20 ultra-distinct, high-contrast colors
const COLOR_PALETTE = [
  "#FF1744", // vivid red
  "#FF6D00", // blazing orange
  "#FFEA00", // pure yellow
  "#AEEA00", // neon lime
  "#00C853", // emerald green
  "#00BFA5", // aqua teal
  "#00B0FF", // electric blue
  "#2962FF", // deep royal blue
  "#651FFF", // intense purple
  "#D500F9", // hot magenta
  "#F50057", // neon pink
  "#FF80AB", // bright rose
  "#8E24AA", // plum purple
  "#5E35B1", // royal violet
  "#3949AB", // indigo
  "#1E88E5", // azure
  "#00897B", // strong teal
  "#43A047", // forest green
  "#F4511E", // burnt orange
  "#6D4C41"  // chocolate brown
];

// deterministic hash → stable color per group
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function getGroupColor(group) {
  const h = hashString(group);
  return COLOR_PALETTE[h % COLOR_PALETTE.length];
}
