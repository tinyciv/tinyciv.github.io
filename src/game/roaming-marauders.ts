import { entityStore } from './entity-store';
import { banditIntensity, banditPopulationCap } from './bandit-intensity';
import { seededRandom } from '../world/generator';
import { constructionEdges } from './builders';
import { pointExplored, pointInSight, humanFogViews } from './fog';
import { buildingBlockers, canMove, canWalk, travelTimeMap } from './pathfinding';
import { MAX_LIVE_RAIDERS, RAIDER_COLOR, RAIDER_FACTION } from './raider-camps';
import { initializeRaiderSkirmishes } from './raider-activity';
import { ensureMarauderLeaders } from './marauder-leaders';
import { buildingReady, buildingSize, buildingHeight, distance, isWallKind, type GameState, type Point } from './types';

export const ROAMING_MARAUDERS_VERSION = 1;
export const ROAMING_PALACE_CLEARANCE = 18;
export const ROAMING_PACK_SPACING = 7;
const NAMES = ['Scythians', 'Sarmatians', 'Cimmerians', 'Alans', 'Huns', 'Avars', 'Pechenegs', 'Cumans', 'Haiduks', 'Klephts', 'Bagaudae', 'Reivers'];

/** Small wilderness bands share the total raider budget with real attacks.
 * At normal intensity: two bands per full realm, at most twelve including opening parties. */
export function roamingPackTarget(state: GameState): number {
  return banditPopulationCap(state, Math.min(12, Math.max(1, state.factions.filter(faction => faction.id >= 0 && faction.villageId === undefined).length) * 2, Math.max(1, Math.floor(state.world.width * state.world.height / 250))));
}

/** Scatter independent, modestly armed bands without changing camp schedules
 * or the simulation RNG stream. Existing saves receive this population once. */
