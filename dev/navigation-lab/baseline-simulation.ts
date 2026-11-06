import { type Building, type BuildingKind, type Faction, type GameEvent, type GameState, type InputState, type Point, type Unit, type UnitKind, type World, buildingReady, buildingSize, distance, tileAt } from '../../src/game/types';
import { buildingBlockers, canMove, canWalk, findPath, movementMultiplier, travelTimeMap, traversable, UNIT_RADIUS } from '../../src/game/pathfinding';
import { normalizePunyWorld, terrainYields } from '../../src/world/generator';
import { ensureCollectors, isHome, isPendingCampField, migrateFarms, synchronizeFarms, updateCollector, updateHarvests } from '../../src/game/farms';
import { queueConstruction, updateConstruction } from '../../src/game/structures';
import { ensureBuilders, updateBuilder } from '../../src/game/builders';
import { canPlaceRoad, recordTraffic, updateTraffic } from '../../src/game/traffic';
import { entityVisible, isVisible, updateFog } from '../../src/game/fog';
import { buildingAlignmentBonus, campSpacingAllowed, palaceReachability } from '../../src/game/placement';
import { retinueFormation } from '../../src/game/formation';
import { unitAtPoint } from '../../src/game/hit-testing';

export const ECONOMY_INTERVAL = 30;
export const BUILD_COSTS: Record<BuildingKind, { food: number; gold: number; production: number }> = {
  fort: { food: 0, gold: 300, production: 0 }, supplyDepot: { food: 0, gold: 120, production: 0 },
    stable: { food: 0, gold: 350, production: 0 },
  dock: { food: 0, gold: 100, production: 0 },
  observationPost: { food: 0, gold: 20, production: 0 },
  villageTent: { food: 0, gold: 0, production: 0 },
  scoutLodge: { food: 0, gold: 200, production: 0 },
  ballista: { food: 0, gold: 300, production: 0 },
  healerShack: { food: 0, gold: 200, production: 0 },
  palace: { food: 0, gold: 0, production: 80 }, camp: { food: 0, gold: 0, production: 8 },
  house: { food: 0, gold: 0, production: 18 }, shack: { food: 0, gold: 0, production: 18 }, cottage: { food: 0, gold: 10, production: 30 },
  road: { food: 0, gold: 0, production: 2 }, wall: { food: 0, gold: 0, production: 12 }, bridge: { food: 0, gold: 0, production: 8 },
  irrigation: { food: 0, gold: 50, production: 0 },
  ruin: { food: 0, gold: 0, production: 0 },
  tower: { food: 0, gold: 20, production: 60 },
  palisade: { food: 0, gold: 0, production: 6 }, woodenTower: { food: 0, gold: 10, production: 30 },
  well: { food: 0, gold: 600, production: 0 }, monument: { food: 0, gold: 200, production: 0 },
  blacksmith: { food: 0, gold: 400, production: 0 }, archeryRange: { food: 0, gold: 400, production: 0 }, library: { food: 0, gold: 400, production: 0 },
  guardPost: { food: 0, gold: 200, production: 0 },
};
const HOUSE_CAPACITY: Partial<Record<BuildingKind, number>> = { camp: 4, shack: 4, cottage: 4 };
const SUPPORTED_UNITS = new Set<UnitKind>(['leader', 'warrior', 'worker']);
const NO_INPUT: InputState = { up: false, down: false, left: false, right: false };
const FACTION_NAMES = ['Willowhearth', 'Amber Coast', 'Mosswood', 'Ember Clan', 'Bluewater', 'Sunvale'];
const FACTION_COLORS = ['#3988ff', '#ffcf38', '#f34f59', '#b66bff', '#28dfb0', '#ff8b35'];
const RETINUE_SPEED = 3.6 * 1.1;
// Keep this historical reference's faction-wide growth separate from the
// production simulation's city-specific populationGrowth accumulators.
const baselineGrowth = new WeakMap<Faction, number>();
export const MARAUDER_FACTION = -2;
// Historical group names are used as fictional band names, not claims about their cultures.
const MARAUDER_NAMES = ['Scythians', 'Sarmatians', 'Cimmerians', 'Alans', 'Huns', 'Avars', 'Pechenegs', 'Cumans', 'Haiduks', 'Klephts'];
const MARAUDER_COLORS = ['#e87535', '#dbaa64', '#ed9d45', '#b97c55'];
function isRoute(kind: BuildingKind): boolean { return kind === 'road' || kind === 'bridge'; }

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  return hash >>> 0;
}
function random(state: GameState): number {
  let value = state.rngState += 0x6D2B79F5;
  value = Math.imul(value ^ value >>> 15, value | 1);
  value ^= value + Math.imul(value ^ value >>> 7, value | 61);
  state.rngState >>>= 0;
  return ((value ^ value >>> 14) >>> 0) / 4294967296;
}
function nextId(state: GameState): number {
  return Math.max(0, ...state.units.map(unit => unit.id), ...state.buildings.map(building => building.id)) + 1;
}
function isMilitary(unit: Unit): boolean { return unit.kind === 'leader' || unit.kind === 'warrior'; }
function center(building: Building): Point {
  const offset = buildingSize(building) / 2;
  return { x: building.x + offset, y: building.y + offset };
}
function edgeDistance(point: Point, building: Building): number {
  const size = buildingSize(building);
  return Math.hypot(Math.max(building.x - point.x, 0, point.x - building.x - size), Math.max(building.y - point.y, 0, point.y - building.y - size));
}
function factionOf(state: GameState, id: number): Faction | undefined { return state.factions.find(faction => faction.id === id); }
function palaceOf(state: GameState, faction: number): Building | undefined {
  return state.buildings.find(building => building.kind === 'palace' && building.faction === faction && buildingReady(building));
}
export function getLeader(state: GameState, faction = 0): Unit | undefined {
  return state.units.find(unit => unit.kind === 'leader' && unit.faction === faction && unit.hp > 0);
}
export function housingCapacity(state: GameState, faction = 0): number {
  return state.buildings.filter(building => building.faction === faction && buildingReady(building)).reduce((sum, building) => sum + building.capacity, 0);
}
export function logEvent(state: GameState, text: string, kind: GameEvent['kind'] = 'info'): void {
  state.events.unshift({ id: (state.events[0]?.id ?? 0) + 1, time: state.time, text, kind });
  if (state.events.length > 40) state.events.length = 40;
}
function particle(state: GameState, point: Point, text: string, color = '#f6e1a2'): void {
  state.particles.push({ ...point, text, color, life: 1.6 });
}
/** Solid structures need a visible clearing; paths never clear vegetation for free. */
function clearBuildingVegetation(state: GameState, building: Building): void {
  if (building.hp <= 0 || isRoute(building.kind)) return;
  let changed = false;
  for (let dy = 0; dy < buildingSize(building); dy++) for (let dx = 0; dx < buildingSize(building); dx++) {
    const tile = tileAt(state.world, building.x + dx, building.y + dy);
    if (!tile || !['forest', 'jungle', 'swamp'].includes(tile.overlay)) continue;
    const before = terrainYields(tile.terrain, tile.overlay), after = terrainYields(tile.terrain, 'none');
    tile.overlay = 'none';
    for (const resource of ['food', 'production', 'gold'] as const)
      tile[resource] = Math.max(0, tile[resource] - before[resource] + after[resource]);
    changed = true;
  }
  if (changed) state.world.revision = (state.world.revision ?? 0) + 1;
}
function makeBuilding(state: GameState, kind: BuildingKind, faction: number, point: Point): Building {
  const maxHp = kind === 'tower' ? 1200 : kind === 'palace' ? 650 : kind === 'wall' ? 450 : kind === 'cottage' ? 220 : kind === 'shack' ? 160 : 100;
  const building: Building = { id: nextId(state), kind, faction, x: Math.floor(point.x), y: Math.floor(point.y), hp: maxHp, maxHp, capacity: HOUSE_CAPACITY[kind] ?? 0, armor: kind === 'tower' ? 15 : kind === 'wall' ? 4 : 2 };
  (state.buildings as Building[]).push(building);
  clearBuildingVegetation(state, building);
  return building;
}
function makeUnit(state: GameState, kind: UnitKind, faction: number, point: Point, home?: number): Unit {
  const unit: Unit = {
    id: nextId(state), kind, faction, x: point.x, y: point.y, hp: 100, morale: 100,
    attack: kind === 'leader' ? 25 : kind === 'warrior' ? 17 : 0,
    defense: kind === 'leader' ? 5 : kind === 'warrior' ? 4 : 0,
    speed: kind === 'leader' ? 3.6 : kind === 'warrior' ? RETINUE_SPEED : 2.2,
    range: kind === 'leader' ? 1.65 : 1.1,
    order: kind === 'worker' ? 'work' : 'follow',
    home, cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0, bornAt: state.time,
  };
  (state.units as Unit[]).push(unit);
  return unit;
}
function freeTile(state: GameState, x: number, y: number, allowRoad = false): boolean {
  if (!traversable(state.world, x, y) || isPendingCampField(state, x, y)) return false;
  return !state.buildings.some(building => {
    if (building.hp <= 0 || (allowRoad && isRoute(building.kind))) return false;
    const size = buildingSize(building);
    return x >= building.x && y >= building.y && x < building.x + size && y < building.y + size;
  });
}
function freeField(state: GameState, x: number, y: number): boolean {
  const tile = tileAt(state.world, x, y);
  return !!tile && ['none', 'forest', 'jungle', 'swamp'].includes(tile.overlay) && freeTile(state, x, y) && !state.fields?.some(field => field.x === x && field.y === y);
}
function nearbyOpen(state: GameState, origin: Point, minRadius: number, maxRadius: number, preferred?: (point: Point) => number): Point | undefined {
  const candidates: { point: Point; score: number }[] = [];
  for (let y = Math.max(1, Math.floor(origin.y - maxRadius)); y <= Math.min(state.world.height - 2, Math.ceil(origin.y + maxRadius)); y++) {
    for (let x = Math.max(1, Math.floor(origin.x - maxRadius)); x <= Math.min(state.world.width - 2, Math.ceil(origin.x + maxRadius)); x++) {
      const point = { x: x + 0.5, y: y + 0.5 }, d = distance(point, origin);
      if (d < minRadius || d > maxRadius || !freeTile(state, x, y)) continue;
      if (state.fields?.some(field => field.x === x && field.y === y)) continue;
      if (state.units.some(unit => !unit.inside && unit.hp > 0 && Math.floor(unit.x) === x && Math.floor(unit.y) === y)) continue;
      const score = preferred ? preferred(point) : -d + random(state) * 1.8;
      if (Number.isFinite(score)) candidates.push({ point, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.point;
}
function syncRetinue(state: GameState, faction: Faction): void {
  const leader = getLeader(state, faction.id);
  if (!leader) return;
  const wanted = 2 + Math.floor(faction.population / 10);
  const present = state.units.filter(unit => unit.kind === 'warrior' && unit.faction === faction.id).length;
  for (let i = present; i < wanted; i++) {
    const spawn = nearbyOpen(state, leader, 0.8, 3) ?? leader;
    makeUnit(state, 'warrior', faction.id, spawn);
  }
}

/** Only choose camps on the settlement's walkable landmass, never stranded across a river. */
function reachableOutskirts(state: GameState, origin: Point): Point[] {
  const blockers = buildingBlockers(state, MARAUDER_FACTION);
  const frontier = [{ x: Math.floor(origin.x), y: Math.floor(origin.y) }];
  const seen = new Set([frontier[0].y * state.world.width + frontier[0].x]);
  const result: Point[] = [];
  for (let i = 0; i < frontier.length; i++) {
    const current = frontier[i], point = { x: current.x + 0.5, y: current.y + 0.5 };
    if (canWalk(state, point.x, point.y, MARAUDER_FACTION, blockers)) result.push(point);
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const x = current.x + dx, y = current.y + dy, key = y * state.world.width + x;
      if (seen.has(key) || distance(origin, { x: x + 0.5, y: y + 0.5 }) > 45 || !canWalk(state, x, y, MARAUDER_FACTION, blockers)) continue;
      seen.add(key); frontier.push({ x, y });
    }
  }
  return result;
}

function seedMarauders(state: GameState): void {
  state.marauderPacks = [];
  for (const faction of state.factions) {
    const leader = getLeader(state, faction.id);
    if (!leader || faction.defeated) continue;
    const candidates = reachableOutskirts(state, leader);
    const travel = travelTimeMap(state, leader, MARAUDER_FACTION, 2.35, 120);
    const count = 8 + Math.floor(random(state) * 3), rotation = random(state) * Math.PI * 2;
    for (let index = 0; index < count; index++) {
      const early = index < 2;
      const angle = rotation + index * Math.PI * 2 / count, radius = early ? 14 + index * 3 : 23 + random(state) * 13;
      const desired = { x: leader.x + Math.cos(angle) * radius, y: leader.y + Math.sin(angle) * radius };
      const ranked = candidates.filter(point => {
        // Ordinary patrols need room for their eight-tile wander and detection
        // radius, so several neighboring factions cannot pile into an opening.
        const clearance = early ? 9 : 18;
        if (state.buildings.some(building => building.faction >= 0 && !isRoute(building.kind) && distance(point, center(building)) < (early ? 7 : 18))) return false;
        if (state.units.some(unit => unit.faction >= 0 && distance(point, unit) < clearance)) return false;
        return !state.marauderPacks!.some(pack => distance(point, pack.home) < 2.5);
      }).sort((a, b) => distance(a, desired) - distance(b, desired));
      let home = ranked[0];
      if (early) {
        // Terrain travel time counts toward the opening encounter timing.
        home = ranked.find(point => travel[Math.floor(point.y) * state.world.width + Math.floor(point.x)] < 25)
          ?? [...ranked].sort((a, b) => travel[Math.floor(a.y) * state.world.width + Math.floor(a.x)] - travel[Math.floor(b.y) * state.world.width + Math.floor(b.x)])[0];
      }
      // Constrained maps may not fit the full outer ring. Use the safest
      // remaining outskirts instead of dropping extra packs beside a leader.
      if (!home) {
        const settledUnits = state.units.filter(unit => unit.faction >= 0);
        const safety = (point: Point): number => {
          const settlementDistance = Math.min(...settledUnits.map(unit => distance(point, unit)));
          const packDistance = Math.min(4, ...state.marauderPacks!.map(pack => distance(point, pack.home)));
          return Math.min(20, settlementDistance) + packDistance * .5;
        };
        home = candidates.map(point => ({ point, safety: safety(point) })).sort((a, b) => b.safety - a.safety)[0]?.point;
      }
      if (!home) continue;
      const id = state.marauderPacks.length + 1;
      const name = `${MARAUDER_NAMES[(faction.id * 3 + index) % MARAUDER_NAMES.length]} ${id}`;
      state.marauderPacks.push({
        id, name, color: MARAUDER_COLORS[(id - 1) % MARAUDER_COLORS.length], targetFaction: faction.id,
        home: { ...home }, waypoint: { ...home }, nextWanderAt: state.time + 5 + random(state) * 12,
        approachAt: early ? state.time + 32 + index * 42 + random(state) * 5 : undefined,
      });
      for (let member = 0; member < (early ? 2 : 3); member++) {
        const spot = candidates.filter(point => distance(point, home) < 1.6 && state.units.every(unit => distance(unit, point) > .45))
          .sort((a, b) => distance(a, home) - distance(b, home))[0] ?? home;
        const unit = makeUnit(state, 'warrior', MARAUDER_FACTION, spot);
        Object.assign(unit, { marauderPack: id, name, hp: early ? 55 : 70, attack: early ? 8 : 10, defense: 1, speed: 2.35, order: 'wander' });
      }
    }
  }
}

export function createGame(world: World): GameState {
  const state: GameState = {
    world, units: [], buildings: [], factions: [], time: 0, tick: 0, paused: false, speed: 1,
    events: [], particles: [], selected: null, selectedType: null, buildMode: null,
    diplomacy: null, gameOver: false, victory: false, seed: world.seed, rngState: hashSeed(`${world.seed}:simulation`),
  };
  const spawns = world.spawns.length ? world.spawns : [{ x: Math.floor(world.width / 2), y: Math.floor(world.height / 2) }];
  spawns.forEach((spawn, index) => {
    const affinity = index === 0 ? 100 : index === spawns.length - 1 ? 18 + Math.floor(random(state) * 17) : 50 + Math.floor(random(state) * 41);
    const faction: Faction = {
      id: index, name: FACTION_NAMES[index % FACTION_NAMES.length], color: FACTION_COLORS[index % FACTION_COLORS.length],
      affinity, relation: index === 0 ? 'self' : affinity < 35 ? 'war' : 'peace',
      food: 500, gold: 500, production: 500, population: 0, yields: { food: 0, production: 0, gold: 0 },
      nextRaid: 75 + random(state) * 45, defeated: false,
    };
    state.factions.push(faction);
    const palace = makeBuilding(state, 'palace', index, spawn);
    const leaderSpot = nearbyOpen(state, center(palace), 1.4, 3) ?? { x: spawn.x - 0.5, y: spawn.y + 0.5 };
    const leader = makeUnit(state, 'leader', index, leaderSpot);
    if (index === 0) { state.selected = leader.id; state.selectedType = 'unit'; }
    for (let i = 0; i < 2; i++) {
      const reachable = palaceReachability(state, palace);
      const spot = nearbyOpen(state, center(palace), 2.4, 5, point => {
        if (!reachable[Math.floor(point.y) * state.world.width + Math.floor(point.x)]) return -Infinity;
        if (!campSpacingAllowed(state, Math.floor(point.x), Math.floor(point.y))) return -Infinity;
        if (!['none', 'forest', 'jungle', 'swamp'].includes(tileAt(state.world, point.x, point.y)?.overlay ?? '')) return -Infinity;
        const openFields = [[0, 1], [1, 0], [0, -1], [-1, 0]].filter(([dx, dy]) => freeField(state, Math.floor(point.x) + dx, Math.floor(point.y) + dy)).length;
        if (openFields < 4) return -Infinity;
        const buildingSpacing = state.buildings.reduce((best, building) => Math.min(best, distance(point, center(building))), 6);
        return buildingSpacing * 1.2 + random(state) * 2 - distance(point, center(palace)) * 0.2
          + buildingAlignmentBonus(state, index, Math.floor(point.x), Math.floor(point.y));
      });
      if (!spot) continue;
      const home = makeBuilding(state, 'camp', index, spot);
      home.residents = i === 0 ? 4 : 1; faction.population += home.residents;
      synchronizeFarms(state);
    }
    syncRetinue(state, faction);
  });
  synchronizeFarms(state); ensureCollectors(state);
  seedMarauders(state);
  updateRoads(state);
  for (const faction of state.factions) calculateYields(state, faction);
  logEvent(state, 'Your people await. Explore, build roads, and unite the valley.', 'good');
  const enemies = state.factions.filter(faction => faction.relation === 'war');
  if (enemies.length) logEvent(state, `${enemies.map(faction => faction.name).join(' and ')} are hostile. Protect your palace.`, 'warning');
  updateFog(state);
  return state;
}

export function atWar(state: GameState, a: number, b: number): boolean {
  if (a === MARAUDER_FACTION || b === MARAUDER_FACTION) return a !== b && (a >= 0 || b >= 0);
  if (a < 0 || b < 0 || a === b) return false;
  if (a === 0) return factionOf(state, b)?.relation === 'war';
  if (b === 0) return factionOf(state, a)?.relation === 'war';
  return false;
}
function targetEntity(state: GameState, id?: number): Unit | Building | undefined {
  return id === undefined ? undefined : state.units.find(unit => unit.id === id && unit.hp > 0 && !unit.inside) ?? state.buildings.find(building => building.id === id && building.hp > 0);
}
function isBuilding(entity: Unit | Building): entity is Building { return 'maxHp' in entity; }
function validTarget(state: GameState, attacker: Unit, target: Unit | Building): boolean {
  return target.hp > 0 && (isBuilding(target) || !target.inside) && atWar(state, attacker.faction, target.faction);
}
function targetDistance(unit: Unit, target: Unit | Building): number { return isBuilding(target) ? edgeDistance(unit, target) : distance(unit, target); }
/** Melee needs physical contact through open ground. The target
 * building itself is excluded so its near face can still be attacked in a siege. */
function hasAttackContact(state: GameState, from: Point, faction: number, target: Unit | Building): boolean {
  if (!isBuilding(target)) return canMove(state, from, target, faction);
  const size = buildingSize(target), inset = .001;
  const contact = {
    x: Math.max(target.x + inset, Math.min(target.x + size - inset, from.x)),
    y: Math.max(target.y + inset, Math.min(target.y + size - inset, from.y)),
  };
  const blockers = buildingBlockers(state, faction);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) blockers.delete((target.y + y) * state.world.width + target.x + x);
  return canMove(state, from, contact, faction, blockers);
}
function nearestEnemy(state: GameState, unit: Unit, radius: number, includeBuildings = false, canEngage: (target: Unit | Building) => boolean = () => true): Unit | Building | undefined {
  let best: Unit | Building | undefined, bestDistance = radius;
  const candidates: { unit: Unit; distance: number; priority: number }[] = [];
  for (const other of state.units) {
    if (!atWar(state, unit.faction, other.faction) || other.hp <= 0 || other.inside) continue;
    const d = distance(unit, other);
    if (d >= radius || !canEngage(other)) continue;
    // Leaders and warriors are equally dangerous; proximity decides within
    // that tier. Civilians are targets only when no military unit is nearby.
    const priority = isMilitary(other) ? 0 : 1;
    candidates.push({ unit: other, distance: d, priority });
  }
  candidates.sort((a, b) => a.priority - b.priority || a.distance - b.distance);
  for (const candidate of candidates) {
    // A nearby soldier behind impassable terrain cannot be engaged. Do not let
    // that decoy suppress defense against reachable enemies beside us.
    if (canMove(state, unit, candidate.unit, unit.faction) || findPath(state, unit, candidate.unit, unit.faction).length) return candidate.unit;
  }
  if (includeBuildings) for (const building of state.buildings) {
    if (!atWar(state, unit.faction, building.faction) || isRoute(building.kind) || building.hp <= 0) continue;
    const d = edgeDistance(unit, building);
    if (d < bestDistance && canEngage(building)) { best = building; bestDistance = d; }
  }
  return best;
}
const failedApproaches = new WeakMap<Unit, { target: number; x: number; y: number; revision: number; until: number }>();
function approachPoint(state: GameState, unit: Unit, target: Unit | Building): Point | undefined {
  // Navigation goals must remain coordinates. Spreading a whole target unit
  // here recursively copied its pathGoal into opposing units and saved games.
  const goal = isBuilding(target) ? center(target) : { x: target.x, y: target.y };
  if (unit.target === target.id && unit.pathGoal && unit.path?.length) {
    const d = isBuilding(target) ? edgeDistance(unit.pathGoal, target) : distance(unit.pathGoal, target);
    if (d <= unit.range && canWalk(state, unit.pathGoal.x, unit.pathGoal.y, unit.faction) && hasAttackContact(state, unit.pathGoal, unit.faction, target)) return unit.pathGoal;
  }
  const failed = failedApproaches.get(unit);
  if (failed && failed.target === target.id && failed.x === Math.floor(goal.x) && failed.y === Math.floor(goal.y) && failed.revision === (state.world.revision ?? 0) && state.time < failed.until) return { ...goal };
  const radius = isBuilding(target) && buildingSize(target) === 2 ? 2.6 : 1.9;
  const blockers = buildingBlockers(state, unit.faction);
  const spots: Point[] = [];
  for (let y = Math.floor(goal.y - radius); y <= Math.ceil(goal.y + radius); y++) {
    for (let x = Math.floor(goal.x - radius); x <= Math.ceil(goal.x + radius); x++) {
      const spot = { x: x + 0.5, y: y + 0.5 };
      if (!canWalk(state, x, y, unit.faction, blockers) || state.units.some(other => other.id !== unit.id && !other.inside && other.hp > 0 && Math.floor(other.x) === x && Math.floor(other.y) === y)) continue;
      const d = isBuilding(target) ? edgeDistance(spot, target) : distance(spot, target);
      if (d > unit.range || d < 0.35 || !hasAttackContact(state, spot, unit.faction, target)) continue;
      spots.push(spot);
    }
  }
  spots.sort((a, b) => distance(unit, a) - distance(unit, b));
  for (const spot of spots) {
    if (distance(unit, spot) < .12 || findPath(state, unit, spot, unit.faction).length) return spot;
  }
  // An unreachable attack order still advances to the nearest reachable edge;
  // physical contact is checked again before damage, and siege units can strike
  // an intervening wall once they reach it.
  failedApproaches.set(unit, { target: target.id, x: Math.floor(goal.x), y: Math.floor(goal.y), revision: state.world.revision ?? 0, until: state.time + .8 });
  return { ...goal };
}
function occupiedCells(state: GameState, unit: Unit): Set<number> {
  return new Set(state.units.filter(other => other.id !== unit.id && other.hp > 0 && !other.inside).map(other => Math.floor(other.y) * state.world.width + Math.floor(other.x)));
}
interface YieldOrder { point: Point; origin: Point; requester: number; until: number; settledAt?: number; returning?: boolean; }
const friendlyYield = new WeakMap<Unit, YieldOrder>();
const acceptedMoveOrders = new WeakMap<Unit, Point>();
const routeVersions = new WeakMap<Unit, number>();
const movementPriority = (unit: Unit): number => unit.kind === 'leader' ? 3 : unit.kind === 'worker' ? 2 : 1;
const unitCell = (state: GameState, point: Point): number => Math.floor(point.y) * state.world.width + Math.floor(point.x);

/** Reserve a free sidestep, or clear a short chain of allies toward a vacancy.
 * Stable priority/id arbitration prevents two approaching units from repeatedly
 * asking each other to reverse. The original order is never overwritten. */
function requestFriendlyYield(state: GameState, requester: Unit, next: Point): boolean {
  const blocker = state.units.find(other => other.id !== requester.id && other.faction === requester.faction && other.hp > 0 && !other.inside && unitCell(state, other) === unitCell(state, next));
  if (!blocker) return false;
  const existing = friendlyYield.get(blocker);
  if (existing && distance(blocker, existing.point) > .12) return true;
  if (existing) friendlyYield.delete(blocker);
  const blockerBusy = blocker.moving || !!blocker.destination || !!blocker.path?.length;
  if ((blockerBusy || blocker.kind === 'leader') && (movementPriority(blocker) > movementPriority(requester) || movementPriority(blocker) === movementPriority(requester) && blocker.id < requester.id)) return false;
  const dx = next.x - requester.x, dy = next.y - requester.y, length = Math.hypot(dx, dy) || 1;
  const occupied = new Map(state.units.filter(unit => unit.hp > 0 && !unit.inside).map(unit => [unitCell(state, unit), unit]));
  const reserved = new Set<number>();
  for (const unit of state.units) { const order = friendlyYield.get(unit); if (order && distance(unit, order.point) > .12) reserved.add(unitCell(state, order.point)); }
  const visited = new Set<number>([requester.id]);
  const clear = (unit: Unit, depth: number): boolean => {
    if (depth > 6 || visited.has(unit.id)) return false;
    visited.add(unit.id);
    const candidates: { point: Point; score: number; occupant?: Unit }[] = [];
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      const point = { x: Math.floor(unit.x) + ox + .5, y: Math.floor(unit.y) + oy + .5 }, index = unitCell(state, point);
      if (reserved.has(index) || !canMove(state, unit, point, unit.faction)) continue;
      const occupant = occupied.get(index);
      if (occupant && (occupant.faction !== requester.faction || visited.has(occupant.id) || movementPriority(occupant) > movementPriority(requester))) continue;
      const lateral = Math.abs(ox * dy - oy * dx) / length, forward = (ox * dx + oy * dy) / length;
      // A side pocket wins; in a one-cell corridor, advance away from the
      // requester until a passing place becomes available.
      candidates.push({ point, occupant, score: lateral * 4 + forward * .8 - distance(unit, point) - (occupant ? 8 : 0) });
    }
    candidates.sort((a, b) => b.score - a.score || a.point.y - b.point.y || a.point.x - b.point.x);
    for (const candidate of candidates) {
      const movingAside = candidate.occupant && friendlyYield.get(candidate.occupant);
      if (candidate.occupant && !(movingAside && distance(candidate.occupant, movingAside.point) > .12) && !clear(candidate.occupant, depth + 1)) continue;
      reserved.add(unitCell(state, candidate.point));
      const oldOrder = unit === blocker ? existing : friendlyYield.get(unit);
      // Slow terrain needs time for both the sidestep and the requester to pass.
      const terrainSpeed = Math.min(1, movementMultiplier(state, unit.x, unit.y), movementMultiplier(state, candidate.point.x, candidate.point.y), movementMultiplier(state, requester.x, requester.y));
      friendlyYield.set(unit, { point: candidate.point, origin: oldOrder?.origin ?? { x: unit.x, y: unit.y }, requester: requester.id, until: state.time + 6 / terrainSpeed });
      unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0;
      return true;
    }
    return false;
  };
  const yielded = clear(blocker, 0);
  if (!yielded && existing) friendlyYield.set(blocker, existing);
  return yielded;
}

/** Called before normal unit work so held soldiers and palace workers can also
 * yield. A held unit returns to its post once the crossing has cleared. */
export function updateFriendlyYield(state: GameState, unit: Unit, dt: number): boolean {
  const order = friendlyYield.get(unit);
  if (!order) return false;
  if (unit.hp <= 0 || unit.inside || state.time >= order.until) { friendlyYield.delete(unit); return false; }
  const requester = state.units.find(other => other.id === order.requester && other.hp > 0 && !other.inside);
  if (distance(unit, order.point) > .12) { moveUnit(state, unit, order.point, dt, true); return true; }
  order.settledAt ??= state.time;
  if (state.time - order.settledAt < .35) return true;
  const cleared = !requester || distance(requester, order.origin) > 1.5 || (!requester.moving && !requester.destination && state.time - order.settledAt > 1);
  if (!cleared && !order.returning) return true;
  const returnBlockers = buildingBlockers(state, unit.faction);
  for (const occupied of occupiedCells(state, unit)) returnBlockers.add(occupied);
  if (unit.order === 'hold' && !order.returning && canMove(state, unit, order.origin, unit.faction, returnBlockers)) {
    const terrainSpeed = Math.min(1, movementMultiplier(state, unit.x, unit.y), movementMultiplier(state, order.origin.x, order.origin.y));
    order.point = order.origin; order.returning = true; order.settledAt = undefined; order.until = state.time + 3 / terrainSpeed;
    return true;
  }
  friendlyYield.delete(unit); unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0;
  return false;
}

export function moveUnit(state: GameState, unit: Unit, goal: Point, dt: number, direct = false, allowPartial = false): void {
  if (distance(unit, goal) < 0.12) { unit.moving = false; return; }
  const blockers = buildingBlockers(state, unit.faction), occupied = occupiedCells(state, unit);
  const cell = (point: Point): number => unitCell(state, point);
  let next = goal;
  if (!direct) {
    const stale = routeVersions.get(unit) !== (state.world.revision ?? 0);
    if ((stale || !unit.pathGoal || distance(unit.pathGoal, goal) > 0.8 || !unit.path?.length) && state.time >= (unit.repathAt ?? 0)) {
      const hard = new Set<number>(), soft = new Set<number>();
      for (const other of state.units) if (other.id !== unit.id && other.hp > 0 && !other.inside) (other.faction === unit.faction ? soft : hard).add(cell(other));
      unit.path = findPath(state, unit, goal, unit.faction, allowPartial || occupied.has(cell(goal)), hard, soft);
      // A crowded choke point is not a permanent wall. Keep a static route so
      // the first blocker can be asked to yield, instead of declaring failure.
      if (!unit.path.length) unit.path = findPath(state, unit, goal, unit.faction, allowPartial);
      unit.pathGoal = { ...goal }; routeVersions.set(unit, state.world.revision ?? 0);
      unit.repathAt = state.time + (unit.path.length ? .45 : 1.2) + (unit.id % 5) * .03;
    }
    while (unit.path?.length && distance(unit, unit.path[0]) < .12) {
      const node = unit.path[0];
      if ((occupied.has(cell(node)) && cell(node) !== cell(unit)) || !canMove(state, unit, node, unit.faction, blockers)) break;
      unit.x = node.x; unit.y = node.y; unit.path.shift();
    }
    if (!unit.path?.length) return;
    next = unit.path[0];
    if (occupied.has(cell(next)) && cell(next) !== cell(unit)) requestFriendlyYield(state, unit, next);
  }
  let dx = next.x - unit.x, dy = next.y - unit.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.01) return;
  const step = Math.min(length, unit.speed * dt * movementMultiplier(state, unit.x, unit.y) * (unit.order === 'flee' ? 0.95 : 1));
  dx = dx / length * step; dy = dy / length * step;
  const clear = (x: number, y: number): boolean => (!occupied.has(cell({ x, y })) || cell({ x, y }) === cell(unit)) && canMove(state, unit, { x, y }, unit.faction, blockers);
  const oldX = unit.x, oldY = unit.y;
  if (clear(unit.x + dx, unit.y + dy)) { unit.x += dx; unit.y += dy; }
  else {
    const candidate = { x: unit.x + dx, y: unit.y + dy };
    const traffic = occupied.has(cell(candidate)) && canMove(state, unit, candidate, unit.faction, blockers);
    if (traffic) requestFriendlyYield(state, unit, candidate);
    // Preserve the intended corridor while an ally yields. Reconsider a
    // moving blockage after a short delay instead of issuing A* every frame.
    if (!traffic || (unit.stuckFor ?? 0) > .65 && !friendlyYield.has(unit)) { unit.path = []; unit.repathAt = state.time + .25; }
    if (!traffic && clear(unit.x + dx, unit.y)) unit.x += dx;
    else if (!traffic && clear(unit.x, unit.y + dy)) unit.y += dy;
  }
  unit.moving = Math.hypot(unit.x - oldX, unit.y - oldY) > .001;
  if (unit.moving) { unit.facing = Math.atan2(unit.y - oldY, unit.x - oldX); unit.stuckFor = 0; }
  else unit.stuckFor = (unit.stuckFor ?? 0) + dt;
}
function losePopulation(state: GameState, factionId: number): void {
  const faction = factionOf(state, factionId);
  if (!faction || faction.population <= 0) return;
  faction.population--;
  synchronizeFarms(state);
}
function moraleRally(state: GameState, point: Point, faction: number, amount: number): void {
  for (const unit of state.units) if (unit.faction === faction && isMilitary(unit) && distance(unit, point) < 7) unit.morale = Math.min(100, unit.morale + amount);
}
function rehouse(state: GameState, factionId: number): void {
  const faction = factionOf(state, factionId);
  if (faction) faction.population = Math.min(faction.population, housingCapacity(state, factionId));
  synchronizeFarms(state);
}
function destroyTarget(state: GameState, attacker: Unit, target: Unit | Building): void {
  const faction = factionOf(state, attacker.faction);
  if (isBuilding(target)) {
    if (faction) faction.gold += target.kind === 'palace' ? 40 : target.kind === 'wall' ? 5 : 10;
    if (attacker.faction === 0) particle(state, center(target), `+${target.kind === 'palace' ? 40 : target.kind === 'wall' ? 5 : 10} gold`);
    if (target.capacity > 0) rehouse(state, target.faction);
    if (target.kind === 'palace') {
      const defender = factionOf(state, target.faction);
      if (defender) defender.defeated = target.faction === 0 ? !palaceOf(state, 0) : true;
      logEvent(state, `${defender?.name ?? 'A rival'}'s palace has fallen.`, target.faction === 0 ? 'warning' : 'good');
      if (target.faction !== 0) for (const unit of state.units) if (unit.faction === target.faction) { unit.order = 'flee'; unit.morale = 0; }
    }
  } else {
    if (faction) faction.gold += 4;
    if (attacker.faction === 0) particle(state, target, '+4 gold');
    if (target.kind === 'warrior') losePopulation(state, target.faction);
    if (target.kind === 'leader') {
      const defender = factionOf(state, target.faction);
      if (defender) defender.defeated = true;
      logEvent(state, `${defender?.name ?? 'A rival'}'s leader has fallen.`, target.faction === 0 ? 'warning' : 'good');
      if (target.faction !== 0) for (const unit of state.units) if (unit.faction === target.faction) { unit.order = 'flee'; unit.morale = 0; }
    }
  }
  moraleRally(state, target, attacker.faction, 18);
  for (const unit of state.units) if (unit.faction === target.faction && isMilitary(unit) && distance(unit, target) < 5) unit.morale = Math.max(0, unit.morale - 12);
  attacker.target = undefined;
}
function attackTarget(state: GameState, attacker: Unit, target: Unit | Building): void {
  if (attacker.cooldown > 0 || attacker.attack <= 0 || target.hp <= 0 || !hasAttackContact(state, attacker, attacker.faction, target)) return;
  const amount = Math.max(4, attacker.attack - (isBuilding(target) ? (target.armor ?? (target.kind === 'wall' ? 4 : 2)) : target.defense));
  target.hp = Math.max(0, target.hp - amount);
  attacker.cooldown = attacker.kind === 'leader' ? 0.75 : 0.95;
  attacker.attackTime = 0.28;
  attacker.lastCombat = state.time;
  const targetPoint = isBuilding(target) ? center(target) : target;
  attacker.facing = Math.atan2(targetPoint.y - attacker.y, targetPoint.x - attacker.x);
  if (!isBuilding(target)) target.lastCombat = state.time;
  if (target.hp <= 0) destroyTarget(state, attacker, target);
}
function fight(state: GameState, unit: Unit, target: Unit | Building, dt: number): void {
  if (unit.target !== target.id) {
    unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0;
  }
  unit.target = target.id;
  if (targetDistance(unit, target) <= unit.range && hasAttackContact(state, unit, unit.faction, target)) attackTarget(state, unit, target);
  else {
    const goal = approachPoint(state, unit, target);
    if (goal) moveUnit(state, unit, goal, dt, false, true);
    if (!unit.moving && !unit.path?.length) {
      const blockingWall = state.buildings.filter(building => building.kind === 'wall' && atWar(state, unit.faction, building.faction) && edgeDistance(unit, building) <= unit.range).sort((a, b) => distance(center(a), isBuilding(target) ? center(target) : target) - distance(center(b), isBuilding(target) ? center(target) : target))[0];
      if (blockingWall) { attackTarget(state, unit, blockingWall); unit.target = target.id; }
    }
  }
}

