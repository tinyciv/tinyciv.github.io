import type { Building, GameState, Unit } from '../../src/game/types';

const person = (id: number, kind: Unit['kind'] = 'warrior'): Unit => ({ id, kind, faction: 0, x: 12.5 + id % 3, y: 13.5,
  hp: 100, maxHp: 100, morale: 100, attack: 17, defense: 4, speed: 3.96, range: 1.1, order: 'follow', cooldown: 0,
  lastCombat: -60, moving: false, facing: 0, attackTime: 0 });
const building = (id: number, kind: Building['kind'], x: number): Building => ({ id, kind, faction: 0, x, y: 10, hp: 200, maxHp: 200, capacity: 0 });
export function scoutRealm(): GameState {
  return { world: { width: 44, height: 32, seed: 'lodge', source: 'test', spawns: [], revision: 1,
    tiles: Array.from({ length: 44 * 32 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 2, production: 1, gold: 0, variation: .5 })) },
    units: [{ ...person(1, 'leader'), x: 14.5, y: 11.5 }, ...[2, 3, 4, 5].map(id => person(id))],
    buildings: [building(100, 'archeryRange', 12), building(101, 'scoutLodge', 16)],
    factions: [{ id: 0, name: 'Rome', color: '#f00', relation: 'self', affinity: 100, population: 0, food: 1000, gold: 1000,
      production: 0, yields: { food: 0, gold: 0, production: 0 }, defeated: false, nextRaid: Infinity, nextRetinueAt: Infinity,
      research: { focus: 'scoutLodge', levels: { archeryRange: 1, scoutLodge: 1, militaryTactics: 1 }, progress: {} } }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'lodge', rngState: 1,
    marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1, fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 2 },
    wildlife: { herds: [], sequence: 0, nextRespawnAt: Infinity, targetHerds: 0 } };
}

