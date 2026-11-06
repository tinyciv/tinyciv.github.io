import type { Building, GameState, Unit, ResearchBranchId } from '../../src/game/types';
import { prioritizeResearch, researchStatus, updateResearch } from '../../src/game/research';
import { grantIncome } from '../../src/game/resource-income';
export const building = (id: number, kind: Building['kind'], x = 10, y = 10, faction = 0): Building => ({ id, kind, x, y, faction, hp: 250, maxHp: 250, capacity: 0 });
export const person = (id: number, kind: Unit['kind'], x = 10.5, y = 12.5, faction = 0): Unit => ({ id, kind, x, y, faction, hp: 100, maxHp: 100,
  morale: 100, attack: 17, defense: 4, speed: 3, range: kind === 'archer' ? 4 : 1.1, order: 'follow', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 });
export function fixture(): GameState {
  return { world: { width: 32, height: 24, seed: 'research', source: 'test', spawns: [], tiles: Array.from({ length: 768 }, () =>
    ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    buildings: [building(1, 'palace', 6, 10), building(2, 'library')], units: [person(10, 'leader'), person(11, 'warrior', 12.5, 12.5)],
    factions: [{ id: 0, name: 'Test', color: '#d54b42', affinity: 100, relation: 'self', food: 500, gold: 2000, production: 0,
      population: 20, yields: { food: 0, production: 0, gold: 0 }, nextRaid: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'research', rngState: 1,
    marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1, fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 1 },
  };
}

/** Deliver paid income and settle its Science reserve for unlock-focused tests. */
export function points(state: GameState, amount: number): void { grantIncome(state.factions[0], { gold: amount / .25 }, state); updateResearch(state, 1000); }
export function complete(state: GameState, branch: ResearchBranchId): void {
  prioritizeResearch(state, state.buildings.find(b => b.kind === 'library')!, branch);
  for (let n = 0; !state.factions[0].research?.levels[branch] && n < 20; n++) {
    const status = researchStatus(state, 0); points(state, status.required - status.progress);
  }
}