function updateMorale(state: GameState, unit: Unit, dt: number): void {
  if (!isMilitary(unit) || unit.marauderPack !== undefined) return;
  const leader = getLeader(state, unit.faction);
  const enemies = state.units.filter(other => isMilitary(other) && atWar(state, unit.faction, other.faction) && distance(unit, other) < 5 && other.hp > 0);
  const allies = state.units.filter(other => isMilitary(other) && other.faction === unit.faction && distance(unit, other) < 5 && other.hp > 0);
  const nearLeader = !!leader && distance(unit, leader) < 5;
  const fightingAllies = allies.some(other => other.id !== unit.id && state.time - other.lastCombat < 2);
  let change = enemies.length === 0 ? 6 : nearLeader ? 2 : 0.5;
  if (fightingAllies) change += 1.5;
  if (unit.hp < 30 && enemies.length) change -= 35 + (30 - unit.hp) * 2.5;
  if (enemies.length > allies.length * 1.5) change -= (enemies.length - allies.length) * 2.5;
  if (unit.order === 'flee') {
    const shelter = state.buildings.some(building => building.faction === unit.faction && building.hp > 0 && !isRoute(building.kind) && edgeDistance(unit, building) < 2.5);
    if (shelter && !enemies.length) change += 8;
  }
  unit.morale = Math.max(0, Math.min(100, unit.morale + change * dt));
  if (unit.morale <= 0 && unit.order !== 'flee') {
    unit.order = 'flee';
    unit.routed = true;
    unit.target = undefined;
    unit.path = undefined;
    moraleRally(state, unit, enemies[0]?.faction ?? -1, 12);
    if (unit.faction === 0) logEvent(state, `${unit.kind === 'leader' ? 'Your leader is' : 'A warrior is'} routing! Rally near friendly buildings.`, 'warning');
  }
  if (unit.order === 'flee' && unit.morale > 48 && !factionOf(state, unit.faction)?.defeated) {
    unit.order = 'follow'; unit.routed = false; unit.destination = undefined; unit.path = undefined;
  }
  if (nearLeader && state.time - unit.lastCombat > 30 && unit.hp < 100) unit.hp = Math.min(100, unit.hp + dt * 2.4);
}
function updateMarauderPacks(state: GameState): void {
  for (const pack of state.marauderPacks ?? []) {
    const members = state.units.filter(unit => unit.marauderPack === pack.id && unit.hp > 0);
    if (!members.length) continue;
    if (pack.approachAt !== undefined && state.time >= pack.approachAt) {
      const palace = palaceOf(state, pack.targetFaction);
      const approach = palace && approachPoint(state, members[0], palace);
      if (approach) {
        pack.waypoint = approach;
        pack.nextWanderAt = state.time + 45;
        for (const unit of members) { unit.path = undefined; unit.repathAt = 0; }
      }
      pack.approachAt = undefined;
      continue;
    }
    if (state.time < pack.nextWanderAt) continue;
    const radius = pack.approachAt !== undefined ? 2 : 7;
    for (let attempt = 0; attempt < 10; attempt++) {
      const angle = random(state) * Math.PI * 2, range = 1 + random(state) * radius;
      const goal = { x: Math.floor(pack.home.x + Math.cos(angle) * range) + .5, y: Math.floor(pack.home.y + Math.sin(angle) * range) + .5 };
      if (distance(members[0], goal) <= 1.35 || !canWalk(state, goal.x, goal.y, MARAUDER_FACTION)) continue;
      const patrol = findPath(state, members[0], goal, MARAUDER_FACTION);
      // A nearby point across a river can require a detour through a settlement.
      // Wandering stays local; the scheduled approach is the deliberate march.
      if (!patrol.length || patrol.some(point => distance(point, pack.home) > radius + 2)) continue;
      pack.waypoint = goal;
      break;
    }
    pack.nextWanderAt = state.time + 12 + random(state) * 14;
  }
}
function updateMarauder(state: GameState, unit: Unit, dt: number): void {
  const target = targetEntity(state, unit.target);
  const enemy = nearestEnemy(state, unit, 5.5, true) ?? (target && validTarget(state, unit, target) && targetDistance(unit, target) < 8 ? target : undefined);
  if (enemy) { fight(state, unit, enemy, dt); return; }
  unit.target = undefined;
  const pack = state.marauderPacks?.find(pack => pack.id === unit.marauderPack);
  if (pack && distance(unit, pack.waypoint) > 1.35) moveUnit(state, unit, pack.waypoint, dt);
}
function updateFleeing(state: GameState, unit: Unit, dt: number): void {
  const buildings = state.buildings.filter(building => building.faction === unit.faction && building.hp > 0 && !isRoute(building.kind) && building.kind !== 'wall');
  buildings.sort((a, b) => edgeDistance(unit, a) - edgeDistance(unit, b));
  const refuge = buildings[0];
  if (!refuge || edgeDistance(unit, refuge) < 1) return;
  const goal = approachPoint(state, unit, refuge);
  if (goal) moveUnit(state, unit, goal, dt);
}
function updateWarrior(state: GameState, unit: Unit, dt: number): void {
  const leader = getLeader(state, unit.faction);
  const leaderDistance = leader ? distance(unit, leader) : Infinity;
  if (unit.order === 'raid') {
    const defender = nearestEnemy(state, unit, 3.2);
    if (defender) { fight(state, unit, defender, dt); return; }
    const palace = palaceOf(state, 0);
    if (palace) {
      fight(state, unit, palace, dt);
    }
    return;
  }
  if (unit.order === 'follow' && leader && (leaderDistance > 8 || (leader.moving && leaderDistance > 4))) {
    unit.target = undefined;
    moveInFormation(state, unit, leader, dt);
    return;
  }
  const enemy = nearestEnemy(state, unit, unit.order === 'hold' ? 1.5 : 5.5, true, target =>
    (unit.order !== 'hold' || targetDistance(unit, target) <= unit.range && hasAttackContact(state, unit, unit.faction, target)) &&
    (unit.order !== 'follow' || !leader || targetDistance(leader, target) <= 8));
  if (enemy) { fight(state, unit, enemy, dt); return; }
  unit.target = undefined;
  if (unit.order === 'follow' && leader) moveInFormation(state, unit, leader, dt);
}
function moveInFormation(state: GameState, unit: Unit, leader: Unit, dt: number): void {
  const formation = retinueFormation(state, leader), goal = formation.goals.get(unit.id);
  if (!goal) return;
  // Continuously follow a nearby visible slot instead of waiting on an A*
  // refresh for each tile the leader crosses. Bent/blocked routes still use
  // normal pathfinding and all movement still respects occupied cells.
  if (distance(unit, goal) > .12) moveUnit(state, unit, goal, dt, distance(unit, goal) < 6 && canMove(state, unit, goal, unit.faction));
  if (distance(unit, goal) < 1.5) unit.facing = formation.heading;
}
function updateLeader(state: GameState, leader: Unit, dt: number, input: InputState): void {
  const dx = Number(input.right) - Number(input.left), dy = Number(input.down) - Number(input.up);
  if (dx || dy) {
    leader.target = undefined; leader.destination = undefined; leader.path = undefined;
    const length = Math.hypot(dx, dy);
    moveUnit(state, leader, { x: leader.x + dx / length, y: leader.y + dy / length }, dt, true);
    return;
  }
  const target = targetEntity(state, leader.target);
  if (leader.faction === 0 && target && !entityVisible(state, target)) {
    leader.target = undefined; leader.path = undefined; leader.pathGoal = undefined;
    return;
  }
  // A player-issued attack remains explicit; AI leaders reconsider nearby
  // threats every step instead of staying locked onto the first leader seen.
  if (leader.faction === 0 && target && validTarget(state, leader, target)) { fight(state, leader, target, dt); return; }
  const pursuing = leader.faction !== 0 && target && validTarget(state, leader, target) && targetDistance(leader, target) < 8 ? target : undefined;
  leader.target = pursuing?.id;
  if (leader.destination) {
    if (distance(leader, leader.destination) < 0.22) leader.destination = undefined;
    else {
      const canRepath = state.time >= (leader.repathAt ?? 0);
      if (leader.path?.length && leader.pathGoal && distance(leader.pathGoal, leader.destination) < .8) acceptedMoveOrders.set(leader, leader.destination);
      moveUnit(state, leader, leader.destination, dt);
      if (leader.moving || leader.path?.length) acceptedMoveOrders.set(leader, leader.destination);
      // A dead-end click must not leave the leader permanently unable to defend.
      // Ignore temporary unit traffic, and keep a previously valid order when a
      // gate closes so movement resumes if its route opens again.
      if (leader.faction === 0 && canRepath && !leader.moving && !leader.path?.length && acceptedMoveOrders.get(leader) !== leader.destination && !findPath(state, leader, leader.destination, leader.faction).length) {
        leader.destination = undefined; leader.path = undefined; leader.pathGoal = undefined; leader.repathAt = 0;
      }
    }
  }
  if (leader.faction === 0) {
    // Defend an idle leader without creating a pursuit order. Movement and
    // explicit attacks above always take precedence over automatic strikes.
    const enemy = (!leader.destination || (!leader.moving && !leader.path?.length)) && nearestEnemy(state, leader, leader.range + 1e-7, false, target => hasAttackContact(state, leader, leader.faction, target));
    if (enemy) attackTarget(state, leader, enemy);
    return;
  }
  const enemy = nearestEnemy(state, leader, 3.5, true);
  const palace = palaceOf(state, leader.faction);
  if (enemy && (pursuing || !palace || edgeDistance(leader, palace) < 7)) fight(state, leader, enemy, dt);
  else if (pursuing) fight(state, leader, pursuing, dt);
  else if (palace && edgeDistance(leader, palace) > 5) {
    const point = approachPoint(state, leader, palace);
    if (point) moveUnit(state, leader, point, dt);
  }
}
function updateRoads(state: GameState): void {
  // Preserve the historical lab baseline without retaining its unused flag in production state.
  const buildings = state.buildings as readonly (Building & { connected?: boolean })[];
  for (const road of buildings) if (isRoute(road.kind)) road.connected = false;
  for (const faction of state.factions) {
    const palaces = buildings.filter(building => building.faction === faction.id && building.kind === 'palace' && buildingReady(building));
    const roads = buildings.filter(building => building.faction === faction.id && isRoute(building.kind) && buildingReady(building));
    const frontier: Building[] = [];
    for (const road of roads) {
      if (palaces.some(palace => {
        const x = road.x, y = road.y;
        return ((x === palace.x - 1 || x === palace.x + 2) && y >= palace.y && y < palace.y + 2) || ((y === palace.y - 1 || y === palace.y + 2) && x >= palace.x && x < palace.x + 2);
      })) { road.connected = true; frontier.push(road); }
    }
    for (let i = 0; i < frontier.length; i++) for (const road of roads) {
      if (!road.connected && Math.abs(road.x - frontier[i].x) + Math.abs(road.y - frontier[i].y) === 1) {
        road.connected = true;
        frontier.push(road);
      }
    }
  }
}
function calculateYields(state: GameState, faction: Faction): void {
  // Food is delivered physically. The HUD shows the potential surplus per 30s,
  // while only the collection route can credit the actual food balance.
  const fields = (state.fields ?? []).filter(field => field.faction === faction.id && field.planted);
  const population = faction.population;
  const maintenance = state.buildings.filter(building => building.faction === faction.id && buildingReady(building) && !isRoute(building.kind)).reduce((sum, building) => sum + (building.kind === 'palace' ? 1 : .2), 0);
  const warriors = state.units.filter(unit => unit.kind === 'warrior' && unit.faction === faction.id && unit.hp > 0).length;
  faction.yields = { food: fields.length * 3 - population, production: Math.round((population * 2 - maintenance) * 10) / 10, gold: Math.round((population - warriors * .5) * 10) / 10 };
}
function canAfford(faction: Faction, kind: BuildingKind): boolean {
  const cost = BUILD_COSTS[kind];
  return faction.food >= cost.food && faction.gold >= cost.gold && faction.production >= cost.production;
}
function pay(faction: Faction, kind: BuildingKind): void {
  const cost = BUILD_COSTS[kind]; faction.food -= cost.food; faction.gold -= cost.gold; faction.production -= cost.production;
}
function emptyHome(state: GameState, faction: Faction): Building | undefined {
  return state.buildings.find(building => building.faction === faction.id && isHome(building) && buildingReady(building) && (building.residents ?? 0) < 4);
}
function growPopulation(state: GameState, faction: Faction): boolean {
  let home = emptyHome(state, faction);
  if (!home) {
    if (state.buildings.some(building => building.faction === faction.id && isHome(building) && building.construction)) return false;
    const palace = palaceOf(state, faction.id);
    if (!palace || !canAfford(faction, 'camp')) return false;
    const reachable = palaceReachability(state, palace);
    const spot = nearbyOpen(state, center(palace), 2.2, 15, point => {
      if (!reachable[Math.floor(point.y) * state.world.width + Math.floor(point.x)]) return -Infinity;
      if (!campSpacingAllowed(state, Math.floor(point.x), Math.floor(point.y))) return -Infinity;
      const tile = tileAt(state.world, point.x, point.y)!;
      if (!['none', 'forest', 'jungle', 'swamp'].includes(tile.overlay)) return -Infinity;
      const fields = [[0, 1], [1, 0], [0, -1], [-1, 0]].filter(([dx, dy]) => {
        const x = Math.floor(point.x) + dx, y = Math.floor(point.y) + dy;
        return freeField(state, x, y);
      }).length;
      if (fields < 4) return -Infinity;
      return fields * 2 - distance(point, center(palace)) * .35 + random(state) * .4
        + buildingAlignmentBonus(state, faction.id, Math.floor(point.x), Math.floor(point.y));
    });
    if (!spot) return false;
    pay(faction, 'camp');
    home = makeBuilding(state, 'camp', faction.id, spot);
    queueConstruction(home, state.time);
    return false;
  }
  home.residents = (home.residents ?? 0) + 1;
  faction.population++;
  faction.food = Math.max(0, faction.food - 4);
  synchronizeFarms(state); ensureCollectors(state);
  return true;
}
function economyTick(state: GameState): void {
  updateRoads(state);
  for (const faction of state.factions) {
    if (faction.defeated || faction.relation === 'confederated') continue;
    calculateYields(state, faction);
    faction.food = Math.max(0, faction.food - faction.population);
    faction.gold = Math.max(0, faction.gold + faction.yields.gold);
    faction.production = Math.max(0, faction.production + faction.yields.production);
    let growth = baselineGrowth.get(faction) ?? 0;
    if (faction.yields.food > 0 && faction.food >= 6) {
      growth += Math.min(2.4, 0.14 + faction.yields.food / 13);
      let births = 0;
      while (growth >= 1 && births < 3) {
        if (!growPopulation(state, faction)) break;
        growth -= 1; births++;
      }
    } else if (faction.food <= 0 && faction.yields.food < 0) {
      growth = Math.max(0, growth - 0.3);
      if (faction.id === 0) logEvent(state, 'Food is scarce. Keep the routes between fields and your palace open.', 'warning');
    }
    baselineGrowth.set(faction, growth);
    syncRetinue(state, faction);
    calculateYields(state, faction);
  }
}
function launchRaid(state: GameState, faction: Faction): void {
  const palace = palaceOf(state, faction.id), target = palaceOf(state, 0);
  if (!palace || !target) return;
  const available = state.units.filter(unit => unit.kind === 'warrior' && unit.faction === faction.id && unit.hp > 65 && unit.order !== 'raid' && unit.order !== 'flee');
  const count = Math.min(available.length, state.time < 240 ? 1 : 2 + Math.floor(state.time / 300));
  for (let i = 0; i < count; i++) {
    available[i].order = 'raid'; available[i].target = target.id; available[i].path = undefined; available[i].repathAt = 0;
  }
  if (count) logEvent(state, `${faction.name} sent ${count === 1 ? 'a raider' : `${count} raiders`} toward your palace!`, 'warning');
  faction.nextRaid = state.time + 85 + random(state) * 65;
}
function separateUnits(state: GameState, oldPositions: Map<number, Point>): void {
  for (let i = 0; i < state.units.length; i++) {
    const unit = state.units[i];
    if (!unit.moving || unit.hp <= 0 || unit.inside) continue;
    for (let j = 0; j < i; j++) {
      const other = state.units[j];
      const d = distance(unit, other);
      if (d >= 1 || other.hp <= 0 || other.inside) continue;
      const angle = d < 0.001 ? unit.id * 2.4 : Math.atan2(unit.y - other.y, unit.x - other.x);
      const correction = Math.min(0.08, (1 - d) * .55);
      const x = unit.x + Math.cos(angle) * correction, y = unit.y + Math.sin(angle) * correction;
      const next = unit.path?.[0];
      // Diagonal corner passages require exact alignment. A cosmetic spacing
      // nudge must not move a traveler off its currently traversable segment.
      if (next && canMove(state, unit, next, unit.faction) && !canMove(state, { x, y }, next, unit.faction)) continue;
      if (!state.units.some(other => other.id !== unit.id && other.hp > 0 && !other.inside && Math.floor(other.x) === Math.floor(x) && Math.floor(other.y) === Math.floor(y)) && canMove(state, unit, { x, y }, unit.faction) && canMove(state, oldPositions.get(unit.id) ?? unit, { x, y }, unit.faction)) { unit.x = x; unit.y = y; }
    }
  }
}
function checkGameOver(state: GameState): void {
  if (!getLeader(state) || !palaceOf(state, 0)) {
    state.gameOver = true; state.victory = false;
    logEvent(state, 'Your crown has fallen. A new world awaits another leader.', 'warning');
  } else if (state.factions.length > 1 && state.factions.slice(1).every(faction => faction.defeated || faction.relation === 'confederated')) {
    state.gameOver = true; state.victory = true;
    logEvent(state, 'The valley is united under your crown. Victory!', 'good');
  }
}
function stepGame(state: GameState, dt: number, input: InputState): void {
  state.time += dt;
  if (updateConstruction(state)) { updateRoads(state); synchronizeFarms(state); ensureCollectors(state); }
  ensureBuilders(state);
  synchronizeFarms(state); updateHarvests(state);
  const oldPositions = new Map(state.units.filter(unit => !unit.inside).map(unit => [unit.id, { x: unit.x, y: unit.y }]));
  // Keep the event's world position fixed for fog checks; the renderer animates its rise.
  for (const particle of state.particles) particle.life -= dt;
  state.particles = state.particles.filter(particle => particle.life > 0);
  updateMarauderPacks(state);
  for (const unit of state.units) {
    if (unit.hp <= 0) continue;
    unit.moving = false; unit.cooldown = Math.max(0, unit.cooldown - dt); unit.attackTime = Math.max(0, unit.attackTime - dt);
    updateMorale(state, unit, dt);
    if (updateFriendlyYield(state, unit, dt)) continue;
    if (unit.marauderPack !== undefined) { updateMarauder(state, unit, dt); continue; }
    if (unit.order === 'flee') { updateFleeing(state, unit, dt); continue; }
    if (unit.kind === 'leader') updateLeader(state, unit, dt, unit.faction === 0 ? input : NO_INPUT);
    else if (unit.kind === 'warrior') updateWarrior(state, unit, dt);
    else if (unit.kind === 'worker' && unit.builder) updateBuilder(state, unit, dt, moveUnit);
    else if (unit.kind === 'worker' && unit.collector) updateCollector(state, unit, dt, moveUnit);
  }
  separateUnits(state, oldPositions);
  let newRoad = false;
  for (const unit of state.units) { const from = oldPositions.get(unit.id); if (from && recordTraffic(state, unit, from)) newRoad = true; }
  updateTraffic(state);
  if (newRoad) updateRoads(state);
  (state as unknown as { units: Unit[] }).units = state.units.filter(unit => unit.hp > 0);
  const oldBuildings = state.buildings.length;
  (state as unknown as { buildings: Building[] }).buildings = state.buildings.filter(building => building.hp > 0);
  if (oldBuildings !== state.buildings.length) updateRoads(state);
  const ticks = Math.floor((state.time + 1e-7) / ECONOMY_INTERVAL);
  while (state.tick < ticks) { state.tick++; economyTick(state); }
  ensureCollectors(state);
  for (const faction of state.factions) if (faction.relation === 'war' && !faction.defeated && state.time >= faction.nextRaid) launchRaid(state, faction);
  checkGameOver(state);
}
export function updateGame(state: GameState, dt: number, input: InputState): void {
  if (state.paused || state.gameOver || !Number.isFinite(dt) || dt <= 0) return;
  let remaining = Math.min(dt, 60) * state.speed;
  while (remaining > 1e-8 && !state.gameOver) {
    const step = Math.min(remaining, 0.1);
    stepGame(state, step, input);
    remaining -= step;
  }
  updateFog(state);
}

