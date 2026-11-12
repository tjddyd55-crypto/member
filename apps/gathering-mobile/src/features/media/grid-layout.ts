/** Measure the grid itself, so nested event padding and split screens are included. */
export function mediaGridLayout(width: number, gap = 8) {
  const columns = width >= 360 ? 4 : 3;
  return { columns, cellSize: Math.max(0, Math.floor((width - gap * (columns - 1)) / columns)) };
}
