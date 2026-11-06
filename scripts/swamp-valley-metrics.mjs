/** Measure actual raster islands enclosed by river, ignoring declared paths. */
export function measureRiverIslands(world) {
  const { width, height, tiles } = world;
  const river = new Set(tiles.flatMap((tile, cell) => tile.terrain === 'river' ? [cell] : []));
  const riverPoints = [...river].map(cell => ({ x: cell % width, y: Math.floor(cell / width) }));
  const unseen = new Set(tiles.flatMap((tile, cell) => tile.terrain !== 'river' ? [cell] : []));
  const islands = [];
  while (unseen.size) {
    const cells = [unseen.values().next().value]; unseen.delete(cells[0]);
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i], x = cell % width, y = Math.floor(cell / width);
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height && unseen.delete(next)) cells.push(next);
      }
    }
    if (cells.length < 4 || cells.some(cell => cell % width === 0 || cell % width === width - 1 || Math.floor(cell / width) === 0 || Math.floor(cell / width) === height - 1)) continue;
    const distances = cells.map(cell => {
      const x = cell % width, y = Math.floor(cell / width);
      return Math.min(...riverPoints.map(p => Math.hypot(p.x - x, p.y - y)));
    }).sort((a, b) => a - b);
    const xs = cells.map(cell => cell % width), ys = cells.map(cell => Math.floor(cell / width));
    islands.push({ area: cells.length, maxDistance: distances.at(-1), meanDistance: distances.reduce((sum, value) => sum + value, 0) / distances.length,
      p90Distance: distances[Math.floor((distances.length - 1) * .9)], bounds: { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs) + 1, height: Math.max(...ys) - Math.min(...ys) + 1 } });
  }
  islands.sort((a, b) => b.area - a.area);
  return { islandCount: islands.length, totalIslandArea: islands.reduce((sum, island) => sum + island.area, 0),
    largestIslandArea: islands[0]?.area ?? 0, maximumInteriorDistance: Math.max(0, ...islands.map(island => island.maxDistance)), islands };
}
