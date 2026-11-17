// Reproducible full-frame stress inputs. Generation does not execute simulation.
// node benchmarks/scaling-fixtures.mjs --out=scratch/frame-stress
// Then use frame-budget.mjs with a fixture and its matching viewport JSON.
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
const option = process.argv.find(value => value.startsWith('--out='));
const out = path.join(option?.slice(6) ?? 'scratch/frame-stress', 'fixtures');
mkdirSync(out, { recursive: true });
const write = (name, state) => writeFileSync(path.join(out, `${name}.json`), JSON.stringify(state));

function fixture(scenario) {
  const count = Number(scenario.split('-')[1]), moving = scenario.startsWith('move-');
  const width = 224, height = 160, seed = `active-unit-scaling:${scenario}`;
  const factions = [0, 1].map(id => ({ id, name: id ? 'Remote settlement' : 'Player army',
    color: id ? '#e45454' : '#3988ff', affinity: id ? 0 : 100, relation: id ? 'peace' : 'self',
    food: 5000, gold: 0, production: 0, population: 0, culture: 0,
    yields: { food: 0, production: 0, gold: 0 }, nextRaid: 1e9, nextRetinueAt: 1e9, defeated: false }));
  const buildings = [0, 1].map(id => ({ id: id + 1, kind: 'palace', x: id ? 215 : 3, y: 3,
    faction: id, hp: 650, maxHp: 650, armor: 2, capacity: 0, unhousedResidents: 0, populationGrowth: 0,
    governorPermissions: { farms: false, housing: false }, governorNextPlanAt: 1e9 }));
  const makeUnit = (id, kind, faction, x, y) => ({ id, kind, faction, x, y,
    hp: 100, maxHp: 100, morale: 100, attack: kind === 'leader' ? 25 : 17.5,
    defense: kind === 'leader' ? 5 : 4, speed: kind === 'leader' ? 3.6 : 3.96,
    range: kind === 'leader' ? 4 : 1.1, order: 'hold', retinueStance: 'hold', cooldown: 0,
    lastCombat: -60, lastDamagedAt: -60, moving: false, facing: 0, attackTime: 0 });
  const units = [makeUnit(3, 'leader', 0, 5.5, 7.5), makeUnit(4, 'leader', 1, 217.5, 7.5)];
  for (let i = 0; i < count - 2; i++) {
    const unit = makeUnit(i + 5, 'warrior', 0, 12.5 + i % 100 * 2, 28.5 + Math.floor(i / 100) * 2);
    // This is the normal gameplay return leg following a forced attack. It
    // exercises production movement, occupancy and routing without making a
    // single enormous formation converge onto its leader's position.
    if (moving) unit.attackReturn = { x: unit.x + 8, y: unit.y };
    units.push(unit);
  }
  return {
    world: { width, height, seed, source: 'Synthetic distributed active-unit scaling fixture', revision: 1,
      spawns: buildings.map(({ x, y }) => ({ x, y })),
      tiles: Array.from({ length: width * height }, (_, i) => ({ terrain: 'grassland', overlay: 'none',
        elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: ((i * 37 + 17) % 997) / 997 })) },
    units, buildings, factions, fields: [], time: 0, tick: 0, paused: false, speed: 1,
    events: [], particles: [], bloodEffects: [], projectiles: [], selected: 3, selectedType: 'unit',
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed, rngState: 12345,
    retinueStance: 'hold', movementMode: 'travel', marauderPacks: [], raiderCamps: [],
    roamingMaraudersVersion: 1, enemyPressureVersion: 1, fogRaids: { nextAt: 1e9, waves: 0, pressureVersion: 2 },
    wildlife: { herds: [], sequence: 0, nextRespawnAt: 1e9, targetHerds: 0 }, treasures: [], treeClearings: [],
  };
}

const terrain = (width, height) => Array.from({ length: width * height }, (_, i) => ({
  terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5,
  food: 3, production: 1, gold: 0, variation: ((i * 37 + 17) % 997) / 997,
}));
write('hold-5000', fixture('hold-5000'));
const moving = fixture('move-1000');
moving.world.width = 512;
moving.world.tiles = terrain(512, moving.world.height);
moving.world.seed = moving.seed = 'active-unit-scaling:move-1000-long';
// Long return legs remain active throughout a 30-second browser replay.
for (const unit of moving.units) if (unit.attackReturn) unit.attackReturn.x = unit.x + 200;
assert(moving.units.filter(unit => unit.attackReturn).every(unit => unit.attackReturn.x < moving.world.width));
write('move-1000-long', moving);