/** Holding is an explicit command; selecting a soldier must never stop its following. */
export function setRetinueOrder(state: GameState, order: 'hold' | 'follow', unitId?: number): void {
  for (const unit of state.units) {
    if (unit.faction !== 0 || unit.kind !== 'warrior' || unit.order === 'flee' || (unitId !== undefined && unit.id !== unitId)) continue;
    unit.order = order; unit.target = undefined; unit.destination = undefined;
    unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0;
  }
}

export function interactAt(state: GameState, x: number, y: number): void {
  if (state.gameOver) return;
  const leader = getLeader(state);
  if (!leader) return;
  const point = { x, y };
  const clickedUnit = unitAtPoint(state, point);
  if (clickedUnit) {
    if (clickedUnit.faction === 0) {
      state.selected = clickedUnit.id; state.selectedType = 'unit'; state.diplomacy = null;
      return;
    }
    if (atWar(state, 0, clickedUnit.faction)) {
      leader.target = clickedUnit.id; leader.destination = undefined; leader.path = undefined; leader.repathAt = 0;
      state.selected = clickedUnit.marauderPack !== undefined ? clickedUnit.id : leader.id; state.selectedType = 'unit'; state.diplomacy = null;
    } else logEvent(state, 'These people are at peace. Approach their palace for diplomacy.');
    return;
  }
  const clickedBuilding = state.buildings.find(building => {
    const size = buildingSize(building);
    return building.hp > 0 && !isRoute(building.kind) && entityVisible(state, building) && x >= building.x && y >= building.y && x < building.x + size && y < building.y + size;
  });
  if (clickedBuilding && !isRoute(clickedBuilding.kind)) {
    state.selected = clickedBuilding.id; state.selectedType = 'building';
    if (clickedBuilding.kind === 'palace' && clickedBuilding.faction !== 0) {
      if (edgeDistance(leader, clickedBuilding) <= 6 && !factionOf(state, clickedBuilding.faction)?.defeated) {
        state.diplomacy = clickedBuilding.faction;
      }
      else { state.diplomacy = null; logEvent(state, 'Bring your leader within 6 tiles of this palace to speak with its people.'); }
      return;
    }
    if (atWar(state, 0, clickedBuilding.faction)) {
      leader.target = clickedBuilding.id; leader.destination = undefined; leader.path = undefined; leader.repathAt = 0;
    }
    return;
  }
  state.diplomacy = null;
  if (canWalk(state, x, y, 0)) {
    leader.destination = { x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5 };
    leader.target = undefined; leader.path = undefined; leader.repathAt = 0;
    state.selected = leader.id; state.selectedType = 'unit';
  }
}

