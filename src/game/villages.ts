import { spendGold } from './gold-ledger';
import { grantIncome } from './resource-income';
import { isForbidden } from './forbidden-zones';
import { buildingWorkForbidden } from './forbidden-work';
import { entityStore } from './entity-store';
import { markWorldChanged } from './world-revisions';
import { constructionEdges } from './builders';
import { canWalk, createReachabilityQuery, hasStaticPath, invalidateNavigation } from './pathfinding';
import { ridgeFootprintAllowed } from './ridges';
import { invalidateFog } from './fog';
import { updateTradeRoutes } from './trade';
import { houseCapacity, houseLevel } from './wells';
import { buildingReady, buildingWidth, buildingHeight, distance, tileAt, WATER, type Building, type BuildingKind, type GameState, type NeutralVillage, type Point, type Unit, type VillageIdentity } from './types';

export const VILLAGE_TRADE_COST = 250;
export const VILLAGE_ALLIANCE_COST = 3000;
export const VILLAGE_ALLIANCE_MIN_COST = 500;
export const VILLAGE_TRADE_MULTIPLIER = .2;
export const VILLAGE_SIGHT_RADIUS = 20;
export const VILLAGES_PER_FACTION = 1.5;
export const VILLAGE_IDENTITIES: Record<VillageIdentity, { name: string; bonus: string; description: string }> = {
  growers: { name: 'Sabine', bonus: 'Seed keepers', description: '+10% harvest yield across your faction.' },
  merchants: { name: 'Veneti', bonus: 'Market fellowship', description: '+15% trade income across your faction.' },
  builders: { name: 'Liguri', bonus: 'Master builders', description: '+15% construction and repair speed across your faction.' },
  scholars: { name: 'Etruscan', bonus: 'Shared learning', description: '+15% research speed across your faction.' },
};
const IDENTITIES = Object.keys(VILLAGE_IDENTITIES) as VillageIdentity[];
const GROWTH: ('house' | 'guardPost' | 'woodenTower')[] = ['house', 'house', 'guardPost', 'house', 'house', 'woodenTower', 'house', 'house',
  'woodenTower', 'house', 'guardPost', 'house', 'woodenTower', 'house', 'house', 'woodenTower'];
export const VILLAGE_DEVELOPMENT_COSTS = { house: 40, guardPost: 120, woodenTower: 100, guard: 40, housing2: 50, housing3: 100 } as const;
export const VILLAGE_MAX_GUARDS = 12;
const nextId = (state: GameState): number => Math.max(0, ...state.buildings.map(b => b.id), ...state.units.map(u => u.id)) + 1;
function random(state: GameState): number {
  let n = state.rngState += 0x6D2B79F5;
  n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61);
  state.rngState >>>= 0; return ((n ^ n >>> 14) >>> 0) / 4294967296;
}
export function villageForBuilding(state: GameState, building: Building): NeutralVillage | undefined {
  return state.villages?.find(village => village.id === building.villageId);
}
export function villageCamp(state: GameState, village: NeutralVillage): Building | undefined {
  const camp = entityStore(state).buildings.get(village.campId);
  return camp?.kind === 'villageTent' && buildingReady(camp) ? camp : undefined;
}
export function villageTradeActive(state: GameState, village: NeutralVillage, faction = 0): boolean {
  const partner = state.factions.find(candidate => candidate.id === faction);
  return !village.destroyed && (faction === 0 ? !!village.trading : !!village.tradingFactions?.includes(faction))
    && !!partner && !partner.defeated && partner.villageId === undefined && partner.relation !== 'confederated'
    && !villageHostility(state, village.faction, faction) && !!villageCamp(state, village);
}
export function villageAllianceCost(village: Pick<NeutralVillage, 'tradeGoldByFaction'>, faction = 0): number {
  const traded = Math.max(0, village.tradeGoldByFaction?.[faction] ?? 0);
  return Math.max(VILLAGE_ALLIANCE_MIN_COST, VILLAGE_ALLIANCE_COST - Math.round(traded / 50) * 5);
}
/** Both partners earn the delivered leg's revenue. Agreement fees, unfinished
 * journeys and combat bounties never count toward the lifetime trade discount. */
