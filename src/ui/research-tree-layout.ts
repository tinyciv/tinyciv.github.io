import { RESEARCH_BRANCHES, type ResearchBranchId } from '../game/research';

/** Agriculture above, military below. Prerequisite order minimizes crossings. */
export const RESEARCH_COLUMNS: readonly (readonly ResearchBranchId[])[] = [
  ['irrigation', 'scoutLodge', 'woodenTower'],
  ['grainStorage', 'drainage', 'commerce', 'archeryRange', 'wall', 'sailing'],
  ['cropRotation', 'monument', 'traditionalMedicine', 'blacksmith', 'engineering', 'whaling'],
  ['coinage', 'culturalIdentity', 'metalTools', 'militaryTactics', 'roadBuilding', 'lateenSails'],
  ['ironPlows', 'urbanPlanning', 'reinforcedDefenses', 'fletching', 'infantryDrill'],
  ['siegeEngines', 'horsebackRiding', 'metalCasting', 'officerCorps', 'massLevy'],
  ['supplyTrain', 'compoundBow', 'stirrups', 'urbanMilitia', 'navalEngineering'],
  ['populism', 'gunpowder'],
  ['fieldCannon', 'militaryScience'],
];
export const RESEARCH_CARD_WIDTH = 220;
export const RESEARCH_CARD_HEIGHT = 64;
export const RESEARCH_COLUMN_PITCH = 352;
const ROW_PITCH = 96;
const BOARD_MARGIN = 18;
const FIRST_ROW_CENTER = BOARD_MARGIN + RESEARCH_CARD_HEIGHT / 2;
const rows = [[1, 2.5, 4], [1, 2, 3, 4, 6, 7], [0, 1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 6], [0, 1, 2, 3, 4], [1, 2, 3, 4, 5], [1, 2, 3, 4, 6], [1.5, 4], [4, 5]];
const columnLeft = (column: number) => BOARD_MARGIN + column * RESEARCH_COLUMN_PITCH;
const rowCenter = (row: number) => FIRST_ROW_CENTER + row * ROW_PITCH;
export const RESEARCH_BOARD_WIDTH = columnLeft(RESEARCH_COLUMNS.length - 1) + RESEARCH_CARD_WIDTH + BOARD_MARGIN;
export const RESEARCH_BOARD_HEIGHT = rowCenter(Math.max(...rows.flat())) + RESEARCH_CARD_HEIGHT / 2 + ROW_PITCH;
export const RESEARCH_POSITIONS = new Map<ResearchBranchId, { x: number; y: number }>(
  RESEARCH_COLUMNS.flatMap((column, x) => column.map((id, i) => [id, { x, y: rows[x][i] }] as const)),
);

export function researchCardPosition(id: ResearchBranchId): { left: number; top: number } {
  const { x, y } = RESEARCH_POSITIONS.get(id)!;
  return { left: columnLeft(x), top: rowCenter(y) - RESEARCH_CARD_HEIGHT / 2 };
}

type Point = [number, number];
type Command = { kind: 'line'; to: Point } | { kind: 'curve'; a: Point; b: Point; to: Point };
/** Each skipped column gets a lane between cards, expressed in row units. */
const channels: Partial<Record<ResearchBranchId, Partial<Record<ResearchBranchId, readonly number[]>>>> = {
  archeryRange: { fletching: [2.6, 3.5], militaryTactics: [3.4] },
  commerce: { coinage: [1.4] },
  cropRotation: { ironPlows: [0] },
  fletching: { compoundBow: [1.6] },
  lateenSails: { navalEngineering: [5.5, 5.9] },
  metalCasting: { gunpowder: [3.6] },
  militaryTactics: { massLevy: [5] },
  sailing: { lateenSails: [6.5] },
  scoutLodge: { traditionalMedicine: [3.4], horsebackRiding: [7.5, 7.6, 6.4, 3.4] },
  siegeEngines: { fieldCannon: [1.6, 3.5] },
  traditionalMedicine: { supplyTrain: [2.4, .6, .5] },
  wall: { roadBuilding: [3.6] },
};

interface Connection {
  source: { x: number; y: number };
  target: { x: number; y: number };
  lanes: readonly number[];
  exitOffset: number;
  entryOffset: number;
}
const connectionKey = (from: ResearchBranchId, to: ResearchBranchId) => `${from}:${to}`;
function connectionRow(connection: Connection, column: number): number {
  const { source, target, lanes } = connection;
  if (column === source.x) return source.y;
  if (column === target.x) return target.y;
  return lanes[column - source.x - 1] ?? Math.max(source.y, target.y);
}

function buildConnections(): Map<string, Connection> {
  const connections = new Map<string, Connection>();
  const incoming = new Map<ResearchBranchId, Connection[]>(), outgoing = new Map<ResearchBranchId, Connection[]>();
  for (const { id: to, prerequisites } of RESEARCH_BRANCHES) for (const from of prerequisites) {
    const connection: Connection = { source: RESEARCH_POSITIONS.get(from)!, target: RESEARCH_POSITIONS.get(to)!,
      lanes: channels[from]?.[to] ?? [], exitOffset: 0, entryOffset: 0 };
    connections.set(connectionKey(from, to), connection);
    const arrivals = incoming.get(to) ?? [], departures = outgoing.get(from) ?? [];
    arrivals.push(connection); departures.push(connection);
    incoming.set(to, arrivals); outgoing.set(from, departures);
  }
  // Fan arrows out in the order of their next lane so they separate at the card edge.
  const portOffset = (index: number, count: number) => (index - (count - 1) / 2) * 12;
  for (const group of outgoing.values()) {
    const column = group[0].source.x + 1;
    group.sort((a, b) => connectionRow(a, column) - connectionRow(b, column));
    group.forEach((connection, index) => { connection.exitOffset = portOffset(index, group.length); });
  }
  for (const group of incoming.values()) {
    const column = group[0].target.x - 1;
    group.sort((a, b) => connectionRow(a, column) - connectionRow(b, column));
    group.forEach((connection, index) => { connection.entryOffset = portOffset(index, group.length); });
  }
  return connections;
}
const connections = buildConnections();

function edgeCommands(from: ResearchBranchId, to: ResearchBranchId): { start: Point; commands: Command[] } {
  const connection = connections.get(connectionKey(from, to))!;
  const { source, target } = connection;
  let current: Point = [columnLeft(source.x) + RESEARCH_CARD_WIDTH, rowCenter(source.y) + connection.exitOffset];
  const start = current, commands: Command[] = [];
  for (let column = source.x + 1; column <= target.x; column++) {
    const end: Point = [columnLeft(column), rowCenter(connectionRow(connection, column)) + (column === target.x ? connection.entryOffset : 0)];
    const bend = (end[0] - current[0]) / 2;
    commands.push({ kind: 'curve', a: [current[0] + bend, current[1]], b: [end[0] - bend, end[1]], to: end });
    current = end;
    if (column < target.x) {
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
