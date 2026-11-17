import { entityStore } from './entity-store';
import { markWorldChanged } from './world-revisions';
import { constructionEdges } from './builders';
import { canWalk, createReachabilityQuery, hasStaticPath, invalidateNavigation } from './pathfinding';
import { territory } from './borders';
import { territoryValue } from './territory-cells';
import { removeVillageTrailAt } from './village-trails';
import { dockPlacement } from './dock';
import { DOCK_HP } from './dock-config';
import { houseCapacity } from './wells';
import { validatePhysicalFootprint } from './placement-physical';
import { scenarioStructuresAllowed } from './scenario-access-native';
import { reliefFootprintAllowed } from './relief';
import { unitSpawnTerrainAllowed } from './terrain-sites';
import { KIND_BY_CODE, UPGRADE_CODE, type BuildReason, type BuildRequest, type SpawnRow } from './settlement-bridge';
import { buildingHeight, buildingWidth, isWallKind, tileAt, type Building, type BuildingKind, type GameState, type NeutralVillage, type Point } from './types';

const HP: Partial<Record<BuildingKind, number>> = { woodenTower: 600, guardPost: 400, library: 750, monument: 250, blacksmith: 250, archeryRange: 250,
  scoutLodge: 250, stable: 250, healerShack: 250, dock: DOCK_HP, house: 160, well: 100, road: 100, villageTent: 160 };

export function villageCampBuilding(state: GameState, village: NeutralVillage): Building | undefined {
  const camp = entityStore(state).buildings.get(village.campId);
  return camp && camp.hp > 0 && (camp.kind === 'villageTent' || village.secededCity && camp.kind === 'palace') ? camp : undefined;
}

/** Instantly completed village structure (villages have no builders). */
export function addVillageBuilding(state: GameState, village: NeutralVillage, kind: BuildingKind, point: Point, level = 1): Building {
  if (!reliefFootprintAllowed(state.world, point.x, point.y, buildingWidth({ kind }), buildingHeight({ kind }), isWallKind(kind)))
    throw new Error('Village structures require suitable, unobstructed ground.');
  const hp = HP[kind] ?? 160;
  const building: Building = { id: entityStore(state).allocateId(), kind, faction: village.faction, villageId: village.id, x: point.x, y: point.y,
    hp, maxHp: hp, capacity: 0, residents: 0, armor: kind === 'woodenTower' ? 6 : 0 };
  if (kind === 'house') { building.houseLevel = level; building.houseStyle = 'shack'; building.capacity = houseCapacity(building, undefined, state); }
  if (kind === 'dock') { building.dockFacing = dockPlacement(state, point.x, point.y, village.faction)?.facing; building.dockBoatLaunched = true; }
  for (let dy = 0; dy < buildingHeight(building); dy++) for (let dx = 0; dx < buildingWidth(building); dx++) {
    const tile = tileAt(state.world, point.x + dx, point.y + dy);
    if (tile && kind !== 'road') { tile.overlay = tile.overlay === 'ford' ? tile.overlay : 'none'; delete tile.palm; }
    if (kind === 'road') removeVillageTrailAt(state.world, point.x, point.y);
  }
  entityStore(state).buildings.add(building);
  return building;
}

function lotCells(village: NeutralVillage): Point[] {
  if (!village.layout) return [];
  const { lotX: x, lotY: y } = village.layout;
  return [{ x, y }, { x: x + 1, y }, { x, y: y + 1 }, { x: x + 1, y: y + 1 }];
}
const touches = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;

/** Validate each Rust request group through the physical placement rules and
 * the village rules (territory, road continuity, reachability), then place it
 * complete. Groups are all or nothing; result rows go straight back to Rust. */
