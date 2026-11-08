import { armyWarningFixture } from './army-warnings';
import { entityStore } from '../../src/game/entity-store';
import type { Building } from '../../src/game/types';
export function loyaltyFixture() {
  const state = armyWarningFixture(); entityStore(state).units.retain(u => u.id === 1); state.marauderPacks = [];
  state.victoryContinued = true; state.paused = false; state.banditIntensity = 0;
  state.factions[0].population = 13; state.factions[0].gold = 10000;
  state.factions[0].research = { focus: 'massLevy', levels: {}, progress: {} };
  const city = state.buildings[0]; city.cityName = 'Capua'; city.unhousedResidents = 3; city.capacity = 4;
  const other: Building = { ...city, id: 910, x: 80, cityName: 'Roma', unhousedResidents: 4 };
  const add = (id: number, kind: Building['kind'], x: number, y: number, extra: Partial<Building> = {}) => {
    const b: Building = { id, kind, x, y, faction: 0, hp: 500, maxHp: 500, capacity: 0, ...extra };
    entityStore(state).buildings.add(b); return b;
  };
  entityStore(state).buildings.add(other);
  const house = add(902, 'house', 20, 29, { residents: 6, capacity: 6 });
  const library = add(903, 'library', 21, 29), guard = add(904, 'guardPost', 19, 32), wall = add(905, 'wall', 18, 32);
  const farm = add(906, 'camp', 22, 32);
  state.fields = [{ id: 1, camp: farm.id, faction: 0, x: 22, y: 32, planted: true, food: 10, nextHarvest: 20 }];
  const leader = state.units[0]; leader.x = 16; leader.y = 30;
  const worker = { ...leader, id: 300, kind: 'worker' as const, home: city.id, attack: 0, inside: true };
  const defender = { ...leader, id: 301, kind: 'militia' as const, home: guard.id, guardPost: guard.id, guardCity: city.id, attack: 0 };
  const retinue = { ...leader, id: 302, kind: 'warrior' as const, attack: 0 };
  entityStore(state).units.add(worker, defender, retinue);
  return { state, city, other, house, library, guard, wall, farm, leader, worker, defender, retinue, add };
}