export function recordVillageTrade(state: GameState, village: NeutralVillage, faction: number, gold: number): void {
  if (!Number.isFinite(gold) || gold < 1 || !villageTradeActive(state, village, faction)) return;
  const treasury = state.factions.find(candidate => candidate.id === village.faction);
  if (!treasury) return;
  const earned = Math.floor(gold), ledger = village.tradeGoldByFaction ??= {};
  grantIncome(treasury, { gold: earned }, state, 'trade');
  ledger[faction] = (ledger[faction] ?? 0) + earned;
}

/** Village diplomacy is independent of civilization diplomacy and victory. */
export function villageHostility(state: GameState, a: number, b: number): boolean | undefined {
  const village = state.villages?.find(v => v.faction === a || v.faction === b);
  if (!village) return undefined;
  const other = village.faction === a ? b : a;
  if (other === village.faction) return false;
  // Independent villages stay out of raids. An alliance brings the camp into
  // the player's wars, allowing its defenders to fight approaching raiders.
  if (other === -2) return village.relation === 'allied';
  if (other < 0) return false;
  const otherVillage = state.villages?.find(v => v.faction === other);
  if (otherVillage) return village.relation === 'allied' && otherVillage.relation === 'war'
    || village.relation === 'war' && otherVillage.relation === 'allied';
  if (other === 0) return village.relation === 'war';
  return village.relation === 'allied' && state.factions.find(f => f.id === other)?.relation === 'war';
}

export function villageDiplomacyStatus(state: GameState, building: Building, remoteNegotiation = false) {
  const village = villageForBuilding(state, building), player = state.factions.find(f => f.id === 0);
  if (!village || village.destroyed || !villageCamp(state, village)) return;
  const leader = state.units.find(u => u.kind === 'leader' && u.faction === 0 && u.hp > 0 && !u.inside);
  const camp = villageCamp(state, village)!;
  const reach = leader && Math.hypot(Math.max(camp.x - leader.x, 0, leader.x - camp.x - 1), Math.max(camp.y - leader.y, 0, leader.y - camp.y - 1)) <= 3;
  const common = state.gameOver || !player || player.defeated ? 'Your realm can no longer negotiate.'
    : !leader ? 'Your Leader is no longer available.' : '';
  const option = (cost: number, unavailable: string) => {
    const reason = common || (!reach && !remoteNegotiation ? 'Move your Leader within 3 tiles of the main tent.' : '')
      || unavailable || (player!.gold < cost ? `Need ${cost} gold.` : '');
    return { cost, available: !reason, reason };
  };
  const identity = VILLAGE_IDENTITIES[village.identity];
  const allianceCost = villageAllianceCost(village);
  return { village, relation: village.relation, bonusName: identity.bonus, bonusDescription: identity.description,
    tradedGold: village.tradeGoldByFaction?.[0] ?? 0, allianceDiscount: VILLAGE_ALLIANCE_COST - allianceCost,
    trade: option(VILLAGE_TRADE_COST, village.trading ? 'Trade already established.' : village.relation === 'war' ? 'At war with this village.' : ''),
    ally: option(allianceCost, village.relation === 'allied' ? 'Already allied.' : village.relation === 'war' ? 'At war with this village.' : ''),
    war: option(0, village.relation === 'war' ? 'Already at war.' : '') };
}
/** Remote negotiations are reached through diplomacyAction, which revalidates
 * the visible village building and living Leader before any purchase. */