export function applyVillageRequests(state: GameState, requests: readonly BuildRequest[]): { request: number; ok: boolean; building: number; reason: BuildReason }[] {
  const results: { request: number; ok: boolean; building: number; reason: BuildReason }[] = [];
  const groups = new Map<number, BuildRequest[]>();
  for (const request of requests) { const list = groups.get(request.group) ?? []; list.push(request); groups.set(request.group, list); }
  let changed: number[] = [];
  for (const rows of groups.values()) {
    const village = state.villages?.find(v => v.id === rows[0].village);
    const camp = village && villageCampBuilding(state, village);
    const failAll = (index: number, reason: BuildReason) => rows.forEach((row, i) => results.push({ request: row.request, ok: false, building: -1, reason: i === index ? reason : 6 }));
    if (!village || village.destroyed || !camp) { failAll(0, 1); continue; }
    const store = entityStore(state);
    if (rows[0].kind === UPGRADE_CODE) {
      const house = state.buildings.find(b => b.villageId === village.id && b.kind === 'house' && b.x === rows[0].x && b.y === rows[0].y && b.hp > 0);
      if (!house || (house.houseLevel ?? 1) >= rows[0].level) { failAll(0, 1); continue; }
      house.houseLevel = rows[0].level; house.maxHp += 40; house.hp += 40;
      house.houseStyle = rows[0].level >= 3 ? 'cottage' : 'hovel'; house.capacity = houseCapacity(house, undefined, state);
      store.buildings.updateRoles(house);
      results.push({ request: rows[0].request, ok: true, building: house.id, reason: 0 });
      continue;
    }
    const borders = territory(state), width = state.world.width;
    const villageRoads = state.buildings.filter(b => b.villageId === village.id && b.kind === 'road' && b.hp > 0);
    let failure: { index: number; reason: BuildReason } | undefined;
    const placed: { row: BuildRequest; kind: BuildingKind; ford: boolean; replace?: Building }[] = [];
    rows.forEach((row, index) => {
      if (failure) return;
      const kind = KIND_BY_CODE.get(row.kind);
      if (!kind) { failure = { index, reason: 1 }; return; }
      const tent = kind === 'house' ? state.buildings.find(b => b.villageId === village.id && b.kind === 'villageTent' && b.id !== village.campId
        && b.x === row.x && b.y === row.y && b.hp > 0) : undefined;
      const physical = validatePhysicalFootprint(state, kind, row.x, row.y, village.faction, { ignore: tent ? new Set([tent.id]) : undefined });
      if (!physical.ok) { failure = { index, reason: physical.reason }; return; }
      for (let dy = 0; dy < row.h; dy++) for (let dx = 0; dx < row.w; dx++) {
        const owner = territoryValue(borders, (row.y + dy) * width + row.x + dx);
        if (owner !== undefined && owner >= 0 && owner !== village.faction) { failure = { index, reason: 3 }; return; }
      }
      if (kind === 'road') {
        const point = { x: row.x, y: row.y };
        const connected = index === 0 ? lotCells(village).some(cell => touches(cell, point)) || villageRoads.some(road => touches(road, point))
          || [...lotCells(village)].length === 0 : touches(rows[index - 1], point);
        if (!connected) { failure = { index, reason: 4 }; return; }
      }
      placed.push({ row, kind, ford: !!physical.ford, replace: tent });
    });
    if (!failure && placed.some(item => item.kind !== 'road')) {
      // Every existing village building and the proposed group must keep a
      // reachable construction edge from the hub door with the group blocked.
      const blocked = new Set<number>();
      for (const item of placed) if (item.kind !== 'road') for (let dy = 0; dy < item.row.h; dy++) for (let dx = 0; dx < item.row.w; dx++)
        blocked.add((item.row.y + dy) * width + item.row.x + dx);
      const door = constructionEdges(state, camp, true).find(point => !blocked.has(Math.floor(point.y) * width + Math.floor(point.x)));
      const reachable = door && createReachabilityQuery(state, door, village.faction, blocked, true);
      const owned = state.buildings.filter(b => b.villageId === village.id && b.hp > 0 && b.kind !== 'road' && !placed.some(item => item.replace === b));
      const proposed = placed.filter(item => item.kind !== 'road').map(item => ({ ...camp, id: -1, kind: item.kind, x: item.row.x, y: item.row.y }));
      if (!reachable || ![...owned, ...proposed].every(building => constructionEdges(state, building, true).some(reachable)))
        failure = { index: 0, reason: 4 };
    }
    if (!failure && !scenarioStructuresAllowed(state,placed.map(item=>({kind:item.kind,x:item.row.x,y:item.row.y}))))
      failure = {index:0,reason:4};
    if (failure) { failAll(failure.index, failure.reason); continue; }
    const replaced = new Set(placed.filter(item => item.replace).map(item => item.replace!.id));
    if (replaced.size) store.buildings.retain(building => !replaced.has(building.id));
    for (const item of placed) {
      if (item.ford) { results.push({ request: item.row.request, ok: true, building: -1, reason: 0 }); continue; }
      const building = addVillageBuilding(state, village, item.kind, { x: item.row.x, y: item.row.y }, item.row.level || 1);
      for (let dy = 0; dy < item.row.h; dy++) for (let dx = 0; dx < item.row.w; dx++) changed.push((item.row.y + dy) * width + item.row.x + dx);
      results.push({ request: item.row.request, ok: true, building: building.id, reason: 0 });
    }
  }
  if (changed.length) { markWorldChanged(state.world, 'sight', changed); invalidateNavigation(state); changed = []; }
  return results;
}

