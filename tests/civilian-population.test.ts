import { describe, expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { civilianCityPopulations, recordCivilianCasualty } from '../src/game/civilian-population';
import { ensureBuilders } from '../src/game/builders';
import { ensureCollectors, synchronizeFarms, updateHarvests } from '../src/game/farms';
import { advanceCityPopulation } from '../src/game/city-growth';
import { citySummaries } from '../src/game/cities';
import { panicCivilian, updateCivilianPanic } from '../src/game/civilian-panic';
import { atWar, moveUnit, updateGame } from '../src/game/simulation';
import { invalidateNavigation } from '../src/game/pathfinding';
import { type Building, type GameState, type Unit } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
const person = (id: number, kind: Unit['kind'], faction: number, x: number, y: number): Unit => ({ id, kind, faction, x, y,
  hp: 50, maxHp: 50, attack: 0, defense: 0, speed: 2.2, range: 1.1, morale: 100, order: kind === 'worker' ? 'work' : 'hold',
  cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 });
function fixture(population = 20): GameState {
  const palace: Building = { id: 1, kind: 'palace', faction: 0, x: 10, y: 10, hp: 650, maxHp: 650, capacity: 20,
    unhousedResidents: population, governorPermissions: { farms: false, housing: false } };
  return { world: { width: 48, height: 40, seed: 'civilian-population', source: 'test', spawns: [], revision: 0,
    tiles: Array.from({ length: 1920 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .5, food: 2, production: 0, gold: 0, variation: .5 })) },
    units: [person(2, 'leader', 0, 11.5, 14.5)], buildings: [palace], fields: [],
    factions: [{ id: 0, name: 'City', color: '#f00', affinity: 100, relation: 'self', food: 500, gold: 0, production: 0, population,
      yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, nextRetinueAt: Infinity, defeated: false }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], projectiles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'civilian-population', rngState: 1,
    marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1, fogRaids: { nextAt: Infinity, waves: 0 },
    wildlife: { herds: [], sequence: 0, nextRespawnAt: Infinity, targetHerds: 0 } };
}
function farms(state: GameState, count: number): Building[] {
  const result: Building[] = [];
  for (let y = 6; y <= 15 && result.length < count; y++) for (let x = 6; x <= 15 && result.length < count; x++) {
    if (x >= 10 && x <= 11 && y >= 10 && y <= 11) continue;
    const farm: Building = { id: 100 + result.length, kind: 'camp', faction: 0, x, y, hp: 100, maxHp: 100, capacity: 0 };
    entityStore(state).buildings.add(farm); result.push(farm);
  }
  synchronizeFarms(state); ensureCollectors(state); ensureBuilders(state); return result;
}
const workers = (state: GameState) => state.units.filter(unit => unit.kind === 'worker' && unit.hp > 0);
function tick(state: GameState, seconds: number): void { for (let time = 0; time < seconds - 1e-8; time += .1) updateGame(state, .1, idle); }

