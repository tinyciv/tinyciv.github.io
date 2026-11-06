import { buildingReady, buildingWidth, buildingHeight, type GameState } from '../../src/game/types';

/** Assert the actual cardinal road network, rather than a cached gameplay flag. */
export function roadsReachPalaces(state: GameState): boolean {
  for (const faction of state.factions) {
    const roads = state.buildings.filter(b => b.faction === faction.id && buildingReady(b) && (b.kind === 'road' || b.kind === 'bridge'));
    const cells = new Set(roads.map(b => `${b.x},${b.y}`)), reached = new Set<string>(), queue: [number, number][] = [];
    const visit = (x: number, y: number) => {
      const key = `${x},${y}`;
      if (cells.has(key) && !reached.has(key)) { reached.add(key); queue.push([x, y]); }
    };
    for (const palace of state.buildings) if (palace.faction === faction.id && palace.kind === 'palace' && buildingReady(palace)) {
      for (let dx = 0; dx < buildingWidth(palace); dx++) {
        visit(palace.x + dx, palace.y - 1); visit(palace.x + dx, palace.y + buildingHeight(palace));
      }
      for (let dy = 0; dy < buildingHeight(palace); dy++) {
        visit(palace.x - 1, palace.y + dy); visit(palace.x + buildingWidth(palace), palace.y + dy);
      }
    }
    for (let i = 0; i < queue.length; i++) {
      const [x, y] = queue[i]; visit(x - 1, y); visit(x + 1, y); visit(x, y - 1); visit(x, y + 1);
    }
    if (reached.size !== cells.size) return false;
  }
  return true;
}