export function initializeRoamingMarauders(state: GameState): void {
  if ((state.roamingMaraudersVersion ?? 0) >= ROAMING_MARAUDERS_VERSION) { ensureMarauderLeaders(state); return; }
  state.roamingMaraudersVersion = ROAMING_MARAUDERS_VERSION;
  const palaces = state.buildings.filter(building => building.faction >= 0 && building.kind === 'palace' && buildingReady(building));
  if (!palaces.length) return;
  state.marauderPacks ??= [];
  initializeRaiderSkirmishes(state);
  if (!banditIntensity(state)) return;
  // Older worlds can contain larger bands. Split their surviving soldiers
  // without adding bodies, healing wounds, or refilling a depleted lone band.
  let existingPackId = Math.max(0, ...state.marauderPacks.map(pack => pack.id), ...state.units.map(unit => unit.marauderPack ?? 0));
  for (const pack of [...state.marauderPacks]) if (!pack.raid && pack.raiderCamp === undefined) {
    delete pack.approachAt; pack.color = RAIDER_COLOR;
    const members = state.units.filter(unit => unit.marauderPack === pack.id && unit.hp > 0);
    if (members.length <= 6) continue;
    const groups = Math.ceil(members.length / 6);
    let offset = 0;
    for (let group = 0; group < groups; group++) {
      const size = Math.ceil((members.length - offset) / (groups - group)), portion = members.slice(offset, offset + size);
      offset += size;
      if (!group) continue;
      const id = ++existingPackId, home = { x: portion[0].x, y: portion[0].y };
      state.marauderPacks.push({ ...pack, id, home, waypoint: { ...home } });
      for (const member of portion) member.marauderPack = id;
    }
  }
  const surviving = state.marauderPacks.filter(pack => pack.raiderCamp === undefined
    && state.units.some(unit => unit.marauderPack === pack.id && unit.hp > 0));
  const wanted = roamingPackTarget(state) - surviving.length;
  let available = banditPopulationCap(state, MAX_LIVE_RAIDERS) - state.units.filter(unit => unit.faction === RAIDER_FACTION && unit.hp > 0).length;
  if (wanted <= 0 || available < 2) { ensureMarauderLeaders(state); return; }
  const rng = seededRandom(`${state.world.seed}:roaming-marauders:${ROAMING_MARAUDERS_VERSION}`);
  const { width, height } = state.world, blockers = buildingBlockers(state, RAIDER_FACTION);
  // Defensive enclosures may require a breach, but disconnected islands must
  // never receive bands that can have no encounter with any settled faction.
  const planning = { ...state, buildings: state.buildings.filter(building => !(building.faction >= 0 && isWallKind(building.kind))) };
  const access = palaces.flatMap(palace => {
    const exit = constructionEdges(planning, palace)[0];
    return exit ? [travelTimeMap(planning, exit, RAIDER_FACTION, 1, Infinity)] : [];
  });
  const views = humanFogViews(state), occupied = new Set<number>(), excluded = new Set<number>();
  const centers = palaces.map(palace => ({ x: palace.x + 1, y: palace.y + 1, faction: palace.faction }));
  for (const unit of state.units) if (unit.hp > 0 && !unit.inside) occupied.add(Math.floor(unit.y) * width + Math.floor(unit.x));
  for (const field of state.fields ?? []) excluded.add(field.y * width + field.x);
  // Keep packs out of farms, settlements and camp enclosures, including their
  // entrances. They meet factions by wandering, not by spawning on top of them.
  for (const building of state.buildings) if (building.hp > 0) {
    const size = buildingSize(building);
    for (let y = building.y - 3; y < building.y + buildingHeight(building) + 3; y++)
      for (let x = building.x - 3; x < building.x + size + 3; x++)
        if (x >= 0 && y >= 0 && x < width && y < height) excluded.add(y * width + x);
  }
  const safe = new Uint8Array(width * height), candidates: { point: Point; unexplored: boolean; tie: number; separation: number }[] = [];
  const homes: Point[] = surviving.map(pack => pack.home);
  const friends = state.units.filter(unit => unit.faction >= 0 && unit.hp > 0 && !unit.inside);
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const key = y * width + x, point = { x: x + .5, y: y + .5 };
    if (excluded.has(key) || occupied.has(key) || !canWalk(state, point.x, point.y, RAIDER_FACTION, blockers)
      || !access.some(map => Number.isFinite(map[key])) || views.some(fog => pointInSight(fog, point.x, point.y))
      || centers.some(center => distance(center, point) < ROAMING_PALACE_CLEARANCE)
      || friends.some(unit => distance(unit, point) < 10)) continue;
    safe[key] = 1;
    if (centers.every(center => distance(center, point) >= ROAMING_PALACE_CLEARANCE + 2))
      candidates.push({ point, unexplored: views.every(fog => !pointExplored(fog, point.x, point.y)), tie: rng(),
        separation: homes.length ? Math.min(...homes.map(home => distance(home, point))) : Infinity });
  }
  let nextId = Math.max(0, ...state.units.map(unit => unit.id), ...state.buildings.map(building => building.id));
  let packId = Math.max(0, ...state.marauderPacks.map(pack => pack.id), ...state.units.map(unit => unit.marauderPack ?? 0));
  const cellsNear = (home: Point): Point[] => {
    const points: Point[] = [], queue = [home], seen = new Set<number>();
    for (let index = 0; index < queue.length; index++) {
      const point = queue[index], key = Math.floor(point.y) * width + Math.floor(point.x);
      if (seen.has(key) || point.x < 0 || point.y < 0 || point.x >= width || point.y >= height
        || distance(point, home) > 2.5 || !safe[key] || occupied.has(key)) continue;
      seen.add(key); points.push(point);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
        if (dx || dy) {
          const next = { x: point.x + dx, y: point.y + dy };
          if (canMove(state, point, next, RAIDER_FACTION, blockers)) queue.push(next);
        }
    }
    return points.sort((a, b) => distance(a, home) - distance(b, home) || a.y - b.y || a.x - b.x);
  };
  for (let count = 0; count < wanted; count++) {
    if (available < 2) break;
    // Farthest-point placement spreads encounters over the whole reachable
    // wilderness, rather than surrounding whichever palace was scanned first.
    let best = -1, score = -Infinity;
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i], separation = homes.length ? candidate.separation : ROAMING_PACK_SPACING;
      if (separation < ROAMING_PACK_SPACING) continue;
      const value = (candidate.unexplored ? width + height : 0) + separation + candidate.tie * .25;
      if (value > score) { best = i; score = value; }
    }
    if (best < 0) break;
    const { point: home } = candidates.splice(best, 1)[0], cells = cellsNear(home), size = Math.min(available, 2 + Math.floor(rng() * 5));
    if (cells.length < size) { count--; continue; }
    const id = ++packId, name = `${NAMES[Math.floor(rng() * NAMES.length)]} wanderers`;
    const nearest = centers.slice().sort((a, b) => distance(home, a) - distance(home, b))[0];
    state.marauderPacks.push({ id, name, color: RAIDER_COLOR, targetFaction: nearest.faction, home: { ...home },
      waypoint: { ...home }, nextWanderAt: state.time, spawnedAt: state.time });
    homes.push(home);
    // Maintain each candidate's distance to its nearest band incrementally;
    // rescanning every previous home makes large-map placement quadratic.
    for (const candidate of candidates) candidate.separation = Math.min(candidate.separation, distance(home, candidate.point));
    for (const point of cells.slice(0, size)) {
      occupied.add(Math.floor(point.y) * width + Math.floor(point.x));
      entityStore(state).units.add({ id: ++nextId, ...point, kind: 'warrior', faction: RAIDER_FACTION, marauderPack: id, name,
        hp: 65, maxHp: 65, attack: 10, defense: 2, morale: 100, speed: 2.35, range: 1.1,
        order: 'wander', cooldown: 0, lastCombat: -60, moving: false, facing: rng() * Math.PI * 2,
        attackTime: 0, bornAt: state.time });
    }
    available -= size;
  }
  ensureMarauderLeaders(state);
}
