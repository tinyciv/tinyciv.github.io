import type { ResearchBranchId } from '../game/research';

/** Agriculture above, military below. Prerequisite order minimizes crossings. */
export const RESEARCH_COLUMNS: readonly (readonly ResearchBranchId[])[] = [
  ['irrigation', 'scoutLodge', 'woodenTower'],
  ['grainStorage', 'sailing', 'archeryRange', 'wall'],
  ['monument', 'traditionalMedicine', 'engineering', 'blacksmith'],
  ['coinage', 'supplyTrain', 'metalTools', 'militaryTactics'],
  ['urbanPlanning', 'reinforcedDefenses', 'fletching', 'infantryDrill'],
  ['metalCasting', 'siegeEngines', 'massLevy', 'horsebackRiding'],
  ['stirrups', 'compoundBow'],
];
export const RESEARCH_CARD_WIDTH = 220;
export const RESEARCH_COLUMN_PITCH = 292;
export const RESEARCH_BOARD_WIDTH = 1992;
export const RESEARCH_BOARD_HEIGHT = 400;
const rows = [[0, 1.5, 3], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3], [0, 2]];
export const RESEARCH_POSITIONS = new Map<ResearchBranchId, { x: number; y: number }>(
  RESEARCH_COLUMNS.flatMap((column, x) => column.map((id, i) => [id, { x, y: rows[x][i] }] as const)),
);

type Point = [number, number];
type Command = { kind: 'line'; to: Point } | { kind: 'curve'; a: Point; b: Point; to: Point };
const channels: Partial<Record<ResearchBranchId, Partial<Record<ResearchBranchId, number[]>>>> = {
  scoutLodge: { traditionalMedicine: [100], horsebackRiding: [397, 397, 397, 397] },
  traditionalMedicine: { supplyTrain: [] },
  horsebackRiding: { compoundBow: [], stirrups: [] },
  fletching: { compoundBow: [300] },
  militaryTactics: { massLevy: [300] },
  sailing: { coinage: [200] },
  archeryRange: { fletching: [300, 300], militaryTactics: [300] },
};

function edgeCommands(from: ResearchBranchId, to: ResearchBranchId): { start: Point; commands: Command[] } {
  const a = RESEARCH_POSITIONS.get(from)!, b = RESEARCH_POSITIONS.get(to)!;
  let current: Point = [10 + a.x * RESEARCH_COLUMN_PITCH + RESEARCH_CARD_WIDTH, a.y * 100 + 50];
  const start = current, commands: Command[] = [];
  const intermediate = channels[from]?.[to] ?? [];
  for (let column = a.x + 1; column <= b.x; column++) {
    const end: Point = [10 + column * RESEARCH_COLUMN_PITCH, column === b.x ? b.y * 100 + 50 : intermediate[column - a.x - 1]];
    // Both Archery links share one trunk through the busy Bronze/Metal gutter.
    // Branch after the sole crossing, so it reads as one bridge, not two knots.
    if (from === 'archeryRange' && to === 'militaryTactics' && column === b.x) {
      const fork: Point = [end[0] - 18, current[1]];
      commands.push({ kind: 'line', to: fork }); current = fork;
    }
    const bend = (end[0] - current[0]) / 2;
    commands.push({ kind: 'curve', a: [current[0] + bend, current[1]], b: [end[0] - bend, end[1]], to: end });
    current = end;
    if (column < b.x) {
      current = [end[0] + RESEARCH_CARD_WIDTH, end[1]];
      commands.push({ kind: 'line', to: current });
    }
  }
  return { start, commands };
}

export function researchEdgePath(from: ResearchBranchId, to: ResearchBranchId): string {
  const { start, commands } = edgeCommands(from, to);
  return `M${start.join(' ')} ` + commands.map(command => command.kind === 'line'
    ? `L${command.to.join(' ')}` : `C${command.a.join(' ')} ${command.b.join(' ')} ${command.to.join(' ')}`).join(' ');
}

/** Geometry samples for clearance/crossing assertions; render uses exact curves. */
export function researchEdgePoints(from: ResearchBranchId, to: ResearchBranchId): Point[] {
  const { start, commands } = edgeCommands(from, to), points: Point[] = [start];
  let previous = start;
  for (const command of commands) {
    for (let i = 1; i <= 32; i++) {
      const t = i / 32, u = 1 - t;
      points.push(command.kind === 'line'
        ? [previous[0] * u + command.to[0] * t, previous[1] * u + command.to[1] * t]
        : [0, 1].map(axis => previous[axis] * u ** 3 + 3 * command.a[axis] * u * u * t + 3 * command.b[axis] * u * t * t + command.to[axis] * t ** 3) as Point);
    }
    previous = command.to;
  }
  return points;
}

export function researchNeighbor(id: ResearchBranchId, key: string): ResearchBranchId | undefined {
  const { x, y } = RESEARCH_POSITIONS.get(id)!, column = RESEARCH_COLUMNS[x], index = column.indexOf(id);
  if (key === 'Home') return RESEARCH_COLUMNS[0][0];
  if (key === 'End') return RESEARCH_COLUMNS.at(-1)!.at(-1);
  if (key === 'ArrowUp' || key === 'ArrowDown') return column[index + (key === 'ArrowUp' ? -1 : 1)];
  return RESEARCH_COLUMNS[x + (key === 'ArrowLeft' ? -1 : 1)]?.map(candidate => ({ candidate, distance: Math.abs(RESEARCH_POSITIONS.get(candidate)!.y - y) }))
    .sort((a, b) => a.distance - b.distance)[0]?.candidate;
}
