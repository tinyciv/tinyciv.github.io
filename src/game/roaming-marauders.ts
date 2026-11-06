import { entityStore } from './entity-store';
import { banditIntensity, banditPopulationCap } from './bandit-intensity';
import { seededRandom } from '../world/generator';
import { MAX_LIVE_RAIDERS, RAIDER_COLOR, RAIDER_FACTION, raiderCampActive, raiderCampPopulationCap, raiderCampRefuge } from './raider-camps';
import { initializeRaiderSkirmishes, RAIDER_CAMP_RESERVES } from './raider-activity';
import { ensureMarauderLeaders } from './marauder-leaders';
import { marauderBaseStats } from './raider-pressure';
import { buildingReady, type GameState, type Unit } from './types';

export const ROAMING_MARAUDERS_VERSION = 1;

/** Opening attacks and dormant reserve bands share one bounded population.
 * Reserves occupy real camp tents; they do not patrol the wilderness. */
export function roamingPackTarget(state: GameState): number {
  return banditPopulationCap(state, Math.min(12, Math.max(1, state.factions.filter(faction => faction.id >= 0 && faction.villageId === undefined).length) * 2,
    Math.max(1, Math.floor(state.world.width * state.world.height / 250))));
}

export function initializeRoamingMarauders(state: GameState): void {
  if ((state.roamingMaraudersVersion ?? 0) >= ROAMING_MARAUDERS_VERSION) { ensureMarauderLeaders(state); return; }
  state.roamingMaraudersVersion = ROAMING_MARAUDERS_VERSION;
  initializeRaiderSkirmishes(state);
  if (!banditIntensity(state)) return;
  const camps = (state.raiderCamps ?? []).filter(camp => raiderCampActive(state, camp))
    .map(camp => ({ camp, tents: camp.houses.map(id => state.buildings.find(building => building.id === id))
      .filter(building => !!building && building.faction === RAIDER_FACTION && buildingReady(building)) }));
  if (!camps.some(candidate => candidate.tents.length)) return;
  const rng = seededRandom(`${state.world.seed}:camp-reserves:${ROAMING_MARAUDERS_VERSION}`);
  const units = entityStore(state).units;
  const livePacks = new Set(state.units.filter(unit => unit.hp > 0 && unit.marauderPack !== undefined).map(unit => unit.marauderPack));
  const wanted = Math.max(0, roamingPackTarget(state) - livePacks.size);
  let available = Math.max(0, banditPopulationCap(state, MAX_LIVE_RAIDERS) - state.units.filter(unit => unit.faction === RAIDER_FACTION && unit.hp > 0).length);
  let nextId = Math.max(0, ...state.units.map(unit => unit.id), ...state.buildings.map(building => building.id));
  let packId = Math.max(0, ...(state.marauderPacks ?? []).map(pack => pack.id));
  for (let band = 0; band < wanted && available >= 2; band++) {
    const counts = new Map<number, number>();
    const belonging = new Map((state.marauderPacks ?? []).map(pack => [pack.id, pack.raiderCamp]));
    for (const unit of state.units) if (unit.hp > 0 && unit.faction === RAIDER_FACTION) {
      const camp = belonging.get(unit.marauderPack ?? -1);
      if (camp !== undefined) counts.set(camp, (counts.get(camp) ?? 0) + 1);
    }
    const candidate = camps.filter(({ camp, tents }) => tents.length && (counts.get(camp.id) ?? 0) + 2
      <= Math.min(RAIDER_CAMP_RESERVES, raiderCampPopulationCap(state, camp)))
      .sort((a, b) => (counts.get(a.camp.id) ?? 0) - (counts.get(b.camp.id) ?? 0) || a.camp.id - b.camp.id)[0];
    if (!candidate) break;
    const { camp, tents } = candidate;
    const size = Math.min(available, 2 + Math.floor(rng() * 5),
      Math.min(RAIDER_CAMP_RESERVES, raiderCampPopulationCap(state, camp)) - (counts.get(camp.id) ?? 0));
    const id = ++packId, home = raiderCampRefuge(camp), name = `${camp.name} reserves`;
    (state.marauderPacks ??= []).push({ id, name, color: RAIDER_COLOR, targetFaction: 0, home, waypoint: { ...home },
      nextWanderAt: Number.MAX_SAFE_INTEGER, spawnedAt: state.time, raiderCamp: camp.id, returning: true, raid: false, motivation: 'assault' });
    for (let member = 0; member < size; member++) {
      const tent = tents[(band + member) % tents.length]!;
      const stats = marauderBaseStats(65, 10, 2);
      const unit: Unit = { id: ++nextId, x: tent.x + .5, y: tent.y + .5, kind: 'warrior', faction: RAIDER_FACTION,
        marauderPack: id, name, ...stats, maxHp: stats.hp, morale: 100, speed: 2.35, range: 1.1,
        inside: true, raiderGarrison: tent.id, order: 'hold', cooldown: 0, lastCombat: -60, lastDamagedAt: -60,
        moving: false, facing: rng() * Math.PI * 2, attackTime: 0, bornAt: state.time };
      units.add(unit); entityStore(state).setUnitSleeping(unit, true);
    }
    available -= size;
  }
  ensureMarauderLeaders(state);
}
