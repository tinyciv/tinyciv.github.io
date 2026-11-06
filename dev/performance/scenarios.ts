import { entityStore } from '../../src/game/entity-store';
import type { Building, Faction, GameState, Point, Unit } from '../../src/game/types';
import { synchronizeFarms, ensureCollectors } from '../../src/game/farms';
import { ensureBuilders } from '../../src/game/builders';
import { updateFog } from '../../src/game/fog';

export type PerformanceScenarioId = 'idle-100' | 'idle-300' | 'idle-600' | 'combat-100' | 'combat-300' | 'combat-600';
export const PERFORMANCE_SCENARIOS: PerformanceScenarioId[] = [
  'idle-100', 'idle-300', 'idle-600', 'combat-100', 'combat-300', 'combat-600',
];
export const NO_INPUT = { up: false, down: false, left: false, right: false };
export interface PerformanceScenario {
  state: GameState;
  camera: Point;
  zoom: number;
  metadata: {
    id: PerformanceScenarioId; mode: 'idle' | 'combat'; requestedVisibleUnits: number;
    visibleUnits: number; totalUnits: number; buildings: number; fields: number;
    map: [number, number]; unitHp: number; suggestedMaximumSimSeconds: number;
    notes: string[];
  };
}

/** Deterministic stress scene using production simulation, rendering and fog.
 * Keep timed runs below 15 simulated seconds; first-frame preparation is separate.
 * No gameplay modules are patched or disabled by this fixture. */