export function performVillageAction(state: GameState, building: Building, action: 'trade' | 'ally' | 'war', remoteNegotiation = false): { ok: boolean; message: string } {
  const status = villageDiplomacyStatus(state, building, remoteNegotiation);
  if (!status) return { ok: false, message: 'This village no longer has a camp.' };
  const option = status[action];
  if (!option.available) return { ok: false, message: option.reason };
  spendGold(state, state.factions.find(f => f.id === 0)!, option.cost, 'diplomacy');
  if (action === 'trade') {
    status.village.trading = true;
    if (status.village.relation !== 'allied') status.village.relation = 'trade';
  } else {
    status.village.relation = action === 'ally' ? 'allied' : 'war';
    if (action === 'war') status.village.trading = false;
  }
  const faction = state.factions.find(f => f.id === status.village.faction)!;
  faction.relation = action === 'war' ? 'war' : 'peace';
  refreshVillageBonuses(state); invalidateFog(state);
  // Force trade reconciliation even when the simulation is paused.
  markWorldChanged(state.world);
  updateTradeRoutes(state);
  const message = action === 'war' ? `War declared on ${status.village.name}.`
    : action === 'trade' ? `Trade established with ${status.village.name}.`
      : `${status.village.name} joins your allies. ${status.bonusDescription}`;
  return { ok: true, message };
}

/** Same-identity alliances do not stack, keeping a cluster of villages bounded. */
export function refreshVillageBonuses(state: GameState): void {
  const player = state.factions.find(f => f.id === 0);
  if (!player) return;
  const active = new Set((state.villages ?? []).filter(v => !v.destroyed && v.relation === 'allied' && villageCamp(state, v)).map(v => v.identity));
  player.villageBonuses = { food: active.has('growers') ? .1 : 0, trade: active.has('merchants') ? .15 : 0,
    construction: active.has('builders') ? .15 : 0, research: active.has('scholars') ? .15 : 0 };
}

function usable(state: GameState, point: Point): boolean {
  const tile = tileAt(state.world, point.x, point.y);
  return !!tile && !WATER.has(tile.terrain) && ['none', 'forest', 'jungle', 'swamp'].includes(tile.overlay)
    && tile.farm === undefined && ridgeFootprintAllowed(state.world, point.x, point.y) && canWalk(state, point.x + .5, point.y + .5, -1)
    && !(state.fields ?? []).some(field => field.x === point.x && field.y === point.y)
    && !state.units.some(unit => unit.hp > 0 && !unit.inside && Math.floor(unit.x) === point.x && Math.floor(unit.y) === point.y)
    && !state.buildings.some(b => b.hp > 0 && point.x >= b.x && point.x < b.x + buildingWidth(b)
      && point.y >= b.y && point.y < b.y + buildingHeight(b));
}
function addBuilding(state: GameState, village: NeutralVillage, kind: BuildingKind, point: Point): Building {
  const hp = kind === 'woodenTower' ? 600 : kind === 'guardPost' ? 400 : 160;
  const building: Building = { id: nextId(state), kind, faction: village.faction, villageId: village.id, ...point,
    hp, maxHp: hp, capacity: 0, residents: 0, armor: kind === 'woodenTower' ? 6 : 0 };
  if (kind === 'house') { building.houseLevel = 1; building.houseStyle = 'shack'; building.capacity = houseCapacity(building); }
  const tile = tileAt(state.world, point.x, point.y)!;
  tile.overlay = 'none'; delete tile.palm;
  entityStore(state).buildings.add(building);
  markWorldChanged(state.world, 'sight'); invalidateNavigation(state);
  return building;
}
function addVillager(state: GameState, village: NeutralVillage, point: Point, guard = false, post?: number): void {
  const hp = guard ? 80 : 45;
  entityStore(state).units.add({ id: nextId(state), kind: guard ? 'warrior' : 'worker', faction: village.faction, villageId: village.id,
    ...point, name: guard ? 'Village guard' : 'Villager', hp, maxHp: hp, morale: 100, attack: guard ? 16 : 8, defense: guard ? 4 : 1,
    speed: guard ? 3.2 : 2.4, range: .9, order: 'wander', cooldown: 0, lastCombat: -60, moving: false, facing: 0,
    attackTime: 0, home: post ?? village.campId, bornAt: state.time });
}
function openNear(state: GameState, center: Point, radius: number, faction: number, allowed: (point: Point) => boolean = () => true): Point | undefined {
  for (let attempt = 0; attempt < 24; attempt++) {
    const angle = random(state) * Math.PI * 2, reach = 1 + random(state) * radius;
    const point = { x: Math.floor(center.x + Math.cos(angle) * reach) + .5, y: Math.floor(center.y + Math.sin(angle) * reach) + .5 };
    if (allowed(point) && canWalk(state, point.x, point.y, faction, undefined, true) && hasStaticPath(state, center, point, faction, true)) return point;
  }
}