describe('real civilian population', () => {
  it('limits all builder and collector allocations to the city population and rotates through more farms than workers', () => {
    const state = fixture(20), plots = farms(state, 64);
    expect(workers(state).length).toBeLessThanOrEqual(20);
    const initialIds = new Set(workers(state).map(unit => unit.id));
    updateHarvests(state);
    tick(state, 60); // Establish the first crops before measuring sustainable delivery.
    const food = state.factions[0].food, delivered = state.buildings[0].foodDelivered ?? 0;
    let maximum = 0;
    // A single worker now sweeps this deliberately oversized connected parcel.
    for (let time = 0; time < 240; time += .1) {
      updateGame(state, .1, idle); maximum = Math.max(maximum, workers(state).length);
    }
    expect(maximum).toBeLessThanOrEqual(20);
    expect(plots.every(farm => (farm.farmLastVisitedAt ?? 0) > 0)).toBe(true);
    expect((state.buildings[0].foodDelivered ?? 0) - delivered).toBeGreaterThan(80);
    expect(state.factions[0].food).toBeGreaterThan(food);
    expect(workers(state).every(unit => initialIds.has(unit.id))).toBe(true);
  }, 15000);

  it('repeated combat losses reduce the city to zero, stop replacement workers, and block spontaneous births', () => {
    const state = fixture(5); farms(state, 8);
    let deaths = 0;
    while (state.factions[0].population > 0 && deaths < 10) {
      const worker = workers(state)[0]; expect(worker).toBeDefined();
      worker.hp = 0;
      expect(recordCivilianCasualty(state, worker)).toBe(true);
      expect(recordCivilianCasualty(state, worker)).toBe(false);
      ensureCollectors(state); ensureBuilders(state); deaths++;
    }
    expect(deaths).toBe(5); expect(workers(state)).toHaveLength(0); expect(state.buildings[0].depopulated).toBe(true);
    for (let i = 0; i < 8; i++) advanceCityPopulation(state, state.factions[0], citySummaries(state), 1);
    ensureBuilders(state); ensureCollectors(state);
    expect(state.factions[0].population).toBe(0); expect(workers(state)).toHaveLength(0);
    state.factions[0].population = 1; state.buildings[0].unhousedResidents = 1;
    for (let i = 0; i < 3; i++) advanceCityPopulation(state, state.factions[0], citySummaries(state), 1);
    expect(state.buildings[0].depopulated).toBeUndefined(); expect(state.factions[0].population).toBeGreaterThan(1);
  });

  it('still bootstraps a newly founded empty settlement but never creates workers before it has residents', () => {
    const state = fixture(0); farms(state, 5);
    expect(workers(state)).toHaveLength(0);
    for (let i = 0; i < 3; i++) advanceCityPopulation(state, state.factions[0], citySummaries(state), 1);
    expect(state.factions[0].population).toBeGreaterThan(0);
    ensureCollectors(state); ensureBuilders(state);
    expect(workers(state).length).toBeLessThanOrEqual(state.factions[0].population);
    expect(workers(state).length).toBeGreaterThan(0);
  });

  it('charges a remote worker casualty to its home city without draining another city', () => {
    const state = fixture(6); state.buildings[0].unhousedResidents = 2;
    entityStore(state).buildings.add({ ...state.buildings[0], id: 3, x: 32, unhousedResidents: 4 });
    const worker = { ...person(50, 'worker', 0, 33.5, 10.5), home: 1, hp: 0 };
    entityStore(state).units.add(worker);
    recordCivilianCasualty(state, worker);
    expect(civilianCityPopulations(state)).toEqual(new Map([[1, 1], [3, 4]]));
    expect(state.factions[0].population).toBe(5);
  });

  it.each(['melee', 'projectile'] as const)('records an actual %s worker death once before creating any replacement', mode => {
    const state = fixture(1), worker = { ...person(50, 'worker', 0, 20.5, 20.5), home: 1, hp: 1, speed: 0 };
    const attacker = { ...person(51, 'warrior', -2, 21.5, 20.5), attack: 1000, speed: 0 };
    entityStore(state).units.add(worker, attacker);
    if (mode === 'projectile') { attacker.attack = 0; state.projectiles = [{ attacker: attacker.id, faction: -2, target: worker.id, x: 21.5, y: 20.5,
      start: { x: 21.5, y: 20.5 }, end: { x: 20.5, y: 20.5 }, damage: 100, duration: .01, elapsed: 0 }]; }
    updateGame(state, .1, idle);
    expect(worker.hp).toBe(0); expect(worker.civilianCasualtyRecorded).toBe(true); expect(state.factions[0].population).toBe(0);
    expect(workers(state)).toHaveLength(0);
  });
});

describe('physical civilian shelter', () => {
  it('enters the settlement, deposits unspoiled cargo once, and stays hidden while enemies threaten any exit', () => {
    const state = fixture(4), worker = { ...person(50, 'worker', 0, 14.5, 10.5), home: 1, collector: true,
      collectorCamp: 100, collectPhase: 'returning' as const, cargo: 7, cargoBatches: [{ amount: 5, expiresAt: 30 }, { amount: 2, expiresAt: .2 }] };
    const enemy = { ...person(51, 'warrior', -2, 16.5, 10.5), attack: 20 };
    entityStore(state).units.add(worker, enemy); panicCivilian(state, worker, enemy);
    const food = state.factions[0].food;
    for (let i = 0; i < 200; i++) { state.time += .1; updateCivilianPanic(state, worker, .1, moveUnit, (a, b) => atWar(state, a, b), () => true); }
    expect(worker.inside).toBe(true); expect(worker.civilianPanic?.shelter).toBe(1); expect(worker.cargo).toBe(0);
    expect(state.factions[0].food).toBe(food + 5); expect(worker.order).toBe('flee');
    enemy.hp = 0;
    for (let i = 0; i < 85; i++) { state.time += .1; updateCivilianPanic(state, worker, .1, moveUnit, (a, b) => atWar(state, a, b), () => true); }
    expect(worker.civilianPanic).toBeUndefined(); expect(worker.order).toBe('work'); expect(worker.collectPhase).toBe('idle');
    expect(state.factions[0].food).toBe(food + 5);
  });

  it('does not leave civilians hidden inside a destroyed settlement', () => {
    const state = fixture(1), worker = { ...person(50, 'worker', 0, 11, 11), home: 1, inside: true };
    entityStore(state).units.add(worker); panicCivilian(state, worker, { x: 15, y: 10 });
    updateCivilianPanic(state, worker, .1, moveUnit, (a, b) => atWar(state, a, b), () => true);
    state.buildings[0].hp = 0; invalidateNavigation(state); state.time += 1;
    updateCivilianPanic(state, worker, .1, moveUnit, (a, b) => atWar(state, a, b), () => true);
    expect(worker.inside).toBe(false); expect(worker.civilianPanic?.shelter).toBeUndefined();
  });
});
