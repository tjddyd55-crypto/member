/** Measure the grid itself, so nested event padding and split screens are included. */
export function mediaGridLayout(width: number, gap = 3) {
  const columns = Math.max(3, Math.floor(width / 130));
  return { columns, cellSize: Math.max(0, Math.floor((width - gap * (columns - 1)) / columns)) };
}