/** Compact groups share edges internally, with a walking lane between groups.
 * Validate access with the entire proposed group blocked, so a pair of houses
 * cannot seal the camp or cut off an existing village building. */
function developmentSites(state: GameState, village: NeutralVillage, camp: Building, owned: Building[], origin: Point,
  kind: 'house' | 'guardPost' | 'woodenTower', count: number): Point[] | undefined {
  const shapes = count === 1 ? [[[0, 0]]] : count === 2 ? [[[0, 0], [1, 0]]]
    : [[[0, 0], [1, 0], [2, 0]], [[0, 0], [1, 0], [0, 1]]];
  const turn = Math.floor(random(state) * 4), firstShape = Math.floor(random(state) * shapes.length);
  const anchors: Point[] = [];
  for (let y = village.y - 6; y <= village.y + 6; y++) for (let x = village.x - 6; x <= village.x + 6; x++)
    if (Math.hypot(x - camp.x, y - camp.y) >= 2) anchors.push({ x, y });
  anchors.sort((a, b) => distance(village, a) - distance(village, b) || a.y - b.y || a.x - b.x);
  for (const anchor of anchors) for (let shapeIndex = 0; shapeIndex < shapes.length; shapeIndex++) for (let rotation = 0; rotation < 4; rotation++) {
    const sites = shapes[(firstShape + shapeIndex) % shapes.length].map(([x, y]) => {
      for (let r = 0; r < (turn + rotation) % 4; r++) [x, y] = [-y, x];
      return { x: anchor.x + x, y: anchor.y + y };
    });
    if (!sites.every(point => distance(point, village) <= 6 && !isForbidden(state, point.x, point.y, village.faction) && usable(state, point)
      && owned.every(b => Math.max(Math.abs(point.x - b.x), Math.abs(point.y - b.y)) >= 2))) continue;
    const blocked = new Set(sites.map(point => point.y * state.world.width + point.x));
    const reachable = createReachabilityQuery(state, origin, village.faction, blocked, true);
    const buildings = [...owned, ...sites.map(point => ({ ...camp, ...point, kind }))];
    if (buildings.every(building => constructionEdges(state, building, true).some(reachable))) return sites;
  }
}

