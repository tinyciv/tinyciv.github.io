import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { ensureCollectors, synchronizeFarms, updateHarvests, FARM_ABANDON_SECONDS } from '../src/game/farms';
import { updateGame } from '../src/game/simulation';
import { type Building, type GameState, tileAt } from '../src/game/types';
import { updateWallOwnership, WALL_CLAIM_RADIUS } from '../src/game/wall-ownership';

function fixture(): GameState {
  return {
    world: { width: 48, height: 36, seed: 'farm-ownership', source: 'test', spawns: [], revision: 0,
      tiles: Array.from({ length: 48 * 36 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
        moisture: .5, food: 2, production: 1, gold: 0, variation: .2 })) },
    buildings: [], units: [], fields: [], factions: [0, 1, 2].map(id => ({ id, name: `Faction ${id}`, color: '#38f',
      affinity: 0, relation: id === 0 ? 'self' : 'war', food: 1000, gold: 0, production: 0, population: 4,
      culture: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, nextRetinueAt: Infinity, defeated: false })),
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], projectiles: [], raiderCamps: [], marauderPacks: [],
    selected: null, selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false,
    seed: 'farm-ownership', rngState: 1, roamingMaraudersVersion: 1, enemyPressureVersion: 1,
    fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 1 },
  };
}
function add(state: GameState, kind: Building['kind'], faction: number, x = 20, y = 16): Building {
  const building: Building = { id: state.buildings.length + 1, kind, faction, x, y, hp: 100, maxHp: 100,
    capacity: kind === 'house' ? 4 : 0, governorPermissions: { farms: false, housing: false } };
  entityStore(state).buildings.add(building); return building;
}