function openNear(state: GameState, center: Point, faction: number, seed: number): Point | undefined {
  for (let attempt = 0; attempt < 16; attempt++) {
    const angle = (seed * 2.399963 + attempt * 2.399963) % (Math.PI * 2), reach = 1 + (attempt % 4) * .75;
    const point = { x: Math.floor(center.x + Math.cos(angle) * reach) + .5, y: Math.floor(center.y + Math.sin(angle) * reach) + .5 };
    if (unitSpawnTerrainAllowed(state.world, point.x, point.y) && canWalk(state, point.x, point.y, faction, undefined, true) && hasStaticPath(state, center, point, faction, true)
      && !state.units.some(unit => unit.hp > 0 && !unit.inside && Math.floor(unit.x) === Math.floor(point.x) && Math.floor(unit.y) === Math.floor(point.y))) return point;
  }
}
export function addVillager(state: GameState, village: NeutralVillage, point: Point, guard = false, home?: number, attack = guard ? 16 : 8): void {
  const hp = guard ? 80 : 45;
  entityStore(state).units.add({ id: entityStore(state).allocateId(), kind: guard ? 'warrior' : 'worker', faction: village.faction, villageId: village.id,
    ...point, name: guard ? 'Village guard' : 'Villager', hp, maxHp: hp, morale: 100, attack, defense: guard ? 4 : 1,
    speed: guard ? 3.2 : 2.4, range: .9, order: 'wander', cooldown: 0, lastCombat: -60, moving: false, facing: 0,
    attackTime: 0, home: home ?? village.campId, bornAt: state.time });
}
/** Rust decided and paid for these recruits; the host only finds a free tile. */
export function spawnVillageUnits(state: GameState, rows: readonly SpawnRow[]): void {
  for (const row of rows) {
    const village = state.villages?.find(v => v.id === row.village);
    const camp = village && villageCampBuilding(state, village);
    if (!village || !camp || village.destroyed) continue;
    const origin = constructionEdges(state, camp, true).find(point => unitSpawnTerrainAllowed(state.world, point.x, point.y));
    if (!origin) continue;
    const guard = row.role === 2;
    const posts = guard ? state.buildings.filter(b => b.villageId === village.id && b.kind === 'guardPost' && b.hp > 0) : [];
    const post = posts.find(post => state.units.filter(unit => unit.home === post.id && unit.hp > 0).length < 3);
    const spawn = guard ? openNear(state, origin, village.faction, state.units.length) ?? origin : origin;
    addVillager(state, village, spawn, guard, post?.id, row.attack);
  }
}
