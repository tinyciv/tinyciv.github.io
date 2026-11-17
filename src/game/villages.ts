import { playerFaction } from './player-context';
import { simRandom } from './sim-handle';
import { dockPlacement } from './dock';
import { navigableWaterCell } from './water-navigation';
import { spendGold } from './gold-ledger';
import { isForbidden } from './forbidden-zones';
import { entityStore } from './entity-store';
import { markWorldChanged } from './world-revisions';
import { constructionEdges } from './builders';
import { canWalk, hasStaticPath } from './pathfinding';
import { reliefFootprintAllowed, reliefLevel } from './relief';
import { settlementFootprintAllowed, unitSpawnTerrainAllowed } from './terrain-sites';
import { resourceFootprintBlocked } from './resource-terrain';
import { invalidateFog } from './fog';
import { updateTradeRoutes } from './trade';
import { territory } from './borders';
import { territoryValue } from './territory-cells';
import { environmentRandom } from '../world/environment-fields';
import { addVillageBuilding, addVillager } from './village-sites';
import { confederateVillage, settlementHost } from './settlement-transfer';
import { SETTLEMENT_CONSTANTS } from './settlement-constants';
import { ACTION, applyVillageBonuses, chooseVillageLayout, FAMILY_NAMES, REACH, settlementRow, settlements, STAGE_NAMES,
  villageCenter, villageRelationView, villageTrading, villageHostilesView, hostileView } from './settlement-bridge';
import { buildingReady, buildingWidth, buildingHeight, distance, isFord, tileAt, WATER, type Building, type GameState, type NeutralVillage,
  type Point, type ResourceWorkKind, type Unit, type VillageIdentity, type VillageRelation } from './types';

export const VILLAGE_TRADE_COST = SETTLEMENT_CONSTANTS.tradeCost;
export const VILLAGE_ALLIANCE_COST = SETTLEMENT_CONSTANTS.allianceCost;
export const VILLAGE_ALLIANCE_MIN_COST = SETTLEMENT_CONSTANTS.allianceMinCost;
export const VILLAGE_TRADE_MULTIPLIER = .2;
export const VILLAGE_TRADE_BASE_SCALE = .5;
export const VILLAGE_RESOURCE_MULTIPLIER = 4;
export const VILLAGE_REQUIRED_RESOURCES = ['copper', 'iron', 'stone', 'salt', 'olives'] as const;
export const VILLAGE_SIGHT_RADIUS = 20;
export const VILLAGES_PER_FACTION = 1.5;
export const VILLAGE_IDENTITIES: Record<VillageIdentity, { name: string; bonus: string; description: string }> = {
  growers: { name: 'Sabine', bonus: 'Seed keepers', description: '+10% harvest yield across your faction.' },
  merchants: { name: 'Veneti', bonus: 'Market fellowship', description: '+15% trade income across your faction.' },
  builders: { name: 'Liguri', bonus: 'Master builders', description: '+15% construction and repair speed across your faction.' },
  scholars: { name: 'Etruscan', bonus: 'Shared learning', description: '+15% research speed across your faction.' },
};
const IDENTITIES = Object.keys(VILLAGE_IDENTITIES) as VillageIdentity[];
export function villageForBuilding(state: GameState, building: Building): NeutralVillage | undefined {
  return state.villages?.find(village => village.id === building.villageId);
}
/** Independent seeded demand leaves settlement placement and villager RNG
 * unchanged. Explicit demands are stored when villages are created. */
export function villageRequiredResource(state: GameState, village: NeutralVillage): ResourceWorkKind {
  if (village.requiredResource) return village.requiredResource;
  const random = environmentRandom(`${state.world.seed}:village-demand:${village.id}:${village.x}:${village.y}`);
  return VILLAGE_REQUIRED_RESOURCES[Math.floor(random() * VILLAGE_REQUIRED_RESOURCES.length)];
}
export function villageCamp(state: GameState, village: NeutralVillage): Building | undefined {
  const camp = entityStore(state).buildings.get(village.campId);
  return camp && (camp.kind === 'villageTent' || village.secededCity && camp.kind === 'palace') && buildingReady(camp) ? camp : undefined;
}
/** View over Rust relations: a live agreement with a living civilization. */
export function villageTradeActive(state: GameState, village: NeutralVillage, faction = 0): boolean {
  const partner = state.factions.find(candidate => candidate.id === faction);
  return !village.destroyed && !!partner && !partner.defeated && partner.villageId === undefined && partner.relation !== 'confederated'
    && villageTrading(state, village, faction) && !hostileView(state, village.faction, faction) && !!villageCamp(state, village);
}