describe('local farm claims', () => {
  it('keeps a supported farm until its last former-owner building falls, then transfers all plots atomically', () => {
    const state = fixture(), farm = add(state, 'camp', 1), support = add(state, 'well', 1, 23, 16);
    add(state, 'well', 0, 18, 16); add(state, 'well', 0, 18, 18);
    synchronizeFarms(state);
    const crops = state.fields!;
    for (const crop of crops) { crop.food = 2; crop.foodBatches = [{ amount: 2, expiresAt: 70 }]; crop.expiresAt = 70; }
    const before = crops.map(crop => ({ id: crop.id, nextHarvest: crop.nextHarvest }));
    farm.farmLastVisitedAt = 12;
    expect(updateWallOwnership(state)).toBe(false);
    support.hp = 0;
    expect(updateWallOwnership(state)).toBe(true);
    expect(farm.faction).toBe(0);
    expect(farm.farmLastVisitedAt).toBe(12);
    expect(state.fields).toBe(crops);
    expect(crops.map(crop => ({ id: crop.id, nextHarvest: crop.nextHarvest }))).toEqual(before);
    for (const crop of crops) {
      expect(crop).toMatchObject({ faction: 0, food: 2, expiresAt: 70, foodBatches: [{ amount: 2, expiresAt: 70 }] });
      expect(tileAt(state.world, crop.x, crop.y)?.farm).toBe(0);
    }
    const revision = state.world.revision, version = state.farmVersion;
    expect(updateWallOwnership(state)).toBe(false);
    expect(state.world.revision).toBe(revision); expect(state.farmVersion).toBe(version);
  });

  it('preserves outlying farmland without a local claimant, including while fallow, and later permits capture', () => {
    const state = fixture(), farm = add(state, 'camp', 0);
    synchronizeFarms(state);
    expect(updateWallOwnership(state)).toBe(false);
    state.time = 119.9;
    expect(updateWallOwnership(state)).toBe(false);
    farm.farmFallow = true;
    for (const crop of state.fields!) crop.planted = false;
    state.time = 120;
    expect(updateWallOwnership(state)).toBe(false);
    expect(farm.faction).toBe(0);
    expect(state.fields!.every(crop => crop.faction === 0 && !crop.planted)).toBe(true);
    add(state, 'monument', 1, 19, 15);
    expect(updateWallOwnership(state)).toBe(true);
    expect(farm.faction).toBe(1);
    expect(farm.farmFallow).toBe(true); // A claim is not a visit or a free replant.
    expect(farm.farmAbandonedAt).toBeUndefined(); // Owned farms have no removal timer.
  });

  it('does not let farms, walls, roads or unfinished buildings support or acquire one another', () => {
    const state = fixture(), farm = add(state, 'camp', 1);
    farm.farmFallow = true;
    for (const kind of ['camp', 'shack', 'cottage', 'wall', 'palisade', 'road', 'bridge'] as const) add(state, kind, 1, 22, 18);
    add(state, 'house', 1, 22, 16).construction = { startedAt: 0, duration: 20 };
    expect(updateWallOwnership(state)).toBe(true); // Unsupported walls become neutral.
    expect(farm.faction).toBe(1);
    expect(updateWallOwnership(state)).toBe(false);
  });

  it('uses the same unique local building majority outside borders and counts a large building once', () => {
    const state = fixture(), farm = add(state, 'camp', -1);
    add(state, 'library', 0, 18, 16); add(state, 'well', 1, 23, 16);
    expect(updateWallOwnership(state)).toBe(false); expect(farm.faction).toBe(-1);
    add(state, 'well', 1, 23, 18);
    expect(updateWallOwnership(state)).toBe(true); expect(farm.faction).toBe(1);
  });

  it('cancels abandonment when claimed and starts a fresh clock on becoming neutral again', () => {
    const state = fixture(), farm = add(state, 'camp', -1);
    synchronizeFarms(state); updateHarvests(state);
    expect(farm.farmAbandonedAt).toBe(0);
    state.time = FARM_ABANDON_SECONDS; // A claim at the deadline wins before harvest expiry.
    const support = add(state, 'well', 0, 18, 16);
    expect(updateWallOwnership(state)).toBe(true);
    expect(farm.faction).toBe(0); expect(farm.farmAbandonedAt).toBeUndefined();
    state.time = 2000; updateHarvests(state);
    expect(state.buildings.includes(farm)).toBe(true); expect(farm.farmFallow).toBe(true);
    support.hp = 0;
    add(state, 'well', 1, 18, 16); add(state, 'well', 2, 23, 16);
    expect(updateWallOwnership(state)).toBe(true);
    expect(farm.faction).toBe(-1); expect(farm.farmAbandonedAt).toBe(2000);
    state.time += FARM_ABANDON_SECONDS - .01; updateHarvests(state);
    expect(state.buildings.includes(farm)).toBe(true);
    expect(updateWallOwnership(state)).toBe(false); // An unchanged tie does not renew the clock.
    state.time += .01; updateHarvests(state);
    expect(state.buildings.includes(farm)).toBe(false);
  });

  it('measures the inclusive eight-tile claim radius from the farm center', () => {
    const state = fixture(), farm = add(state, 'camp', -1);
    const support = add(state, 'house', 0, farm.x + WALL_CLAIM_RADIUS, farm.y);
    expect(updateWallOwnership(state)).toBe(true); expect(farm.faction).toBe(0);
    farm.faction = -1; support.x += .01;
    expect(updateWallOwnership(state)).toBe(false); expect(farm.faction).toBe(-1);
  });

  it('leaves farm construction outside borders commissioned and prevents defeated factions from claiming new plots', () => {
    const state = fixture(), farm = add(state, 'camp', 1);
    farm.construction = { startedAt: 0, duration: 10 };
    add(state, 'well', 0, 18, 16);
    expect(updateWallOwnership(state)).toBe(false); expect(farm.faction).toBe(1);
    delete farm.construction;
    state.factions[0].defeated = true;
    farm.faction = -1;
    expect(updateWallOwnership(state)).toBe(false); expect(farm.faction).toBe(-1);
    state.factions[0].defeated = false;
    expect(updateWallOwnership(state)).toBe(true); expect(farm.faction).toBe(0);
  });

  it('releases former couriers without converting population or crediting either palace with carried food', () => {
    const state = fixture();
    add(state, 'palace', 0, 2, 2); add(state, 'palace', 1, 39, 28);
    const farm = add(state, 'camp', 1), other = add(state, 'camp', 1, 36, 28);
    const support = add(state, 'house', 1, 23, 16);
    add(state, 'house', 0, 18, 16);
    synchronizeFarms(state); ensureCollectors(state);
    const worker = state.units.find(unit => unit.collectorCamp === farm.id)!, crop = state.fields!.find(field => field.camp === farm.id)!;
    Object.assign(worker, { inside: false, x: crop.x + .5, y: crop.y + .5, field: crop.id, collectPhase: 'outbound',
      cargo: 3, cargoField: crop.id, cargoExpiresAt: 70, cargoBatches: [{ amount: 3, expiresAt: 70 }],
      destination: { x: crop.x + .5, y: crop.y + .5 }, path: [{ x: crop.x + .5, y: crop.y + .5 }], moving: true });
    crop.claimedBy = worker.id;
    const food = state.factions.map(faction => faction.food), population = state.factions.map(faction => faction.population);
    support.hp = 0;
    expect(updateWallOwnership(state)).toBe(true);
    expect(worker.faction).toBe(1); expect(worker.cargo).toBe(3);
    expect(worker.field).toBeUndefined(); expect(worker.destination).toBeUndefined(); expect(worker.path).toBeUndefined();
    expect(crop.claimedBy).toBeUndefined();
    synchronizeFarms(state); ensureCollectors(state);
    expect(state.units.filter(unit => unit.collectorCamp === farm.id)).toHaveLength(1);
    expect(state.units.find(unit => unit.collectorCamp === farm.id)?.faction).toBe(0);
    expect(state.fields!.filter(field => field.camp === other.id).reduce((sum, field) => sum + field.food, 0)).toBe(3);
    expect(state.factions.map(faction => faction.food)).toEqual(food);
    expect(state.factions.map(faction => faction.population)).toEqual(population);
  });

  it('claims farmland in the same simulation update that combat destroys the last supporting enemy building', () => {
    const state = fixture();
    add(state, 'palace', 0, 2, 2); add(state, 'palace', 1, 39, 28);
    const farm = add(state, 'camp', 1), support = add(state, 'well', 1, 23, 16);
    add(state, 'house', 0, 18, 16);
    for (const faction of [0, 1]) entityStore(state).units.add({ id: 100 + faction, kind: 'leader', faction, x: faction ? 40.5 : 3.5, y: faction ? 31.5 : 5.5,
      hp: 100, maxHp: 100, morale: 100, attack: 0, defense: 5, speed: 0, range: 4, order: 'hold', cooldown: 0,
      lastCombat: -60, moving: false, facing: 0, attackTime: 0 });
    synchronizeFarms(state);
    state.projectiles = [{ x: 23.5, y: 16.5, start: { x: 23.5, y: 16.5 }, end: { x: 23.5, y: 16.5 },
      attacker: 100, target: support.id, faction: 0, damage: 1000, elapsed: 0, duration: .1 }];
    updateGame(state, .1, { up: false, down: false, left: false, right: false });
    expect(support.hp).toBe(0); expect(farm.faction).toBe(0);
    expect(state.fields!.filter(field => field.camp === farm.id).every(field => field.faction === 0)).toBe(true);
    expect(state.units.find(unit => unit.collectorCamp === farm.id)?.faction).toBe(0);
  });
});