/** Placement previews and construction share this read-only validation. */
export function validateBuildAt(state: GameState, kind: BuildingKind, x: number, y: number): { ok: boolean; message: string } {
  const leader = getLeader(state), faction = factionOf(state, 0);
  if (state.gameOver || !leader || !faction) return { ok: false, message: 'This realm can no longer build.' };
  if (!['road', 'wall', 'bridge', 'tower'].includes(kind)) return { ok: false, message: 'Choose a wall, bridge, or guard tower.' };
  const point = { x: Math.floor(x), y: Math.floor(y) };
  if (distance(leader, { x: point.x + 0.5, y: point.y + 0.5 }) > 10) return { ok: false, message: 'Build within 10 tiles of your leader.' };
  if (!isVisible(state, point.x + .5, point.y + .5)) return { ok: false, message: 'Explore this tile before building.' };
  if (kind === 'bridge') {
    if (tileAt(state.world, point.x, point.y)?.terrain !== 'river') return { ok: false, message: 'Bridges span river tiles.' };
  } else if (!traversable(state.world, point.x, point.y)) return { ok: false, message: 'Build on dry land.' };
  if (!canAfford(faction, kind)) return { ok: false, message: `Need ${BUILD_COSTS[kind].production} materials${BUILD_COSTS[kind].gold ? ` and ${BUILD_COSTS[kind].gold} gold` : ''}.` };
  if (state.buildings.some(building => {
    const gateLayer = (building.faction === 0 || building.faction < 0) && ((kind === 'road' && building.kind === 'wall') || (kind === 'wall' && building.kind === 'road'));
    if (gateLayer) return false;
    const size = buildingSize(building);
    return building.hp > 0 && point.x >= building.x && point.y >= building.y && point.x < building.x + size && point.y < building.y + size;
  })) return { ok: false, message: 'Tile occupied.' };
  if (state.fields?.some(field => field.x === point.x && field.y === point.y) || isPendingCampField(state, point.x, point.y)) return { ok: false, message: 'Keep this field open.' };
  if (kind === 'road' && !canPlaceRoad(state, point.x, point.y)) return { ok: false, message: 'Roads must remain lines or junctions.' };
  const isGate = kind === 'wall' && state.buildings.some(building => building.kind === 'road' && building.hp > 0 && building.x === point.x && building.y === point.y);
  if ((kind === 'tower' || (kind === 'wall' && !isGate)) && state.units.some(unit => unit.hp > 0 && !unit.inside && unit.x + UNIT_RADIUS > point.x && unit.x - UNIT_RADIUS < point.x + 1 && unit.y + UNIT_RADIUS > point.y && unit.y - UNIT_RADIUS < point.y + 1)) return { ok: false, message: 'Move the unit first.' };
  if (state.buildings.some(building => building.faction > 0 && !factionOf(state, building.faction)?.defeated && distance(center(building), { x: point.x + 0.5, y: point.y + 0.5 }) < 2.5)) {
    return { ok: false, message: 'Build outside another settlement’s boundary.' };
  }
  return { ok: true, message: '' };
}