export function createPerformanceScenario(id: PerformanceScenarioId): PerformanceScenario {
  const count = Number(id.split('-')[1]), combat = id.startsWith('combat');
  if (!PERFORMANCE_SCENARIOS.includes(id)) throw new Error(`Unknown performance scene: ${id}`);
  const width = 112, height = 88, seed = `performance:${id}`;
  const faction = (index: number): Faction => ({
    id: index, name: index ? 'Attackers' : 'Defenders', color: index ? '#e45454' : '#3988ff',
    affinity: index ? 0 : 100, relation: index ? (combat ? 'war' : 'peace') : 'self',
    food: 5000, gold: 0, production: 0, population: 40, culture: 10000,
    yields: { food: 0, production: 0, gold: 0 }, nextRaid: 1e9, defeated: false,
  });
  const state: GameState = {
    world: { width, height, seed, source: 'Deterministic engine performance fixture', revision: 1,
      spawns: [{ x: 36, y: 43 }, { x: 94, y: 43 }],
      tiles: Array.from({ length: width * height }, (_, i) => ({
        terrain: 'grassland', overlay: i % width < 24 && i % 7 === 0 ? 'forest' : 'none',
        elevation: .3, moisture: .5, food: 3, production: 1, gold: 0,
        variation: ((i * 37 + 17) % 997) / 997,
      })) },
    units: [], buildings: [], factions: [faction(0), faction(1)], fields: [],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], bloodEffects: [], projectiles: [],
    selected: null, selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false,
    seed, rngState: 12345, retinueStance: combat ? 'aggressive' : 'hold', movementMode: 'travel',
    marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1, enemyPressureVersion: 1,
    fogRaids: { nextAt: 1e9, waves: 0, pressureVersion: 1 }, treasures: [], treeClearings: [],
  };
  let entityId = 1;
  const building = (kind: Building['kind'], x: number, y: number, owner = 0): Building => {
    const maxHp = kind === 'palace' ? 650 : kind === 'woodenTower' ? 600 : kind === 'wall' ? 225 : 200;
    const item: Building = { id: entityId++, kind, x, y, faction: owner, hp: maxHp, maxHp,
      capacity: kind === 'house' ? 4 : 0, houseLevel: kind === 'house' ? 1 + entityId % 3 : undefined,
      armor: kind === 'woodenTower' ? 6 : 2 };
    entityStore(state).buildings.add(item); return item;
  };
  building('palace', 36, 43);
  building('palace', 94, 43, 1);
  for (const y of [30, 57]) for (let x = 44; x <= 68; x += 3) building('house', x, y);
  for (const x of [37, 74]) for (let y = 33; y <= 54; y += 3) building('house', x, y);
  for (const [x, y] of [[37, 36], [74, 36], [37, 52], [74, 52]]) {
    // The sparse side houses at the camp center are replaced by the real farm.
    entityStore(state).buildings.replace(state.buildings.filter(b => b.kind !== 'house' || Math.max(Math.abs(b.x - x), Math.abs(b.y - y)) > 1));
    building('camp', x, y);
  }
  for (let x = 42; x <= 70; x++) { building('road', x, 32); building('road', x, 55); }
  // No obstacle is inside the unit grid; outer fortifications add genuine draw,
  // adjacency, blocker and tower-target work without trapping the front ranks.
  for (let x = 41; x <= 71; x += 2) { building('wall', x, 29); building('wall', x, 58); }
  building('woodenTower', 54, 31);
  building('woodenTower', 57, 56, combat ? 1 : 0);
  const columns = count === 100 ? 10 : count === 300 ? 20 : 30;
  const rows = count / columns, x0 = 56 - columns / 2, y0 = 44 - rows / 2;
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const owner = column < columns / 2 ? 0 : 1;
    const isLeader = row === 0 && (column === 0 || column === columns - 1);
    const unit: Unit = {
      id: entityId++, kind: isLeader ? 'leader' : 'warrior', faction: owner,
      x: x0 + column + .5, y: y0 + row + .5,
      hp: 10000, maxHp: 10000, morale: 100, attack: isLeader ? 25 : 17.5, defense: isLeader ? 5 : 4,
      speed: isLeader ? 3.6 : 3.96, range: isLeader ? 4 : 1.1,
      order: combat && !isLeader ? 'raid' : 'hold', cooldown: (row % 4) * .08,
      lastCombat: -60, moving: false, facing: owner ? Math.PI : 0, attackTime: 0,
    };
    entityStore(state).units.add(unit);
  }
  // Raid orders use enemy units immediately and march toward the opposing
  // palace only when no local opponent exists. Keep player-side raids valid.
  if (combat) for (const unit of state.units) if (unit.order === 'raid') {
    unit.target = state.buildings.find(b => b.kind === 'palace' && b.faction !== unit.faction)!.id;
  }
  synchronizeFarms(state);
  ensureCollectors(state);
  ensureBuilders(state);
  updateFog(state);
  state.selected = state.units.find(unit => unit.kind === 'leader' && unit.faction === 0)!.id;
  state.selectedType = 'unit';
  return {
    state, camera: { x: 56, y: 44 }, zoom: 1,
    metadata: {
      id, mode: combat ? 'combat' : 'idle', requestedVisibleUnits: count,
      visibleUnits: state.units.filter(unit => !unit.inside && unit.hp > 0).length,
      totalUnits: state.units.length, buildings: state.buildings.length, fields: state.fields!.length,
      map: [width, height], unitHp: 10000, suggestedMaximumSimSeconds: 15,
      notes: [
        '112×88 map matches the default generated-world dimensions; terrain is deterministic open grassland around the camera.',
        'Both sides use 10,000 maximum/current HP solely to keep unit population stable; normal attack, defense, speed, range, AI and cooldown processing remain active.',
        'Idle and combat counts include two leaders. Hidden builders/couriers are reported separately in totalUnits.',
        'Palaces, houses, roads, walls, towers, and four real 3×3 farms exercise settlement rendering and bookkeeping.',
        'No gold, distant scheduled raids, and runs below 15 simulated seconds prevent automatic defense expansion and 30-second economy ticks.',
        'Use the same viewport, deviceScaleFactor, camera, zoom, warmup, simulation dt and measured frame count before/after.',
      ],
    },
  };
}

export function summarizePerformanceState(state: GameState) {
  return {
    time: state.time, gameOver: state.gameOver, units: state.units.length,
    visibleUnits: state.units.filter(unit => unit.hp > 0 && !unit.inside).length,
    movingUnits: state.units.filter(unit => unit.moving && !unit.inside).length,
    engagedUnits: state.units.filter(unit => state.time - unit.lastCombat < 1.1 && !unit.inside).length,
    totalUnitHp: state.units.reduce((sum, unit) => sum + unit.hp, 0),
    projectiles: state.projectiles?.length ?? 0, bloodEffects: state.bloodEffects?.length ?? 0,
    buildings: state.buildings.length, fields: state.fields?.length ?? 0,
  };
}