// --------------------------------------------------------------- founding

function usable(state: GameState, point: Point): boolean {
  const tile = tileAt(state.world, point.x, point.y);
  return !!tile && !WATER.has(tile.terrain) && ['none', 'forest', 'jungle', 'swamp'].includes(tile.overlay)
    && tile.farm === undefined && settlementFootprintAllowed(state.world, point.x, point.y) && canWalk(state, point.x + .5, point.y + .5, -1)
    && !(state.fields ?? []).some(field => field.x === point.x && field.y === point.y)
    && !state.buildings.some(b => b.hp > 0 && point.x >= b.x && point.x < b.x + buildingWidth(b)
      && point.y >= b.y && point.y < b.y + buildingHeight(b));
}
/** Founding patch code (design 8.4): 1 open, 2 water, 4 ford, 8 blocked,
 * 16 clearable vegetation, ridge level in bits 8-11. */
function patchCode(state: GameState, x: number, y: number, borders: ReturnType<typeof territory>): number {
  const tile = tileAt(state.world, x, y);
  if (!tile) return 8;
  let code = (reliefLevel(tile) & 15) << 8;
  if (WATER.has(tile.terrain)) {
    code |= 2;
    if (navigableWaterCell(state.world, x, y)) code |= 32;
  }
  if (isFord(tile)) code |= 4;
  if (['forest', 'jungle', 'swamp'].includes(tile.overlay)) code |= 16;
  const owner = territoryValue(borders, y * state.world.width + x);
  if (resourceFootprintBlocked(state.world, x, y) || !reliefFootprintAllowed(state.world, x, y) || !WATER.has(tile.terrain) && !settlementFootprintAllowed(state.world, x, y) || owner !== undefined && owner >= 0
    || tile.farm !== undefined || state.buildings.some(b => b.hp > 0 && x >= b.x && x < b.x + buildingWidth(b) && y >= b.y && y < b.y + buildingHeight(b))
    || (state.fields ?? []).some(field => field.x === x && field.y === y)) code |= 8;
  else if (!WATER.has(tile.terrain) && usable(state, { x, y })) code |= 1;
  return code;
}

/** Scatter independently from civilizations. Each candidate is fitted to the
 * best layout family and orientation by Rust; tents sit on template cells. */
