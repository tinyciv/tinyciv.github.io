import { farmWorkGroups } from '../src/game/farm-work-groups';
import { ensureBuilders } from '../src/game/builders';
import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { createGame, getLeader, migrateGame, moveUnit, updateGame } from '../src/game/simulation';
import { ensureCollectors, fieldHarvestFood, FIELD_HARVEST_FOOD, FIELD_HARVEST_SECONDS, FIELD_SPOIL_SECONDS, synchronizeFarms, updateCollector, updateHarvests } from '../src/game/farms';
import { type GameState, type World, tileAt } from '../src/game/types';
import { buildingBlockers, canWalk } from '../src/game/pathfinding';
import { startConstruction } from '../src/game/structures';

const idle = { up: false, down: false, left: false, right: false };
function realm(): GameState {
  const world: World = {
    width: 40, height: 30, seed: 'food-couriers', source: 'farming fixture', spawns: [{ x: 10, y: 10 }],
    tiles: Array.from({ length: 1200 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .7, food: 2, production: 2, gold: 1, variation: .5 })),
  };
  const state = createGame(world);
  entityStore(state).units.replace(state.units.filter(unit => unit.marauderPack === undefined));
  state.marauderPacks = []; state.raiderCamps = [];
  // Food-delivery fixtures isolate settlement routes from newly generated raider forts.
  const camps = new Set(state.buildings.filter(b => b.faction === 0 && b.kind === 'camp').slice(0, 2).map(b => b.id));
  entityStore(state).buildings.replace(state.buildings.filter(b => b.faction === 0 && (b.kind !== 'camp' || camps.has(b.id))));
  entityStore(state).units.replace(state.units.filter(unit => unit.faction === 0));
  state.factions[0].population = 5;
  state.fields = [];
  for (const tile of world.tiles) delete tile.farm;
  synchronizeFarms(state); ensureBuilders(state); ensureCollectors(state);
  return state;
}
function advance(state: GameState, seconds: number): void {
  for (let remaining = seconds; remaining > 1e-6; remaining -= .1) updateGame(state, Math.min(.1, remaining), idle);
}

