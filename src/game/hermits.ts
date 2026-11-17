import { planHermitHomes } from './quest-hermits';
import { territoryValue } from './territory-cells';
import { type GameState, type Point, type Hermit, buildingWidth, buildingHeight, distance } from './types';
import { territory, UNCLAIMED } from './borders';
import { canWalk, canMove, buildingBlockerView } from './pathfinding';
import { updateFog, pointInSight, type FogView } from './fog';
import { playerFaction } from './player-context';
import { spendGold } from './gold-ledger';
import { rustEngine } from './rust-engine';
import { simCore } from './sim-handle';
import { reliefFootprintAllowed } from './relief';

export const HERMIT_REACH = 4;
export const HERMIT_PRICE = 25;
export const hermitPosition = (h: Hermit): Point => h.position ?? { x: h.x + 1.35, y: h.y + 1.25 };
/** Separate scenery entities deliberately never enter combat's unit/building stores. */
export function initializeHermits(state: GameState): void {
  if (state.hermits === undefined) state.hermits = planHermitHomes(state);
}
export function hermitAvailable(state: GameState, h: Hermit, faction = playerFaction(state), fog?: FogView): boolean {
  if (h.status !== 'home') return false;
  const p = hermitPosition(h), leader = state.units.find(u => u.faction === faction && u.kind === 'leader' && u.hp > 0 && !u.inside && u.embarkedOn === undefined);
  return !!leader && distance(leader, p) <= HERMIT_REACH && pointInSight(fog ?? updateFog(state, faction), p.x, p.y);
}
export function hermitAt(state: GameState, p: Point): Hermit | undefined {
  return state.hermits?.find(h => distance(hermitPosition(h), p) < .65 && hermitAvailable(state, h));
}
function bearing(from: Point, to: Point): string {
  const names = ['east', 'southeast', 'south', 'southwest', 'west', 'northwest', 'north', 'northeast'];
  const direction = names[(Math.round(Math.atan2(to.y - from.y, to.x - from.x) / (Math.PI / 4)) + 8) % 8];
  const d = distance(from, to), range = d < 25 ? 'a short journey' : d < 60 ? 'a long journey' : 'far beyond the familiar paths';
  return `${direction}, ${range} (roughly ${Math.round(d / 10) * 10} tiles)`;
}
export function askHermit(state: GameState, id: number): { ok: boolean; message: string; hermitRumor?: string } {
  const h = state.hermits?.find(h => h.id === id), faction = state.factions.find(f => f.id === playerFaction(state));
  if (!h || !hermitAvailable(state, h) || !faction) return { ok: false, message: 'Bring your Leader close to the hermit.' };
  if (faction.gold < HERMIT_PRICE) return { ok: false, message: 'The hermit asks for 25 gold.' };
  const towns = state.buildings.filter(b => b.kind === 'palace' && b.hp > 0 && state.factions.some(f => f.id === b.faction && !f.defeated && f.villageId === undefined))
    .map(b => ({ x: b.x + buildingWidth(b) / 2, y: b.y + buildingHeight(b) / 2 })).sort((a, b) => distance(h, a) - distance(h, b));
  const camps = (state.raiderCamps ?? []).filter(c => !c.destroyed).map(c => c.refuge ?? { x: c.x + c.width / 2, y: c.y + c.height / 2 }).sort((a, b) => distance(h, a) - distance(h, b));
  const message = (towns[0] ? `Where many hearths bow to one banner, seek ${bearing(h, towns[0])}.` : 'The crowns have fallen silent; no living town answers my dreams.')
    + ' ' + (camps[0] ? `Where stolen gold sleeps and wolves take counsel, seek ${bearing(h, camps[0])}.` : 'The wolves have no den now; no raider headquarters remains.');
  spendGold(state, faction, HERMIT_PRICE, 'diplomacy');
  return { ok: true, message, hermitRumor: message };
}
function escapeRoute(state: GameState, h: Hermit): Point[] {
  const { width, height } = state.world, start = hermitPosition(h), origin = Math.floor(start.y) * width + Math.floor(start.x);
  const fogs = (state.multiplayer?.humanFactionIds ?? [playerFaction(state)]).map(id => updateFog(state, id));
  const blockers = buildingBlockerView(state, -99);
  const parent = new Int32Array(width * height).fill(-1), queue = [origin]; parent[origin] = origin;
  let end = origin;
  for (let i = 0; i < queue.length; i++) {
    const cell = queue[i], p = { x: cell % width + .5, y: Math.floor(cell / width) + .5 }; end = cell;
    if (cell !== origin && fogs.every(fog => !pointInSight(fog, p.x, p.y))) break;
    for (const [dx, dy] of [[0,-1],[1,0],[0,1],[-1,0]]) {
      const nx = Math.floor(p.x) + dx, ny = Math.floor(p.y) + dy, next = ny * width + nx;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || parent[next] !== -1 || !canMove(state, p, { x: nx + .5, y: ny + .5 }, -99, blockers)) continue;
      parent[next] = cell; queue.push(next);
    }
  }
  const route: Point[] = [];
  while (end !== origin) { route.push({ x: end % width + .5, y: Math.floor(end / width) + .5 }); end = parent[end]; }
  return route.reverse();
}
export function updateHermits(state: GameState, dt: number): void {
  if (!state.hermits?.some(h => h.status !== 'gone')) return;
  const owners = territory(state), width = state.world.width;
  for (const h of state.hermits) {
    if (h.status === 'gone') continue;
    if (h.status === 'home' && territoryValue(owners, h.y * width + h.x) !== UNCLAIMED
      && !rustEngine.sim_quests_hold_hermit(simCore(state).handle, h.id)) {
      h.status = 'fleeing'; h.position = hermitPosition(h); h.path = escapeRoute(state, h);
    }
    if (h.status !== 'fleeing') continue;
    const p = h.position!, fogs = (state.multiplayer?.humanFactionIds ?? [playerFaction(state)]).map(id => updateFog(state, id));
    if (fogs.every(fog => !pointInSight(fog, p.x, p.y))) { h.status = 'gone'; h.path = []; continue; }
    if (!h.path?.length) {
      if ((h.retryAt ?? 0) > state.time) continue;
      h.path = escapeRoute(state, h); h.retryAt = state.time + 2;
    }
    const target = h.path?.[0]; if (!target) continue;
    if (!canMove(state, p, target, -99)) { h.path = []; continue; }
    const d = distance(p, target), step = Math.min(d, dt * 2.2);
    if (d > 0) { p.x += (target.x - p.x) / d * step; p.y += (target.y - p.y) / d * step; }
    if (step === d) h.path!.shift();
  }
}