export function initializeVillages(state: GameState): void {
  if (state.villages !== undefined) return;
  state.villages = [];
  const factions = state.factions.filter(f => f.id >= 0 && f.villageId === undefined && !f.defeated);
  const desired = state.world.scenario === 'sandbox' ? 3 : Math.round(factions.length * VILLAGES_PER_FACTION);
  const palaces = state.buildings.filter(b => b.kind === 'palace' && buildingReady(b));
  const baseSpacing = Math.min(18, Math.min(state.world.width, state.world.height) / 5);
  const stages = [[baseSpacing, baseSpacing], [Math.min(14, baseSpacing), Math.min(14, baseSpacing)], [Math.min(8, baseSpacing), Math.min(10, baseSpacing)]];
  const entrances = palaces.map(palace => ({ faction: palace.faction, doors: constructionEdges(state, palace, true) }));
  const borders = territory(state);
  for (const [palaceSpacing, villageSpacing] of stages) for (let attempt = 0; attempt < desired * 200 && state.villages.length < desired; attempt++) {
    const point = { x: 4 + Math.floor(simRandom(state) * (state.world.width - 8)), y: 4 + Math.floor(simRandom(state) * (state.world.height - 8)) };
    if (palaces.some(p => distance(p, point) < palaceSpacing) || state.villages.some(v => distance(v, point) < villageSpacing)
      || state.buildings.some(b => b.raiderCamp !== undefined && distance(b, point) < 9)
      || state.units.some(unit => unit.hp > 0 && !unit.inside && unit.faction === -2 && distance(unit, point) < 8)) continue;
    if (!usable(state, point)) continue;
    const id = state.villages.length + 1;
    const choice = chooseVillageLayout(state, id, point, (x, y) => patchCode(state, x, y, borders), 0, attempt);
    if (!choice || !settlementFootprintAllowed(state.world, choice.hub.x, choice.hub.y)
      || !settlementFootprintAllowed(state.world, choice.lot.x, choice.lot.y, 2)) continue;
    if (choice.dock && !dockPlacement(state, choice.dock.x, choice.dock.y, -1)) continue;
    const door = [[0, 1], [1, 0], [0, -1], [-1, 0]].map(([dx, dy]) => ({ x: choice.hub.x + .5 + dx, y: choice.hub.y + .5 + dy }))
      .find(door => unitSpawnTerrainAllowed(state.world, door.x, door.y) && canWalk(state, door.x, door.y, -1)
        && !(door.x - .5 >= choice.lot.x && door.x - .5 <= choice.lot.x + 1 && door.y - .5 >= choice.lot.y && door.y - .5 <= choice.lot.y + 1)
        && entrances.some(palace => palace.doors.some(exit => hasStaticPath(state, exit, door, palace.faction, true))));
    if (!door) continue;
    const factionId = Math.max(-1, ...state.factions.map(f => f.id)) + 1;
    const identity = IDENTITIES[Math.floor(simRandom(state) * IDENTITIES.length)];
    const village: NeutralVillage = { id, faction: factionId, campId: -1, name: `${VILLAGE_IDENTITIES[identity].name} ${['Grove', 'Crossing', 'Hearth', 'Hollow', 'Rest'][id % 5]}`,
      identity, x: choice.lot.x, y: choice.lot.y, layout: { family: choice.family, transform: choice.transform, lotX: choice.lot.x, lotY: choice.lot.y } };
    village.requiredResource = villageRequiredResource(state, village);
    state.villages.push(village);
    const population = 2 + Math.floor(simRandom(state) * 4);
    state.factions.push({ id: factionId, villageId: id, name: village.name, color: '#ffffff', relation: 'peace',
      food: 0, gold: 0, production: 0, population, culture: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false });
    // The hub tent is the trade and diplomatic camp; the civic lot stays open.
    const homes = [choice.hub, ...choice.tents].map(tent => addVillageBuilding(state, village, 'villageTent', tent));
    village.campId = homes[0].id;
    homes[0].hp = homes[0].maxHp = 500;
    if (choice.dock && dockPlacement(state, choice.dock.x, choice.dock.y, factionId)
      && hasStaticPath(state, door, { x: choice.dock.x + .5, y: choice.dock.y + .5 }, factionId, true))
      homes.push(addVillageBuilding(state, village, 'dock', choice.dock));
    markWorldChanged(state.world, 'sight', homes.map(home => home.y * state.world.width + home.x));
    for (let i = 0; i < population; i++) addVillager(state, village, openNear(state, door, 3, factionId) ?? door);
  }
}

function openNear(state: GameState, center: Point, radius: number, faction: number, allowed: (point: Point) => boolean = () => true): Point | undefined {
  for (let attempt = 0; attempt < 24; attempt++) {
    const angle = simRandom(state) * Math.PI * 2, reach = 1 + simRandom(state) * radius;
    const point = { x: Math.floor(center.x + Math.cos(angle) * reach) + .5, y: Math.floor(center.y + Math.sin(angle) * reach) + .5 };
    if (allowed(point) && unitSpawnTerrainAllowed(state.world, point.x, point.y) && canWalk(state, point.x, point.y, faction, undefined, true) && hasStaticPath(state, center, point, faction, true)) return point;
  }
}

// --------------------------------------------------------------- diplomacy view