describe('compact farmland and food deliveries', () => {
  it('grows one plot per farm without housing residents and keeps the middle passable', () => {
    const state = realm();
    const camps = state.buildings.filter(building => building.kind === 'camp');
    expect(camps.map(camp => [camp.capacity, camp.residents])).toEqual([[0, 0], [0, 0]]);
    expect(state.fields).toHaveLength(2);
    expect(new Set(state.fields!.map(field => `${field.x},${field.y}`)).size).toBe(2);
    for (const camp of camps) {
      const fields = state.fields!.filter(field => field.camp === camp.id);
      expect(fields).toHaveLength(1);
      expect(fields.every(field => field.planted)).toBe(true);
      expect(fields.every(field => Math.max(Math.abs(field.x - camp.x), Math.abs(field.y - camp.y)) <= 1)).toBe(true);
      expect(fields.some(field => field.x === camp.x && field.y === camp.y)).toBe(true);
      expect(canWalk(state, camp.x + .5, camp.y + .5, 0)).toBe(true);
      expect(buildingBlockers(state, 0).has(camp.y * state.world.width + camp.x)).toBe(false);
    }
    state.factions[0].population = 2;
    synchronizeFarms(state);
    expect(state.fields!.filter(field => field.planted)).toHaveLength(2);
    expect(camps.every(camp => camp.capacity === 0 && camp.residents === 0)).toBe(true);
    expect(state.buildings.filter(building => building.kind === 'house').reduce((sum, house) => sum + (house.residents ?? 0), 0)).toBe(2);
    expect(state.units.filter(unit => unit.kind === 'worker').every(unit => unit.inside && !unit.work)).toBe(true);
  });

  it('keeps incomplete camps empty and creates their fields only when ready', () => {
    const state = realm(), camp = state.buildings.find(building => building.kind === 'camp')!;
    startConstruction(camp, 0, state);
    synchronizeFarms(state);
    ensureCollectors(state);
    expect(camp.residents).toBe(0);
    expect(state.fields!.some(field => field.camp === camp.id)).toBe(false);
    expect(state.units.some(unit => unit.collectorCamp === camp.id)).toBe(false);
    advance(state, 15);
    expect(camp.construction).toBeUndefined();
    expect(state.fields!.filter(field => field.camp === camp.id)).toHaveLength(1);
    expect(state.fields!.filter(field => field.camp === camp.id).every(field => field.nextHarvest >= 3.75 + FIELD_HARVEST_SECONDS - 1e-5)).toBe(true);
    const parcel = farmWorkGroups(state).byCamp.get(camp.id);
    expect(state.units.filter(unit => unit.collector && farmWorkGroups(state).byCamp.get(unit.collectorCamp!) === parcel)).toHaveLength(1);
  });

  it('retires farm allocations when the city has no residents', () => {
    const state = realm(), camps = state.buildings.filter(building => building.kind === 'camp');
    const initialIds = state.units.filter(unit => unit.collector).map(unit => unit.id);
    expect(initialIds).toHaveLength(farmWorkGroups(state).groups.filter(group => group.faction === 0).length);
    state.factions[0].population = 0;
    synchronizeFarms(state);
    for (let step = 0; step < 5; step++) ensureCollectors(state);
    expect(state.fields!.every(field => field.planted)).toBe(true);
    expect(state.units.filter(unit => unit.collector)).toHaveLength(0);
    expect(state.units.filter(unit => unit.collector).every(unit => unit.inside)).toBe(true);
  });

  it('collects ripe bags with a stable, population-funded workforce', () => {
    const state = realm(), food = state.factions[0].food;
    const collectorIds = state.units.filter(unit => unit.collector).map(unit => unit.id);
    for (const field of state.fields!) { field.food = 3; field.nextHarvest = 1000; }
    let loaded = false;
    for (let step = 0; step < 250; step++) {
      advance(state, .1);
      const collectors = state.units.filter(unit => unit.collector);
      expect(collectors.map(unit => unit.id)).toEqual(collectorIds);
      for (const collector of collectors) {
        if (collector.field !== undefined) expect(state.fields!.find(field => field.id === collector.field)?.claimedBy).toBe(collector.id);
        if ((collector.cargo ?? 0) > 0) loaded = true;
      }
    }
    expect(loaded).toBe(true);
    expect(state.fields!.every(field => field.food === 0)).toBe(true);
    expect(state.factions[0].food).toBeCloseTo(food + 6, 8);
    expect(state.units.filter(unit => unit.collector).every(unit => unit.inside)).toBe(true);
  });

  it('prunes surplus saved couriers, returns their cargo to bags, and clears their references', () => {
    const state = realm(), courier = state.units.find(unit => unit.collector)!, field = state.fields!.find(field => field.camp === courier.collectorCamp)!;
    const surplus = { ...courier, id: 9001, inside: false, cargo: 7, cargoField: field.id, field: field.id, collectPhase: 'outbound' as const };
    entityStore(state).units.add(surplus);
    field.claimedBy = surplus.id;
    const leader = getLeader(state)!; leader.target = surplus.id;
    state.selected = surplus.id; state.selectedType = 'unit';
    state.projectiles = [{ x: 0, y: 0, start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, attacker: leader.id, target: surplus.id, faction: 0, damage: 1, elapsed: 0, duration: 1 }];
    const food = state.factions[0].food;
    ensureCollectors(state);
    expect(state.units.filter(unit => unit.collector)).toHaveLength(1);
    expect(state.units.some(unit => unit.id === surplus.id)).toBe(false);
    expect(field.food).toBe(7); expect(field.claimedBy).toBeUndefined();
    expect(state.factions[0].food).toBe(food);
    expect(leader.target).toBeUndefined(); expect(state.selected).toBe(leader.id);
    expect(state.projectiles).toHaveLength(0);
    ensureCollectors(state);
    expect(field.food).toBe(7);
  });

  it('replaces a dead courier once and retires workers when their camps disappear', () => {
    const state = realm(), courier = state.units.find(unit => unit.collector)!;
    const campId = courier.collectorCamp, field = state.fields!.find(field => field.camp === campId)!;
    courier.hp = 0; courier.field = field.id; courier.collectPhase = 'outbound'; field.claimedBy = courier.id;
    ensureCollectors(state); ensureCollectors(state);
    const replacements = state.units.filter(unit => unit.collectorCamp === campId);
    expect(replacements).toHaveLength(1); expect(replacements[0].id).not.toBe(courier.id);
    expect(field.claimedBy).toBeUndefined();
    entityStore(state).buildings.replace(state.buildings.filter(building => building.id !== campId));
    synchronizeFarms(state); ensureCollectors(state);
    expect(state.units.some(unit => unit.collectorCamp === campId)).toBe(false);
    expect(state.units.filter(unit => unit.collector)).toHaveLength(1);
    entityStore(state).buildings.replace(state.buildings.filter(building => building.kind !== 'camp'));
    synchronizeFarms(state); ensureCollectors(state);
    expect(state.units.filter(unit => unit.collector)).toHaveLength(0);
  });

  it('staffs a captured camp with its new faction and collects no foreign bags', () => {
    const state = realm(), camp = state.buildings.find(building => building.kind === 'camp')!;
    state.factions.push({ ...state.factions[0], id: 1, relation: 'peace' });
    entityStore(state).buildings.add({ id: 9001, kind: 'palace', faction: 1, x: 32, y: 20, hp: 1000, maxHp: 1000, capacity: 0 });
    const oldCourier = state.units.find(unit => unit.collectorCamp === camp.id)!;
    camp.faction = 1;
    synchronizeFarms(state); ensureCollectors(state);
    const assigned = state.units.filter(unit => unit.collectorCamp === camp.id);
    expect(assigned).toHaveLength(1); expect(assigned[0].faction).toBe(1); expect(assigned[0].home).toBe(9001);
    if (state.units.includes(oldCourier)) {
      expect(oldCourier.faction).toBe(0);
      expect(state.buildings.find(building => building.id === oldCourier.collectorCamp)?.faction).toBe(0);
    }
    expect(state.units.filter(unit => unit.collector)).toHaveLength(2);
  });

  it('assigns the nearest reachable palace instead of one enclosed by walls', () => {
    const state = realm(), palace = state.buildings.find(building => building.kind === 'palace')!;
    entityStore(state).buildings.add({ id: 9001, kind: 'palace', faction: 0, x: 32, y: 20, hp: 1000, maxHp: 1000, capacity: 4, unhousedResidents: 3 });
    entityStore(state).buildings.replace(state.buildings.filter(building => building.kind !== 'road'));
    state.factions[0].population += 3;
    let id = 9100;
    for (let y = palace.y - 1; y <= palace.y + 2; y++) for (let x = palace.x - 1; x <= palace.x + 2; x++) {
      if (x !== palace.x - 1 && x !== palace.x + 2 && y !== palace.y - 1 && y !== palace.y + 2) continue;
      entityStore(state).buildings.add({ id: id++, kind: 'wall', faction: 0, x, y, hp: 450, maxHp: 450, capacity: 0 });
    }
    ensureCollectors(state);
    expect(state.units.filter(unit => unit.collector).every(unit => unit.home === 9001)).toBe(true);
    expect(state.units.filter(unit => unit.collector)).toHaveLength(1);
  });

  it('preserves bag food while a cramped farm is suppressed, and returns it to a field when space opens', () => {
    const state = realm(), camp = state.buildings.find(building => building.kind === 'camp')!;
    const field = state.fields!.find(field => field.camp === camp.id)!; field.food = 9;
    camp.farmSuppressed = true;
    synchronizeFarms(state); ensureCollectors(state);
    expect(state.fields!.some(field => field.camp === camp.id)).toBe(false);
    expect(camp.storedFood).toBe(9);
    // Suppressed ground has no parcel job until its plot becomes available.
    expect(state.units.filter(unit => unit.collectorCamp === camp.id)).toHaveLength(0);
    camp.farmSuppressed = false;
    synchronizeFarms(state);
    expect(state.fields!.filter(field => field.camp === camp.id).reduce((food, field) => food + field.food, 0)).toBe(9);
    expect(camp.storedFood).toBeUndefined();
  });

  it('harvests the improved yield every60 seconds without crediting stores or dispatching workers early', () => {
    const state = realm(), food = state.factions[0].food;
    for (const field of state.fields!) field.nextHarvest = 60;
    state.time = 30; updateHarvests(state);
    expect(state.fields!.every(field => field.food === 0)).toBe(true);
    state.time = 59.99; updateHarvests(state);
    expect(state.fields!.every(field => field.food === 0)).toBe(true);
    state.time = Math.max(...state.fields!.map(field => field.nextHarvest)); updateHarvests(state);
    const produced = state.fields!.reduce((sum, field) => sum + field.food, 0);
    expect(state.fields!.every(field => field.food === FIELD_HARVEST_FOOD && field.nextHarvest === 120)).toBe(true);
    expect(state.fields!.every(field => field.expiresAt === 60 + FIELD_SPOIL_SECONDS)).toBe(true);
    state.time = 90; updateHarvests(state);
    expect(state.fields!.every(field => field.food === 0 && field.nextHarvest === 120)).toBe(true);
    // Keep the fixture cultivated while isolating harvest timing from farm inactivity.
    for (const farm of state.buildings.filter(building => building.kind === 'camp')) farm.farmLastVisitedAt = state.time;
    state.time = 120; updateHarvests(state);
    expect(state.fields!.every(field => field.food === FIELD_HARVEST_FOOD && field.nextHarvest === 180)).toBe(true);
    expect(produced + state.fields!.reduce((sum, field) => sum + field.food, 0)).toBeCloseTo(state.fields!.length * 2 * FIELD_HARVEST_FOOD);
    expect(state.factions[0].food).toBe(food);
    expect(state.units.filter(unit => unit.kind === 'worker').every(unit => unit.inside)).toBe(true);
  });

  it('grows one quarter as much food on desert, including multiple overdue harvests', () => {
    const state = realm(), [desert, fertile] = state.fields!.filter(field => field.planted);
    const food = state.factions[0].food;
    for (const field of state.fields!) field.nextHarvest = 1000;
    tileAt(state.world, desert.x, desert.y)!.terrain = 'desert';
    desert.nextHarvest = fertile.nextHarvest = FIELD_HARVEST_SECONDS;
    expect(fieldHarvestFood(state.world, desert.x, desert.y)).toBe(FIELD_HARVEST_FOOD / 4);
    expect(fieldHarvestFood(state.world, fertile.x, fertile.y)).toBe(FIELD_HARVEST_FOOD);
    state.time = FIELD_HARVEST_SECONDS; updateHarvests(state);
    expect(desert.food).toBe(FIELD_HARVEST_FOOD / 4); expect(fertile.food).toBe(FIELD_HARVEST_FOOD);
    for (const farm of state.buildings.filter(building => building.kind === 'camp')) farm.farmLastVisitedAt = FIELD_HARVEST_SECONDS * 2;
    state.time = FIELD_HARVEST_SECONDS * 3; updateHarvests(state);
    // Earlier batches have spoiled; only the latest harvest remains.
    expect(desert.food).toBeCloseTo(FIELD_HARVEST_FOOD / 4); expect(fertile.food).toBeCloseTo(FIELD_HARVEST_FOOD);
    expect(desert.nextHarvest).toBe(FIELD_HARVEST_SECONDS * 4); expect(fertile.nextHarvest).toBe(FIELD_HARVEST_SECONDS * 4);
    expect(state.factions[0].food).toBe(food);
  });

  it('keeps both fertile and desert plots planted while population changes', () => {
    const state = realm(), camp = state.buildings.find(building => building.kind === 'camp')!;
    const fields = state.fields!.filter(field => field.camp === camp.id), ids = fields.map(field => field.id).sort();
    for (const field of fields) tileAt(state.world, field.x, field.y)!.terrain = 'desert';
    tileAt(state.world, camp.x, camp.y)!.terrain = 'grassland';
    fields[0].food = .75;
    state.factions[0].population = 1;
    synchronizeFarms(state);
    expect(state.fields!.filter(field => field.camp === camp.id && field.planted)).toHaveLength(1);
    expect(state.fields!.filter(field => field.camp === camp.id).map(field => field.id).sort()).toEqual(ids);
    expect(fields[0].food).toBe(.75);
    expect(fields.reduce((food, field) => food + fieldHarvestFood(state.world, field.x, field.y), 0)).toBeCloseTo(FIELD_HARVEST_FOOD);
    const deadlines = state.fields!.map(field => [field.id, field.nextHarvest]);
    state.factions[0].population = 0;
    synchronizeFarms(state);
    expect(state.fields!.map(field => [field.id, field.nextHarvest])).toEqual(deadlines);
    expect(fields.every(field => field.planted)).toBe(true);
  });

  it('keeps a fractional desert harvest intact through collection and palace delivery', () => {
    const state = realm(), field = state.fields!.find(field => field.planted)!;
    // Neighboring wheat shares a crop clock; only this plot is eligible to yield.
    for (const plot of state.fields!) { plot.nextHarvest = 0; plot.wheatYieldAfter = 1000; }
    tileAt(state.world, field.x, field.y)!.terrain = 'desert';
    field.wheatYieldAfter = 0;
    const food = state.factions[0].food;
    updateHarvests(state);
    expect(field.food).toBe(FIELD_HARVEST_FOOD / 4);
    advance(state, .2);
    const collector = state.units.find(unit => unit.field === field.id)!;
    expect(collector).toBeDefined();
    for (let step = 0; step < 200 && !collector.cargo; step++) advance(state, .1);
    expect(collector.cargo).toBe(FIELD_HARVEST_FOOD / 4); expect(field.food).toBe(0);
    expect(state.factions[0].food).toBe(food);
    for (let step = 0; step < 200 && !collector.inside; step++) advance(state, .1);
    expect(collector.inside).toBe(true); expect(collector.cargo).toBe(0);
    expect(state.factions[0].food).toBe(food + FIELD_HARVEST_FOOD / 4);
  });

  it('ripens a connected crop block together and uses one shared peasant to sweep it', () => {
    const state = realm(), camps = state.buildings.filter(building => building.kind === 'camp');
    const starts = camps.map(camp => state.fields!.find(field => field.camp === camp.id)!.nextHarvest);
    expect(starts[0]).toBe(starts[1]);
    expect(starts.every(time => time >= FIELD_HARVEST_SECONDS && time < FIELD_HARVEST_SECONDS * 2)).toBe(true);
    const collector = state.units.find(unit => unit.collector)!, food = state.factions[0].food;
    const active = new Set<number>();
    for (state.time = starts[0]; state.time < starts[0] + FIELD_SPOIL_SECONDS; state.time += .1) {
      updateHarvests(state); ensureCollectors(state);
      for (const unit of state.units.filter(unit => unit.collector)) {
        updateCollector(state, unit, .1, moveUnit);
        if (!unit.inside) active.add(unit.id);
      }
    }
    expect(active).toEqual(new Set([collector.id]));
    expect(state.factions[0].food).toBeCloseTo(food + 2 * FIELD_HARVEST_FOOD);
    expect(collector.inside).toBe(true);
    expect(state.units.filter(unit => unit.collector)).toHaveLength(1);
    expect(realm().fields!.map(field => field.nextHarvest)).toEqual(starts.flatMap((start, index) =>
      state.fields!.filter(field => field.camp === camps[index].id).map(() => start)));
  });

  it('walks from the palace, picks up a bag, and credits it only upon returning', () => {
    const state = realm(), field = state.fields![0], player = state.factions[0];
    field.food = 3;
    const originalFood = player.food;
    advance(state, .2);
    const collector = state.units.find(unit => unit.field === field.id)!;
    expect(collector).toBeDefined(); expect(collector.inside).toBe(false);
    const palace = state.buildings.find(building => building.id === collector.home)!;
    expect(palace.kind).toBe('palace');
    for (let step = 0; step < 200 && !collector.cargo; step++) advance(state, .1);
    expect(collector.cargo).toBe(3); expect(field.food).toBe(0);
    expect(player.food).toBe(originalFood);
    for (let step = 0; step < 200 && !collector.inside; step++) advance(state, .1);
    expect(collector.inside).toBe(true); expect(collector.cargo).toBe(0);
    expect(player.food).toBe(originalFood + 3);
    expect(player.population).toBe(5);
  });

  it('chooses another palace entrance when a holding warrior occupies its return destination', () => {
    const state = realm(), field = state.fields![0], player = state.factions[0];
    const guard = state.units.find(unit => unit.kind === 'warrior')!;
    guard.order = 'hold';
    field.food = 3;
    const food = player.food;
    advance(state, .2);
    const collector = state.units.find(unit => unit.field === field.id)!;
    for (let step = 0; step < 200 && !collector.cargo; step++) advance(state, .1);
    expect(collector.cargo).toBe(3);
    const entrance = { ...collector.destination! };
    expect(entrance.x).toBeTypeOf('number');
    guard.x = entrance.x; guard.y = entrance.y;
    advance(state, 12);
    expect(collector.inside).toBe(true);
    expect(player.food).toBe(food + 3);
    expect({ x: guard.x, y: guard.y }).toEqual(entrance);
  });

  it('collects through a diagonal corner without jittering against a nearby guard', () => {
    const state = realm(), palace = state.buildings.find(building => building.kind === 'palace')!;
    const camp = state.buildings.find(building => building.kind === 'camp')!;
    const guard = state.units.find(unit => unit.kind === 'warrior')!;
    const leader = getLeader(state)!;
    entityStore(state).buildings.replace([palace, camp]);
    entityStore(state).units.replace(state.units.filter(unit => unit.collector || unit.id === guard.id || unit.id === leader.id));
    state.factions[0].population = 2; // One builder and one courier share the two residents.
    Object.assign(camp, { x: palace.x + 3, y: palace.y + 2 });
    Object.assign(guard, { x: palace.x + 2.1, y: palace.y + 2.27, order: 'hold' });
    Object.assign(leader, { x: 30.5, y: 25.5 });
    entityStore(state).buildings.add({ id: 1000, kind: 'tower', faction: 0, x: palace.x + 3, y: palace.y + 1, hp: 1200, maxHp: 1200, capacity: 0 });
    synchronizeFarms(state);
    const field = state.fields!.find(field => field.x === palace.x + 3 && field.y === palace.y + 2)!;
    field.food = 3;
    const food = state.factions[0].food;
    advance(state, 8);
    expect(field.food).toBe(0);
    expect(state.factions[0].food).toBe(food + 3);
    expect(state.units.filter(unit => unit.collector).every(unit => unit.inside)).toBe(true);
    expect(guard.x).toBe(palace.x + 2.1);
    expect(guard.y).toBe(palace.y + 2.27);
  });

  it('walks toward a bag beside another peasant and collects it once the pickup point is clear', () => {
    const state = realm(), field = state.fields![0];
    const guard = state.units.find(unit => unit.kind === 'warrior')!;
    entityStore(state).setUnitRole(guard, { kind: 'worker' }); guard.order = 'work'; guard.x = field.x + .5; guard.y = field.y + .5;
    field.food = 3;
    advance(state, 1);
    const courier = state.units.find(unit => unit.collector && unit.field === field.id)!;
    expect(courier).toBeDefined(); expect(courier.inside).toBe(false);
    expect(field.food).toBe(3);
    advance(state, 8);
    expect(Math.hypot(courier.x-guard.x,courier.y-guard.y)).toBeGreaterThanOrEqual(.28-1e-5);
    guard.x = 25.5; guard.y = 25.5;
    advance(state, 8);
    expect(field.food).toBe(0);
    expect(courier.inside).toBe(true);
  });

  it('leaves food behind an impassable wall instead of teleporting or crediting it', () => {
    const state = realm(), palace = state.buildings.find(building => building.kind === 'palace')!;
    entityStore(state).units.replace(state.units.filter(unit => unit.kind !== 'warrior'));
    const leader = getLeader(state)!;
    leader.x = palace.x + .5; leader.y = palace.y - .5;
    entityStore(state).buildings.replace(state.buildings.filter(building => building.kind !== 'road'));
    let id = 10000;
    for (let y = palace.y - 1; y <= palace.y + 2; y++) for (let x = palace.x - 1; x <= palace.x + 2; x++) {
      if (x !== palace.x - 1 && x !== palace.x + 2 && y !== palace.y - 1 && y !== palace.y + 2) continue;
      entityStore(state).buildings.add({ id: id++, kind: 'wall', faction: 0, x, y, hp: 450, maxHp: 450, capacity: 0 });
    }
    const field = state.fields![0]; field.food = 9;
    const food = state.factions[0].food;
    advance(state, 10);
    expect(field.food).toBe(9);
    expect(state.factions[0].food).toBe(food);
    expect(state.units.filter(unit => unit.kind === 'worker').every(unit => unit.inside)).toBe(true);
  });

  it('preserves bags, harvest timing and couriers in transit across save migration', () => {
    const state = realm(), field = state.fields![0];
    field.food = 7; advance(state, .2);
    const collector = state.units.find(unit => unit.field === field.id)!;
    const restored = migrateGame(JSON.parse(JSON.stringify(state)) as GameState);
    expect(restored.fields!.find(other => other.id === field.id)?.food).toBe(7);
    expect(restored.fields!.find(other => other.id === field.id)?.nextHarvest).toBe(field.nextHarvest);
    expect(restored.units.find(unit => unit.id === collector.id)?.collectPhase).toBe('outbound');
    expect(restored.units.find(unit => unit.id === collector.id)?.inside).toBe(false);
    expect(restored.factions[0].food).toBe(state.factions[0].food);
    advance(restored, 12);
    expect(restored.factions[0].food).toBe(state.factions[0].food + 7);
  });

  it('keeps a single crop tile usable beside rivers, lakes and buildings', () => {
    const state = realm(), camp = state.buildings.find(building => building.kind === 'camp')!;
    tileAt(state.world, camp.x, camp.y + 1)!.terrain = 'river';
    tileAt(state.world, camp.x + 1, camp.y)!.terrain = 'lake';
    entityStore(state).buildings.add({ id: 9999, kind: 'tower', faction: 0, x: camp.x - 1, y: camp.y, hp: 1200, maxHp: 1200, capacity: 0 });
    synchronizeFarms(state);
    const fields = state.fields!.filter(field => field.camp === camp.id);
    expect(fields).toHaveLength(1);
    expect(fields).toContainEqual(expect.objectContaining({ x: camp.x, y: camp.y }));
    expect(fields.every(field => field.x !== camp.x || field.y !== camp.y + 1)).toBe(true);
    expect(fields.every(field => field.x !== camp.x + 1 || field.y !== camp.y)).toBe(true);
    expect(fields.every(field => field.x !== camp.x - 1 || field.y !== camp.y)).toBe(true);
    ensureCollectors(state);
    expect(state.factions[0].population).toBe(5);
  });
});