function developVillage(state: GameState, village: NeutralVillage, camp: Building, owned: Building[], origin: Point): void {
  const faction = state.factions.find(f => f.id === village.faction);
  if (!faction) return;
  const houses = owned.filter(b => b.kind === 'house'), targetLevel = houses.length >= 8 ? 3 : houses.length >= 4 ? 2 : 1;
  const home = houses.filter(house => houseLevel(house) < targetLevel && !buildingWorkForbidden(state, house)).sort((a, b) => houseLevel(a) - houseLevel(b) || a.id - b.id)[0];
  if (home) {
    const level = houseLevel(home) + 1, cost = level === 2 ? VILLAGE_DEVELOPMENT_COSTS.housing2 : VILLAGE_DEVELOPMENT_COSTS.housing3;
    if (faction.gold >= cost) {
      spendGold(state, faction, cost, 'upgrades'); home.houseLevel = level; home.houseStyle = level === 2 ? 'hovel' : 'cottage';
      home.capacity = houseCapacity(home); home.maxHp += 40; home.hp += 40; delete home.houseDowngradeAt;
      return;
    }
  }
  const kind = GROWTH.find((kind, index) => owned.filter(b => b.kind === kind).length <= GROWTH.slice(0, index).filter(k => k === kind).length);
  if (!kind) return;
  const cost = VILLAGE_DEVELOPMENT_COSTS[kind];
  if (faction.gold < cost) return;
  const desired = kind === 'house' ? Math.min(10 - houses.length, Math.floor(faction.gold / cost), 1 + Math.floor(random(state) * 3)) : 1;
  for (let count = desired; count >= 1; count--) {
    const sites = developmentSites(state, village, camp, owned, origin, kind, count);
    if (!sites) continue;
    spendGold(state, faction, cost * sites.length, 'construction');
    for (const point of sites) addBuilding(state, village, kind, point);
    return;
  }
}

/** Scatter independently from civilizations, with a small reserved clearing. */
export function initializeVillages(state: GameState): void {
  if (state.villages !== undefined) return;
  state.villages = [];
  const factions = state.factions.filter(f => f.id >= 0 && f.villageId === undefined && !f.defeated);
  const desired = Math.round(factions.length * VILLAGES_PER_FACTION);
  const palaces = state.buildings.filter(b => b.kind === 'palace' && buildingReady(b));
  const baseSpacing = Math.min(18, Math.min(state.world.width, state.world.height) / 5);
  const stages = [[baseSpacing, baseSpacing], [Math.min(14, baseSpacing), Math.min(14, baseSpacing)], [Math.min(8, baseSpacing), Math.min(10, baseSpacing)]];
  const entrances = palaces.map(palace => ({ faction: palace.faction, doors: constructionEdges(state, palace, true) }));
  // Prefer generous wilderness spacing, then use smaller clearings between
  // cities. A congested fractal coast should not silently lose most villages.
  for (const [palaceSpacing, villageSpacing] of stages) for (let attempt = 0; attempt < desired * 200 && state.villages.length < desired; attempt++) {
    const point = { x: 4 + Math.floor(random(state) * (state.world.width - 8)), y: 4 + Math.floor(random(state) * (state.world.height - 8)) };
    if (palaces.some(p => distance(p, point) < palaceSpacing) || state.villages.some(v => distance(v, point) < villageSpacing)
      || state.buildings.some(b => b.raiderCamp !== undefined && distance(b, point) < 9)
      || state.units.some(unit => unit.hp > 0 && !unit.inside && unit.faction === -2 && distance(unit, point) < 8)) continue;
    if (!usable(state, point)) continue;
    const turn = Math.floor(random(state) * 4);
    let tents: Point[] | undefined;
    for (let rotation = 0; rotation < 4; rotation++) {
      const candidate = [[-2, -1], [2, -1], [0, 2]].map(([dx, dy]) => {
        for (let i = 0; i < (turn + rotation) % 4; i++) [dx, dy] = [-dy, dx];
        return { x: point.x + dx, y: point.y + dy };
      });
      if (candidate.every(p => usable(state, p))) { tents = candidate; break; }
    }
    if (!tents) continue;
    const door = [[0, 1], [1, 0], [0, -1], [-1, 0]].map(([dx, dy]) => ({ x: point.x + .5 + dx, y: point.y + .5 + dy }))
      .find(door => canWalk(state, door.x, door.y, -1)
        && entrances.some(palace => palace.doors.some(exit => hasStaticPath(state, exit, door, palace.faction, true))));
    if (!door) continue;
    const id = state.villages.length + 1, factionId = Math.max(-1, ...state.factions.map(f => f.id)) + 1;
    const identity = IDENTITIES[Math.floor(random(state) * IDENTITIES.length)];
    const village: NeutralVillage = { id, faction: factionId, campId: -1, name: `${VILLAGE_IDENTITIES[identity].name} ${['Grove', 'Crossing', 'Hearth', 'Hollow', 'Rest'][id % 5]}`,
      identity, relation: 'neutral', ...point, nextGrowthAt: state.time + 90 + random(state) * 30, nextThinkAt: state.time, nextRecruitAt: state.time + 90 };
    state.villages.push(village);
    const population = 2 + Math.floor(random(state) * 4);
    state.factions.push({ id: factionId, villageId: id, name: village.name, color: '#ffffff', affinity: 50, relation: 'peace',
      food: 0, gold: 0, production: 0, population, culture: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false });
    // One of the three existing tents is the village's trade and diplomatic
    // hub. The central clearing remains ordinary, walkable ground.
    const homes = tents.map(tent => addBuilding(state, village, 'villageTent', tent));
    village.campId = homes[0].id;
    homes[0].hp = homes[0].maxHp = 500;
    for (let i = 0; i < population; i++) addVillager(state, village, openNear(state, door, 3, factionId) ?? door);
  }
}