const state = fixture('hold-5000');
state.world = { width: 208, height: 208, seed: 'working-civilians-2000',
  source: '100 populated towns, 1000 staffed construction sites and 1000 disconnected productive farms',
  revision: 1, spawns: [{ x: 9, y: 9 }, { x: 202, y: 202 }], tiles: terrain(208, 208) };
state.seed = state.world.seed;
state.units = state.units.slice(0, 2);
Object.assign(state.units[0], { x: 10.5, y: 11.5 });
Object.assign(state.units[1], { x: 204.5, y: 204.5 });
state.time = 10;
state.selected = 3;
state.buildings = [];
state.fields = [];
Object.assign(state.factions[0], { population: 5000, food: 1e6, gold: 1e5 });
let id = 100;
const worker = (id, home, x, y) => ({ id, kind: 'worker', faction: 0, home, x, y,
  hp: 50, maxHp: 50, morale: 100, attack: 0, defense: 0, speed: 2.2, range: 1.1,
  order: 'work', cooldown: 0, lastCombat: -60, lastDamagedAt: -60, moving: false,
  facing: 0, attackTime: 0, bornAt: 0 });
for (let city = 0; city < 100; city++) {
  const bx = city % 10 * 20, by = Math.floor(city / 10) * 20;
  const palace = { id: id++, kind: 'palace', x: bx + 9, y: by + 9, faction: 0,
    hp: 650, maxHp: 650, armor: 2, capacity: 50, unhousedResidents: 50, populationGrowth: 0,
    governorPermissions: { farms: false, housing: false }, governorNextPlanAt: 1e9 };
  state.buildings.push(palace);
  for (let parcel = 0; parcel < 10; parcel++) {
    const x = bx + 3 + parcel % 5 * 3, y = by + (parcel < 5 ? 3 : 16);
    const farm = { id: id++, kind: 'camp', x, y, faction: 0, hp: 100, maxHp: 100, capacity: 0 };
    state.buildings.push(farm);
    const expiresAt = state.time + 11;
    state.fields.push({ id: farm.id, camp: farm.id, faction: 0, x, y, planted: true, food: 1,
      foodBatches: [{ amount: 1, expiresAt }], expiresAt,
      nextHarvest: state.time + 20 + (city * 10 + parcel) % 60, harvestStaggered: true });
    state.world.tiles[y * state.world.width + x].farm = 0;
    state.units.push({ ...worker(id++, palace.id, palace.x + 1, palace.y + 1),
      collector: true, collectorCamp: farm.id, inside: true, cargo: 0, collectPhase: 'idle' });
    const sy = by + (parcel < 5 ? 6 : 13), builderId = id++, siteId = id++;
    // A real assigned construction job, long enough to survive the replay.
    state.buildings.push({ id: siteId, kind: 'house', x, y: sy, faction: 0,
      hp: 160, maxHp: 160, capacity: 4, houseLevel: 1,
      construction: { startedAt: 0, duration: 120, builderId,
        waitingForBuilder: false, cleared: true, researchSpeed: 1 } });
    state.units.push({ ...worker(builderId, palace.id, x + .5, sy - .5),
      builder: true, inside: false, buildPhase: 'working', buildSite: siteId });
  }
}
state.buildings.push({ id: id++, kind: 'palace', x: 202, y: 202, faction: 1,
  hp: 650, maxHp: 650, armor: 2, capacity: 0, unhousedResidents: 0, populationGrowth: 0,
  governorPermissions: { farms: false, housing: false }, governorNextPlanAt: 1e9 });
assert.equal(state.units.filter(unit => unit.kind === 'worker').length, 2000);
assert.equal(state.units.filter(unit => unit.builder && !unit.inside).length, 1000);
assert.equal(state.units.filter(unit => unit.collector).length, 1000);
assert.equal(new Set([...state.units, ...state.buildings].map(entity => entity.id)).size,
  state.units.length + state.buildings.length);
write('workers-2000', state);
const viewports = {
  'hold-5000': { width: 1440, height: 900, dpr: 1.5, camera: { x: 111, y: 76 }, zoom: .8 },
  'move-1000-long': { width: 1440, height: 900, dpr: 1.5, camera: { x: 160, y: 38 }, zoom: .8 },
  'workers-2000': { width: 1440, height: 900, dpr: 1.5, camera: { x: 90, y: 90 }, zoom: 1 },
};
for (const [name, viewport] of Object.entries(viewports)) write(`${name}-viewport`, viewport);
console.log(JSON.stringify({ prepared: true, simulationExecuted: false, fixtures: Object.keys(viewports) }, null, 2));