export function buildAt(state: GameState, kind: BuildingKind, x: number, y: number): { ok: boolean; message: string } {
  const validation = validateBuildAt(state, kind, x, y);
  if (!validation.ok) return validation;
  const faction = factionOf(state, 0)!;
  const point = { x: Math.floor(x), y: Math.floor(y) };
  pay(faction, kind);
  const building = makeBuilding(state, kind, 0, point);
  queueConstruction(building, state.time);
  ensureBuilders(state);
  updateRoads(state); calculateYields(state, faction);
  const message = `${kind.charAt(0).toUpperCase() + kind.slice(1)} ordered. A palace peasant will begin construction.`;
  return { ok: true, message };
}

/** Apply current simulation rules when opening an older saved realm. */
export function migrateGame(state: GameState): GameState {
  normalizePunyWorld(state.world);
  // Retire legacy concepts with no matching Puny assets, including fog memories.
  const removedIds = new Set([...state.units.filter(unit => !SUPPORTED_UNITS.has(unit.kind)).map(unit => unit.id), ...state.buildings.filter(building => building.kind === 'ruin').map(building => building.id)]);
  (state as unknown as { units: Unit[] }).units = state.units.filter(unit => SUPPORTED_UNITS.has(unit.kind));
  (state as unknown as { buildings: Building[] }).buildings = state.buildings.filter(building => building.kind !== 'ruin');
  for (const building of state.buildings) clearBuildingVegetation(state, building);
  if (state.fog?.buildings) state.fog.buildings = state.fog.buildings.filter(building => building.kind !== 'ruin');
  for (const unit of state.units) if (unit.target !== undefined && removedIds.has(unit.target)) unit.target = undefined;
  if (state.selected !== null && removedIds.has(state.selected)) {
    state.selected = getLeader(state)?.id ?? null;
    state.selectedType = state.selected === null ? null : 'unit';
  }
  for (const faction of state.factions) faction.color = FACTION_COLORS[faction.id % FACTION_COLORS.length];
  const blockers = buildingBlockers(state, 0);
  const solidWalls = state.buildings.filter(building => building.kind === 'wall' && building.hp > 0 && blockers.has(building.y * state.world.width + building.x));
  const wallTiles = new Set(solidWalls.map(wall => wall.y * state.world.width + wall.x));
  for (const unit of state.units) {
    // Older saves allowed allies to stand inside walls. Move only those overlapping
    // a newly solid wall to its nearest open edge, without crossing water or houses.
    if (unit.hp > 0 && solidWalls.some(wall => unit.x + UNIT_RADIUS > wall.x && unit.x - UNIT_RADIUS < wall.x + 1 && unit.y + UNIT_RADIUS > wall.y && unit.y - UNIT_RADIUS < wall.y + 1)) {
      const queue: Point[] = [{ x: Math.floor(unit.x), y: Math.floor(unit.y) }], visited = new Set<number>();
      let replacement: Point | undefined;
      for (let index = 0; index < queue.length && !replacement; index++) {
        const tile = queue[index], key = tile.y * state.world.width + tile.x;
        if (visited.has(key)) continue;
        visited.add(key);
        const point = { x: tile.x + .5, y: tile.y + .5 };
        if (canMove(state, point, point, unit.faction, blockers)) { replacement = point; break; }
        if (index > 0 && !wallTiles.has(key)) continue;
        const neighbors = [{ x: tile.x - 1, y: tile.y }, { x: tile.x + 1, y: tile.y }, { x: tile.x, y: tile.y - 1 }, { x: tile.x, y: tile.y + 1 }];
        neighbors.sort((a, b) => distance(unit, { x: a.x + .5, y: a.y + .5 }) - distance(unit, { x: b.x + .5, y: b.y + .5 }));
        for (const neighbor of neighbors) if (traversable(state.world, neighbor.x, neighbor.y) && (wallTiles.has(neighbor.y * state.world.width + neighbor.x) || canWalk(state, neighbor.x, neighbor.y, unit.faction, blockers))) queue.push(neighbor);
      }
      if (replacement) {
        unit.x = replacement.x; unit.y = replacement.y; unit.destination = undefined;
        if (unit.kind === 'worker') unit.work = { ...replacement };
      }
    }
    if (unit.kind === 'warrior') unit.speed = unit.marauderPack !== undefined ? 2.35 : RETINUE_SPEED;
    unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0;
  }
  if (state.marauderPacks === undefined) seedMarauders(state);
  migrateFarms(state); ensureBuilders(state);
  if (state.buildMode && !['road', 'wall', 'bridge', 'tower'].includes(state.buildMode)) state.buildMode = null;
  updateRoads(state);
  for (const faction of state.factions) calculateYields(state, faction);
  updateFog(state);
  return state;
}