/** `petition` accepts an open petition through the same confederation path (tribute 0). */
export type VillageAction = 'trade' | 'ally' | 'confederate' | 'petition' | 'war';
export interface VillageOption { cost: number; available: boolean; reason: string }
export interface VillageDiplomacyStatus {
  village: NeutralVillage; relation: VillageRelation; trading: boolean; bonusName: string; bonusDescription: string; allianceDiscount: number;
  trade: VillageOption; ally: VillageOption; confederate: VillageOption; war: VillageOption;
  affiliation: number; acceptThreshold: number; independence: number; tribute: number; petition: boolean; stage: number; stageName: string;
  family: string; cooldownUntil: number;
}
const reasonText = (code: number, village: NeutralVillage, cost: number, affiliation: number, needed: number, cooldown: number, now: number): string => [
  '', 'Your realm can no longer negotiate.', 'Your Leader is no longer available.', 'Move your Leader within 3 tiles of the town or main tent.',
  'Trade already established.', 'At war with this village.', 'Already allied.', 'Already at war.', `Need ${Math.ceil(cost)} gold.`,
  `Needs affiliation ${needed}; ${village.name} is at ${Math.round(affiliation)}.`, 'Requires an alliance with this village.',
  `${village.name} is considering. Ask again in ${Math.max(1, Math.ceil(cooldown - now))} seconds.`, 'This village no longer has a camp.',
  'No petition is open.', `${village.name} refuses for now. Ask again in 90 seconds.`, 'Only villages and independent cities can confederate.'][code] ?? 'Unavailable.';

function leaderReach(state: GameState, village: NeutralVillage, viewer: number, remote: boolean): number {
  const player = state.factions.find(f => f.id === viewer), camp = villageCamp(state, village);
  const leader = state.units.find(u => u.kind === 'leader' && u.faction === viewer && u.hp > 0 && !u.inside);
  const near = !!leader && !!camp && Math.hypot(Math.max(camp.x - leader.x, 0, leader.x - camp.x - buildingWidth(camp)), Math.max(camp.y - leader.y, 0, leader.y - camp.y - buildingHeight(camp))) <= 3;
  return (state.gameOver || !player || player.defeated ? 0 : REACH.realm) | (leader ? REACH.leader : 0) | (near ? REACH.near : 0) | (remote ? REACH.remote : 0);
}
export function villageDiplomacyStatus(state: GameState, building: Building, remoteNegotiation = false, viewer = playerFaction(state)): VillageDiplomacyStatus | undefined {
  const village = villageForBuilding(state, building) ?? state.villages?.find(v => v.campId === building.id);
  if (!village || village.destroyed || !villageCamp(state, village)) return;
  const gold = state.factions.find(f => f.id === viewer)?.gold ?? 0;
  const s = settlements(state).villageStatus(village, viewer, gold, leaderReach(state, village, viewer, remoteNegotiation));
  const option = (index: number, needed = 0): VillageOption => ({ available: s[index * 3] === 1, cost: s[index * 3 + 2],
    reason: reasonText(s[index * 3 + 1], village, s[index * 3 + 2], s[13], needed, s[16], state.time) });
  const identity = VILLAGE_IDENTITIES[village.identity], row = settlementRow(state, village.campId);
  return { village, relation: (['neutral', 'trade', 'allied', 'war'] as const)[s[14]] ?? 'neutral', trading: s[15] === 1,
    bonusName: identity.bonus, bonusDescription: identity.description, allianceDiscount: VILLAGE_ALLIANCE_COST - s[5],
    trade: option(0, 15), ally: option(1, 45), confederate: option(2), war: option(3),
    acceptThreshold: s[12], affiliation: s[13], cooldownUntil: s[16], tribute: s[17], independence: s[18], petition: s[19] === 1, stage: s[20],
    stageName: STAGE_NAMES[s[20]] ?? 'camp', family: FAMILY_NAMES[row?.family ?? village.layout?.family ?? 0] ?? '' };
}

/** Rust decides; the host charges, executes transfers and refreshes views.
 * Remote negotiations are revalidated by diplomacyAction first. */