export function updateVillages(state: GameState): void {
  let bonusesChanged = false;
  for (const village of state.villages ?? []) {
    const camp = villageCamp(state, village);
    if (!camp) {
      if (!village.destroyed) { village.destroyed = true; bonusesChanged = true; }
      continue;
    }
    if (village.destroyed) continue;
    if (state.time < village.nextThinkAt) continue;
    village.nextThinkAt = state.time + .5;
    const owned = state.buildings.filter(b => b.villageId === village.id && b.hp > 0);
    const origin = buildingWorkForbidden(state, camp) ? undefined : constructionEdges(state, camp, true)[0];
    if (state.time >= village.nextGrowthAt) {
      village.nextGrowthAt = state.time + 90;
      if (origin) developVillage(state, village, camp, owned, origin);
    }
    if (state.time >= village.nextRecruitAt) {
      village.nextRecruitAt = state.time + 90;
      const living = state.units.filter(u => u.villageId === village.id && u.hp > 0);
      const houses = owned.filter(b => b.kind === 'house'), posts = owned.filter(b => b.kind === 'guardPost');
      const capacity = Math.min(20, 5 + houses.reduce((sum, house) => sum + houseLevel(house), 0));
      if (origin) {
        if (living.filter(u => u.kind === 'worker').length < capacity) addVillager(state, village, origin);
        const faction = state.factions.find(f => f.id === village.faction), guards = living.filter(u => u.kind === 'warrior');
        const guardCapacity = Math.min(VILLAGE_MAX_GUARDS, 2 + Math.floor(houses.length / 2) + posts.length * 3);
        if (faction && faction.gold >= VILLAGE_DEVELOPMENT_COSTS.guard && guards.length < guardCapacity) {
          const spawn = openNear(state, origin, 3, village.faction, point => !living.some(unit => !unit.inside
            && Math.floor(unit.x) === Math.floor(point.x) && Math.floor(unit.y) === Math.floor(point.y)));
          if (spawn) {
            const post = posts.find(post => guards.filter(guard => guard.home === post.id).length < 3);
            spendGold(state, faction, VILLAGE_DEVELOPMENT_COSTS.guard, 'army');
            addVillager(state, village, spawn, true, post?.id);
          }
        }
      }
    }
    const faction = state.factions.find(f => f.id === village.faction);
    if (faction) faction.population = state.units.filter(u => u.villageId === village.id && u.hp > 0 && u.kind === 'worker').length;
  }
  if (bonusesChanged) { refreshVillageBonuses(state); invalidateFog(state); updateTradeRoutes(state); }
}