export function diplomacyAction(state: GameState, factionId: number, action: 'war' | 'confederate'): { ok: boolean; message: string } {
  const faction = factionOf(state, factionId), leader = getLeader(state), palace = palaceOf(state, factionId);
  if (state.gameOver || !faction || factionId === 0 || faction.defeated || faction.relation === 'confederated') return { ok: false, message: 'This faction is no longer available for diplomacy.' };
  if (!leader || !palace || edgeDistance(leader, palace) > 6) return { ok: false, message: 'Your leader must be within 6 tiles of their palace.' };
  if (action === 'war') {
    if (faction.relation === 'war') return { ok: false, message: 'You are already at war.' };
    faction.relation = 'war'; faction.nextRaid = state.time + 15;
    const message = `War declared on ${faction.name}. Their warriors will defend the palace.`;
    logEvent(state, message, 'warning'); return { ok: true, message };
  }
  if (faction.lastDiplomacy !== undefined && state.time - faction.lastDiplomacy < 30) return { ok: false, message: 'Allow 30 seconds for your hosts to reconsider.' };
  faction.lastDiplomacy = state.time;
  const chance = (0.15 + faction.affinity * 0.007) * (faction.relation === 'war' ? 0.5 : 1);
  if (random(state) < chance) {
    const player = state.factions[0];
    player.food += faction.food; player.gold += faction.gold; player.production += faction.production; player.population += faction.population;
    faction.food = 0; faction.gold = 0; faction.production = 0; faction.population = 0; faction.yields = { food: 0, production: 0, gold: 0 };
    faction.relation = 'confederated';
    for (const building of state.buildings) if (building.faction === factionId) building.faction = 0;
    for (const tile of state.world.tiles) if (tile.farm === factionId) tile.farm = 0;
    for (const field of state.fields ?? []) if (field.faction === factionId) field.faction = 0;
    state.world.revision = (state.world.revision ?? 0) + 1;
    for (const unit of state.units) if (unit.faction === factionId) {
      unit.faction = 0; unit.target = undefined; unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0; unit.destination = undefined; unit.morale = Math.max(60, unit.morale);
      if (unit.kind === 'leader') { unit.kind = 'warrior'; unit.attack = 20; unit.range = 1.2; }
      if (unit.kind === 'warrior') unit.speed = RETINUE_SPEED;
      unit.order = unit.kind === 'worker' ? 'work' : 'follow';
    }
    synchronizeFarms(state); ensureCollectors(state);
    updateRoads(state); calculateYields(state, player); state.diplomacy = null;
    const message = `${faction.name} joins your realm! Its people, buildings, and stores are now yours.`;
    logEvent(state, message, 'good'); checkGameOver(state);
    return { ok: true, message };
  }
  if (random(state) < (100 - faction.affinity) / 130) {
    faction.relation = 'war'; faction.nextRaid = state.time + 12;
    const message = `${faction.name} rejected confederation and declared war!`;
    logEvent(state, message, 'warning'); return { ok: false, message };
  }
  const message = `${faction.name} declines for now. You may ask again in 30 seconds.`;
  logEvent(state, message); return { ok: false, message };
}
