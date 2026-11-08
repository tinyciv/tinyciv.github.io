import type { GameState, Unit } from '../../src/game/types';

export function armyWarningFixture(): GameState {
  const unit = (id: number, kind: Unit['kind'], faction: number, x: number, y: number): Unit => ({
    id, kind, faction, x, y, hp: 100, maxHp: 100, attack: 17, defense: 4, morale: 100, speed: 3, range: 1.1,
    order: kind === 'leader' ? 'hold' : kind === 'worker' ? 'work' : 'follow', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0,
  });
  return {
    world: { width: 260, height: 60, seed: 'army-warnings', source: 'test', spawns: [], revision: 0,
      tiles: Array.from({ length: 260 * 60 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
        moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
    factions: [0, 1].map(id => ({ id, name: id ? 'Carthaginians' : 'Romans', color: id ? '#368bd4' : '#cd4141', affinity: 50,
      relation: id ? 'war' : 'self', food: 500, gold: 2000, population: 9, production: 0, nextRaid: Infinity, nextRetinueAt: Infinity,
      defeated: false, yields: { food: 0, production: 0, gold: 0 }, research: { focus: 'massLevy', levels: { infantryDrill: 1, massLevy: 1 }, progress: {} } })),
    buildings: [0, 1].map(faction => ({ id: 900 + faction, kind: 'palace', faction, x: 17 + faction * 13, y: 29,
      hp: 650, maxHp: 650, capacity: 20, unhousedResidents: 9, cityName: faction ? 'Carthage' : 'Roma',
      governorPermissions: { farms: false, housing: false } })),
    units: [unit(1, 'leader', 0, 20.5, 25.5), unit(2, 'leader', 1, 31.5, 25.5),
      ...Array.from({ length: 8 }, (_, i) => unit(10 + i, 'warrior', 1, 30.5 + i % 4, 26.5 + Math.floor(i / 4))),
      ...Array.from({ length: 9 }, (_, i) => ({ ...unit(30 + i, 'worker', 1, 30.5 + i % 3, 32.5 + Math.floor(i / 3)), home: 901 })),
      ...Array.from({ length: 10 }, (_, i) => ({ ...unit(100 + i, 'warrior', -2, 80.5 + i % 4, 25.5 + Math.floor(i / 4)),
        marauderPack: 7, marauderLeader: i === 0, order: 'raid' as const }))],
    marauderPacks: [{ id: 7, name: 'Ash Wolves', color: '#9c62ce', leaderId: 100, raid: true, motivation: 'siege', phase: 'attack',
      targetFaction: 0, targetBuilding: 900, home: { x: 90, y: 25 }, waypoint: { x: 20, y: 25 }, nextWanderAt: Infinity, startingTroops: 10 }],
    time: 0, tick: 0, paused: true, speed: 1, events: [], particles: [], fields: [], treasures: [], raiderCamps: [], villages: [],
    selected: null, selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'army-warnings', rngState: 1,
    roamingMaraudersVersion: 1, fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 1 },
  };
}
