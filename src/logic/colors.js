export const groupColors = {};

export function getGroupColor(groupKey) {
  if (!groupColors[groupKey]) {
    // assign a random pastel color
    const hue = Math.floor(Math.random() * 360);
    groupColors[groupKey] = `hsl(${hue}, 70%, 85%)`;
  }
  return groupColors[groupKey];
}
