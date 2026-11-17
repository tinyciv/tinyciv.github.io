import { buildingReady, isSoldier, type GameState, type Unit } from './types';
import { unitAttack, unitDefense } from './veterancy';

export const RAIDER_TECHNOLOGY_INTERVAL = 60;
export function armyAverages(state: GameState, units: readonly Unit[]): { attack: number; defense: number; hp: number } {
  let attack = 0, defense = 0, hp = 0;
  for (const unit of units) {
    const base = { ...unit, technologyBonus: undefined, raiderBonus: undefined, brace: undefined };
    const faction = state.factions.find(f => f.id === unit.faction);
    attack += unitAttack(base, faction);
    defense += unitDefense(base, faction); hp += unit.maxHp ?? 100;
  }
  return units.length ? { attack: attack / units.length, defense: defense / units.length, hp: hp / units.length }
    : { attack: 17 * .7, defense: 4, hp: 100 };
}
export const armySoldier = (unit: Unit): boolean => unit.hp > 0 && (isSoldier(unit) || unit.kind === 'militia') && unit.kind !== 'leader' && unit.kind !== 'sailboat' && unit.kind !== 'scout' && unit.attack > 0;
/** Pre-aura, post-equipment averages. Recomputed from base values, never the
 * previous bonus, so repeated samples cannot compound strength. */
export function updateRaiderTechnology(state: GameState): void {
  if (state.time < (state.raiderTechnologyAt ?? 0)) return;
  state.raiderTechnologyAt = state.time + RAIDER_TECHNOLOGY_INTERVAL;
  const cities = state.buildings.filter(b => b.kind === 'palace' && buildingReady(b)
    && state.factions.some(f => f.id === b.faction && !f.defeated && f.villageId === undefined));
  const armies = new Map<number, Unit[]>(), bands = new Map<number, Unit[]>();
  for (const unit of state.units) if (armySoldier(unit) && !unit.marauderLeader) {
    const map = unit.faction === -2 ? bands : armies, id = unit.faction === -2 ? unit.marauderPack ?? -1 : unit.faction;
    if (unit.seaInvasion !== undefined) continue;
    const list = map.get(id) ?? []; list.push(unit); map.set(id, list);
  }
  const averages = new Map([...armies].map(([id, units]) => [id, armyAverages(state, units)]));
  for (const [id, group] of bands) {
    const center = { x: group.reduce((n,u)=>n+u.x,0)/group.length, y: group.reduce((n,u)=>n+u.y,0)/group.length };
    let nearest = cities[0], best = Infinity;
    for (const city of cities) { const d = (city.x+1-center.x)**2+(city.y+1-center.y)**2; if (d < best) { nearest=city; best=d; } }
    if (!nearest) continue;
    const own = armyAverages(state, group), other = averages.get(nearest.faction) ?? armyAverages(state, []);
    const bonus = { attack: Math.max(0, (other.attack-own.attack)*2/3), defense: Math.max(0, (other.defense-own.defense)*2/3) };
    for (const unit of state.units) if (unit.faction === -2 && (unit.marauderPack ?? -1) === id && unit.seaInvasion === undefined) unit.technologyBonus = bonus;
  }
}