interface VillageOrders {
  hostile: (a: number, b: number) => boolean;
  visible: (observer: Unit, target: Unit) => boolean;
  move: (state: GameState, unit: Unit, goal: Point, dt: number) => void;
  engage: (unit: Unit, target: Unit, dt: number) => void;
}
interface VillageThreatCache { until: number; revision: number; units: readonly Unit[]; count: number; threats: Unit[]; }
const villageThreats = new WeakMap<NeutralVillage, VillageThreatCache>();
function nearbyThreats(state: GameState, village: NeutralVillage, orders: VillageOrders): readonly Unit[] {
  const cached = villageThreats.get(village), revision = state.world.revision ?? 0;
  if (cached && cached.until > state.time && cached.until <= state.time + .5 + 1e-9)
    return cached.threats;
  // A two-tile buffer catches incoming enemies between half-second scans.
  const threats = state.units.filter(u => u.hp > 0 && !u.inside && distance(u, village) <= 12 && orders.hostile(village.faction, u.faction));
  villageThreats.set(village, { until: state.time + .5, revision, units: state.units, count: state.units.length, threats });
  return threats;
}
/** Camp defenders respond locally; resting villagers hold a destination for
 * several seconds rather than constantly picking new positions. */
export function updateVillageUnit(state: GameState, unit: Unit, dt: number, orders: VillageOrders): void {
  const village = state.villages?.find(v => v.id === unit.villageId);
  if (!village) return;
  const valid = (enemy: Unit | undefined): enemy is Unit => !!enemy && enemy.hp > 0 && !enemy.inside
    && distance(enemy, village) <= 10 && distance(unit, enemy) <= 7 && !isForbidden(state, enemy.x, enemy.y, unit.faction) && orders.hostile(unit.faction, enemy.faction);
  let enemy = unit.villageThreatId === undefined ? undefined : entityStore(state).units.get(unit.villageThreatId);
  if (!valid(enemy)) enemy = undefined;
  if (state.time >= (unit.villageNextThinkAt ?? 0)) {
    unit.villageNextThinkAt = state.time + .5 + unit.id % 5 * .02;
    let bestDistance = Infinity;
    enemy = undefined;
    if (!village.destroyed) for (const candidate of nearbyThreats(state, village, orders)) {
      const d = distance(unit, candidate);
      if (d > bestDistance || !valid(candidate) || !orders.visible(unit, candidate)) continue;
      if (d < bestDistance || candidate.id < (enemy?.id ?? Infinity)) { enemy = candidate; bestDistance = d; }
    }
    unit.villageThreatId = enemy?.id;
  }
  if (enemy && !village.destroyed) { unit.target = enemy.id; orders.engage(unit, enemy, dt); return; }
  unit.target = undefined;
  if (unit.destination && isForbidden(state, unit.destination.x, unit.destination.y, unit.faction)) {
    unit.destination = undefined; unit.path = undefined; unit.pathGoal = undefined; unit.villageNextWanderAt = 0;
  }
  if (unit.destination && distance(unit, unit.destination) > .25 && state.time < (unit.villageNextWanderAt ?? 0)) {
    orders.move(state, unit, unit.destination, dt); return;
  }
  // A blocked route expires rather than issuing the same path forever.
  unit.destination = undefined;
  if (state.time < (unit.villageNextWanderAt ?? 0)) return;
  unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0;
  unit.villageNextWanderAt = state.time + 8 + random(state) * 12;
  if (distance(unit, village) <= 6) {
    unit.destination = openNear(state, unit, 3, unit.faction, point => distance(point, village) <= 6);
  } else {
    const camp = villageCamp(state, village) ?? { ...village, kind: 'villageTent' as const, hp: 1, maxHp: 1, capacity: 0 };
    unit.destination = constructionEdges(state, camp, true).sort((a, b) => distance(unit, a) - distance(unit, b))
      .find(point => hasStaticPath(state, unit, point, unit.faction, true));
  }
}