export function performVillageAction(state: GameState, building: Building, action: VillageAction, remoteNegotiation = false, viewer = playerFaction(state)): { ok: boolean; message: string } {
  const village = villageForBuilding(state, building) ?? state.villages?.find(v => v.campId === building.id);
  if (!village || village.destroyed || !villageCamp(state, village)) return { ok: false, message: 'This village no longer has a camp.' };
  const faction = state.factions.find(f => f.id === viewer);
  const gold = faction?.gold ?? 0, reach = leaderReach(state, village, viewer, remoteNegotiation);
  const status = settlements(state).villageStatus(village, viewer, gold, reach);
  const result = settlements(state).villageCommand(village, viewer, ACTION[action], gold, reach);
  if (result[3] === 3 || !result[0]) {
    const needed = action === 'trade' ? 15 : action === 'ally' ? 45 : 0;
    return { ok: false, message: reasonText(result[1], village, result[2], status[13], needed, status[16], state.time) };
  }
  if (result[3] === 2) {
    if (!confederateVillage(state, village, viewer, settlementHost())) return { ok: false, message: 'The village green is blocked.' };
    if (faction && result[2] > 0) spendGold(state, faction, result[2], 'diplomacy');
    return { ok: true, message: `${village.name} joins your realm as a city. ${VILLAGE_IDENTITIES[village.identity].description}` };
  }
  if (faction && result[2] > 0) spendGold(state, faction, result[2], 'diplomacy');
  applyVillageBonuses(state); invalidateFog(state);
  // Force trade reconciliation even when the simulation is paused.
  markWorldChanged(state.world);
  updateTradeRoutes(state);
  const message = action === 'war' ? `War declared on ${village.name}.`
    : action === 'trade' ? `Trade established with ${village.name}.`
      : `${village.name} joins your allies. ${VILLAGE_IDENTITIES[village.identity].description}`;
  return { ok: true, message };
}
export const villageRelation = (state: GameState, village: NeutralVillage, faction: number): VillageRelation => villageRelationView(state, village, faction);

// --------------------------------------------------------------- unit behavior

interface VillageOrders {
  hostile: (a: number, b: number) => boolean;
  visible: (observer: Unit, target: Unit) => boolean;
  move: (state: GameState, unit: Unit, goal: Point, dt: number) => void;
  engage: (unit: Unit, target: Unit, dt: number) => void;
}
/** Camp defenders respond locally; resting villagers hold a destination for
 * several seconds rather than constantly picking new positions. Nearby
 * hostiles come from the Rust 1 Hz census sample, never an all-unit filter. */
export function updateVillageUnit(state: GameState, unit: Unit, dt: number, orders: VillageOrders): void {
  const village = state.villages?.find(v => v.id === unit.villageId);
  if (!village) return;
  const center = villageCenter(village);
  const valid = (enemy: Unit | undefined): enemy is Unit => !!enemy && enemy.hp > 0 && !enemy.inside
    && distance(enemy, center) <= 10 && distance(unit, enemy) <= 7 && !isForbidden(state, enemy.x, enemy.y, unit.faction) && orders.hostile(unit.faction, enemy.faction);
  const store = entityStore(state);
  let enemy = unit.villageThreatId === undefined ? undefined : store.units.get(unit.villageThreatId);
  if (!valid(enemy)) enemy = undefined;
  if (state.time >= (unit.villageNextThinkAt ?? 0)) {
    unit.villageNextThinkAt = state.time + .5 + unit.id % 5 * .02;
    let bestDistance = Infinity;
    enemy = undefined;
    if (!village.destroyed) for (const id of villageHostilesView(state, village)) {
      const candidate = store.units.get(id);
      if (!candidate) continue;
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
  unit.villageNextWanderAt = state.time + 8 + simRandom(state) * 12;
  const reach = village.layout ? 8 : 6;
  if (distance(unit, center) <= reach) {
    unit.destination = openNear(state, unit, 3, unit.faction, point => distance(point, center) <= reach);
  } else {
    const camp = villageCamp(state, village) ?? { ...village, kind: 'villageTent' as const, hp: 1, maxHp: 1, capacity: 0 };
    unit.destination = constructionEdges(state, camp, true).sort((a, b) => distance(unit, a) - distance(unit, b))
      .find(point => hasStaticPath(state, unit, point, unit.faction, true));
  }
}
