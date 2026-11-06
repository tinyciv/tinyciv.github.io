import { describe, expect, it } from 'vitest';
import { unitsCollide } from '../src/game/collisions';
import { entityStore } from '../src/game/entity-store';
import { updateSupplyCart, updateSupplyDepots, SUPPLY_CART_INTERVAL } from '../src/game/supply-train';
import { dismissLevy, levyPopulation, levyStatus, recordLevyCasualty, updateMassLevy } from '../src/game/mass-levy';
import { civilianWorkforcePopulations } from '../src/game/civilian-population';
import { applyFactionEquipment } from '../src/game/blacksmith';
import { advanceInfantryFormations, toggleInfantryFormation } from '../src/game/infantry-drill';
import { retinueFormation } from '../src/game/formation';
import { isBuildingUnlocked } from '../src/game/research';
import { unitAttack, unitDefense } from '../src/game/veterancy';
import { updateGame } from '../src/game/simulation';
import { applyGameCommand } from '../src/multiplayer/commands';
import { ensureBuilders } from '../src/game/builders';
import { ensureCollectors } from '../src/game/farms';
import { type GameState, type Unit } from '../src/game/types';

const idle = { up: false, down: false, left: false, right: false };
function unit(id: number, kind: Unit['kind'] = 'worker', faction = 0): Unit {
  return { id, kind, faction, x: 12 + id % 4, y: 12 + Math.floor(id / 4) % 4, hp: 50, maxHp: 50, attack: 0, defense: 0,
    morale: 100, speed: 2.2, range: 1.1, order: kind === 'worker' ? 'work' : 'follow', cooldown: 0, lastCombat: -60,
    moving: false, facing: 0, attackTime: 0, home: 100, collector: kind === 'worker', collectorCamp: 100 };
}
function fixture(): GameState {
  return {
    world: { width: 40, height: 40, seed: 'levy-supply', source: 'test', spawns: [], tiles: Array.from({ length: 1600 }, () =>
      ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .6, food: 3, production: 1, gold: 0, variation: .5 })) },
    units: [unit(1, 'leader'), ...Array.from({ length: 9 }, (_, i) => unit(i + 2))],
    buildings: [{ id: 100, kind: 'palace', faction: 0, x: 8, y: 8, hp: 650, maxHp: 650, capacity: 30, unhousedResidents: 9, governorPermissions: { farms: false, housing: false } },
      { id: 101, kind: 'supplyDepot', faction: 0, x: 10, y: 10, hp: 200, maxHp: 200, capacity: 0 }],
    factions: [{ id: 0, name: 'Test', color: '#3988ff', affinity: 100, relation: 'self', food: 500, gold: 100, production: 0, population: 9,
      yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1e9, nextRetinueAt: 1e9, defeated: false,
      research: { focus: 'massLevy', levels: { supplyTrain: 1, massLevy: 1, infantryDrill: 1 }, progress: {} } }],
    time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'levy-supply', rngState: 1,
    fields: [], raiderCamps: [], marauderPacks: [], villages: [], fogRaids: { nextAt: 1e9, waves: 0, pressureVersion: 1 },
  };
}
const levies = (state: GameState) => state.units.filter(unit => unit.kind === 'levyInfantry');

describe('supply train', () => {
  it('drives through a friendly battle line and delivers healing in the real movement loop', () => {
    const state = fixture(), leader = state.units[0];
    Object.assign(leader, { x: 21.5, y: 12.5, hp: 20, lastDamagedAt: 0, order: 'hold' });
    const line = [200, 201, 202].map((id, i) => ({ ...unit(id, 'warrior'), x: 19.5, y: 11.5 + i,
      attack: 17, defense: 4, hp: 20, lastDamagedAt: 0, order: 'hold' as const, retinueStance: 'hold' as const }));
    entityStore(state).units.replace([leader, ...line]);
    state.buildings[1].supplyDepot = { nextDispatchAt: 0 }; updateSupplyDepots(state);
    const cart = state.units.find(unit => unit.kind === 'supplyCart')!;
    expect(unitsCollide(cart, leader)).toBe(false);
    for (let step = 0; step < 100 && !cart.supplyCart!.delivered; step++) updateGame(state, .1, idle);
    expect(cart.supplyCart!.delivered).toBe(true);
    expect(leader.hp).toBe(30);
    for (const soldier of line) expect(soldier.hp).toBe(30);
    expect(state.factions[0].population).toBe(9);
  });

  it('treats levy infantry and skirmishers as military collision bodies', () => {
    expect(unitsCollide({ kind: 'levyInfantry' }, { kind: 'levyInfantry' })).toBe(true);
    expect(unitsCollide({ kind: 'skirmisher' }, { kind: 'levyInfantry' })).toBe(true);
    expect(unitsCollide({ kind: 'supplyCart' }, { kind: 'levyInfantry' })).toBe(false);
  });

  it('requires research and dispatches one physical cart without using population', () => {
    const state = fixture(), faction = state.factions[0];
    delete faction.research!.levels.supplyTrain;
    expect(isBuildingUnlocked(faction, 'supplyDepot')).toBe(false);
    updateSupplyDepots(state); expect(state.units.some(unit => unit.kind === 'supplyCart')).toBe(false);
    faction.research!.levels.supplyTrain = 1; updateSupplyDepots(state);
    state.time = SUPPLY_CART_INTERVAL; updateSupplyDepots(state);
    const cart = state.units.find(unit => unit.kind === 'supplyCart')!;
    expect(cart).toMatchObject({ hp: 40, attack: 0, supplyCart: { depot: 101, leader: 1 } });
    state.time = 300; updateSupplyDepots(state);
    expect(state.units.filter(unit => unit.kind === 'supplyCart')).toHaveLength(1);
    expect(faction.population).toBe(9);
  });
  it('heals every living friendly unit once, never overheals, revives or heals enemies', () => {
    const state = fixture(); updateSupplyDepots(state); state.time = 30; updateSupplyDepots(state);
    const leader = state.units[0], remote = state.units[1], dead = state.units[2], full = state.units[3];
    leader.hp = 42; remote.hp = 20; remote.x = 38; remote.y = 38; dead.hp = 0;
    const enemy = unit(200, 'warrior', 1); enemy.hp = 15; entityStore(state).units.add(enemy);
    const cart = state.units.find(unit => unit.kind === 'supplyCart')!; cart.x = leader.x; cart.y = leader.y;
    updateSupplyCart(state, cart, .1, () => {});
    expect([leader.hp, remote.hp, dead.hp, full.hp, enemy.hp]).toEqual([50, 30, 0, 50, 15]);
    expect(cart).toMatchObject({ hp: 0, supplyCart: { delivered: true } });
    updateSupplyCart(state, cart, .1, () => {}); expect(remote.hp).toBe(30);
  });
  it('replaces a killed cart only on the dispatch clock, preserving population', () => {
    const state = fixture(); updateSupplyDepots(state); state.time = 30; updateSupplyDepots(state);
    state.units.find(unit => unit.kind === 'supplyCart')!.hp = 0;
    state.time = 59; updateSupplyDepots(state); expect(state.units.filter(unit => unit.kind === 'supplyCart')).toHaveLength(1);
    state.time = 60; updateSupplyDepots(state); expect(state.units.filter(unit => unit.kind === 'supplyCart')).toHaveLength(2);
    expect(state.factions[0].population).toBe(9);
  });
  it('awards no gold or population loss when a hostile projectile kills a cart in the live simulation', () => {
    const state = fixture(); updateSupplyDepots(state); state.time = 30; state.tick = 1; updateSupplyDepots(state);
    const cart = state.units.find(unit => unit.kind === 'supplyCart')!;
    const attacker = { ...unit(200, 'archer', 1), x: cart.x - 2, y: cart.y };
    entityStore(state).units.add(attacker);
    const enemy = { ...structuredClone(state.factions[0]), id: 1, relation: 'war' as const, population: 0, nextRetinueAt: 1e9 };
    state.factions.push(enemy);
    entityStore(state).buildings.add({ id: 201, kind: 'palace', faction: 1, x: 30, y: 30, hp: 650, maxHp: 650, capacity: 10, governorPermissions: { farms: false, housing: false } });
    state.projectiles = [{ x: attacker.x, y: attacker.y, start: { x: attacker.x, y: attacker.y }, end: { x: cart.x, y: cart.y },
      attacker: attacker.id, target: cart.id, faction: 1, damage: 100, duration: .01, elapsed: 0, kind: 'arrow' }];
    updateGame(state, .1, idle);
    expect(cart.hp).toBeLessThanOrEqual(0); expect(state.units.includes(cart)).toBe(false);
    expect(enemy.gold).toBe(100); expect(state.factions[0].population).toBe(9);
    expect(enemy.goldLedger?.some(entry => (entry.inputs.loot ?? 0) > 0) ?? false).toBe(false);
  });
});

describe('mass levy', () => {
  it('requires research, caps recruitment at one third and reserves the actual civilian workforce', () => {
    const state = fixture(); delete state.factions[0].research!.levels.massLevy;
    expect(levyPopulation(state).ok).toBe(false);
    state.factions[0].research!.levels.massLevy = 1;
    const ids = state.units.map(unit => unit.id);
    expect(levyPopulation(state, 9)).toMatchObject({ ok: true, count: 3 });
    expect(levyStatus(state)).toMatchObject({ active: 3, maximum: 3, available: 0, upkeep: 15, canLevy: false });
    expect(state.units.map(unit => unit.id)).toEqual(ids);
    expect(civilianWorkforcePopulations(state).get(100)).toBe(6);
    expect(state.factions[0].population).toBe(9);
  });
  it('has half warrior attack and defense at every equipment tier and an 80 morale ceiling', () => {
    const state = fixture(); levyPopulation(state, 1); const levy = levies(state)[0];
    const warrior = { ...unit(200, 'warrior'), attack: 17, defense: 4 };
    entityStore(state).units.add(warrior);
    for (const level of [0, 3, 6] as const) {
      state.factions[0].armorLevel = level; state.factions[0].weaponLevel = level; applyFactionEquipment(state, 0);
      expect(unitAttack(levy)).toBeCloseTo(unitAttack(warrior) / 2);
      expect(unitDefense(levy)).toBeCloseTo(unitDefense(warrior) / 2);
    }
    levy.morale = 100; updateMassLevy(state); expect(levy.morale).toBe(80);
  });
  it('pays every 30 seconds and routes into the original role immediately at bankruptcy', () => {
    const state = fixture(); levyPopulation(state); const roster = levies(state);
    state.time = 29.9; updateMassLevy(state); expect(state.factions[0].gold).toBe(55);
    state.time = 30; updateMassLevy(state); expect(state.factions[0].gold).toBe(40);
    state.factions[0].gold = 0; state.time = 30.1; updateMassLevy(state);
    expect(levies(state)).toHaveLength(0);
    for (const unit of roster) expect(unit).toMatchObject({ kind: 'worker', collector: true, home: 100, attack: 0, order: 'flee', routed: true });
    expect(civilianWorkforcePopulations(state).get(100)).toBe(9);
  });
  it('records levy deaths once, and dismissal does not kill population or reset damage', () => {
    const state = fixture(); levyPopulation(state); const [dead, hurt] = levies(state); dead.hp = 0; hurt.hp = 17;
    expect(recordLevyCasualty(state, dead)).toBe(true); expect(recordLevyCasualty(state, dead)).toBe(false);
    expect(state.factions[0].population).toBe(8);
    expect(dismissLevy(state).ok).toBe(true); expect(hurt).toMatchObject({ hp: 17, kind: 'worker', collector: true });
    expect(state.factions[0].population).toBe(8);
  });
  it('places levies on the wings in close ranks and ordinary rally formations', () => {
    const state = fixture(); levyPopulation(state);
    for (let id = 200; id < 206; id++) entityStore(state).units.add({ ...unit(id, 'warrior'), attack: 17, defense: 4 });
    const leader = state.units[0];
    expect(toggleInfantryFormation(state).ok).toBe(true);
    advanceInfantryFormations(state, .1, () => idle, () => {});
    const slots = leader.infantryFormation!.slots, roster = new Set(levies(state).map(unit => unit.id));
    const levySide = slots.filter(slot => roster.has(slot.id)).map(slot => Math.abs(slot.y));
    const regularSide = slots.filter(slot => !roster.has(slot.id)).map(slot => Math.abs(slot.y));
    expect(Math.min(...levySide)).toBeGreaterThanOrEqual(Math.max(...regularSide));
    leader.infantryFormation!.active = false;
    for (const unit of levies(state)) unit.joiningRetinue = false;
    const ordinary = retinueFormation(state, leader), lateral = (id: number) => Math.abs(ordinary.goals.get(id)!.y - leader.y);
    expect(Math.min(...[...roster].map(lateral))).toBeGreaterThanOrEqual(Math.max(...[...ordinary.goals.keys()].filter(id => !roster.has(id)).map(lateral)));
  });
  it('keeps archers behind regular melee while levies occupy both wings', () => {
    const state = fixture(); levyPopulation(state);
    for (let id = 200; id < 210; id++) entityStore(state).units.add({ ...unit(id, id < 204 ? 'archer' : 'warrior'),
      attack: 17, defense: 4, range: id < 204 ? 4 : 1.1 });
    const leader = state.units[0];
    const goals = retinueFormation(state, leader).goals;
    const ranged = state.units.filter(unit => unit.kind === 'archer'), regular = state.units.filter(unit => unit.kind === 'warrior');
    expect(Math.max(...ranged.map(unit => goals.get(unit.id)!.x))).toBeLessThanOrEqual(Math.min(...regular.map(unit => goals.get(unit.id)!.x)));
    const wingWidth = Math.min(...levies(state).map(unit => Math.abs(goals.get(unit.id)!.y - leader.y)));
    expect(wingWidth).toBeGreaterThanOrEqual(Math.max(...[...ranged, ...regular].map(unit => Math.abs(goals.get(unit.id)!.y - leader.y))));
  });
  it('the live simulation keeps reduced morale and demobilizes on the next insolvency sample', () => {
    const state = fixture(); levyPopulation(state, 1); const levy = levies(state)[0];
    levy.morale = 80; updateGame(state, .1, idle); expect(levy.morale).toBeLessThanOrEqual(80);
    state.factions[0].gold = 0; updateGame(state, .4, idle);
    expect(levy.kind).toBe('worker'); expect(levy.attack).toBe(0);
  });
  it('wakes sleeping workers and never duplicates residents during civilian restaffing', () => {
    const state = fixture(), worker = state.units[1], store = entityStore(state);
    worker.inside = true; store.setUnitSleeping(worker, true);
    expect(store.isUnitSleeping(worker)).toBe(true);
    levyPopulation(state); expect(worker.kind).toBe('levyInfantry');
    expect(store.isUnitSleeping(worker)).toBe(false); expect(store.units.query('active')).toContain(worker);
    ensureCollectors(state); ensureBuilders(state);
    expect(state.units.filter(unit => unit.hp > 0 && (unit.kind === 'worker' || unit.kind === 'levyInfantry')).length).toBeLessThanOrEqual(9);
    expect(state.factions[0].population).toBe(9);
  });
  it('demobilizes on the next check when ordinary upkeep exhausts the treasury between levy paydays', () => {
    const state = fixture(); state.time = 29.95; state.factions[0].gold = 21;
    for (let id = 200; id < 204; id++) entityStore(state).buildings.add({ id, kind: 'woodenTower', faction: 0,
      x: 21 + id % 4, y: 21, hp: 600, maxHp: 600, capacity: 0 });
    levyPopulation(state, 1); const levy = levies(state)[0]; expect(levy.levy!.nextUpkeepAt).toBeCloseTo(59.95);
    updateGame(state, .1, idle);
    expect(state.factions[0].gold).toBeLessThan(0);
    updateGame(state, .4, idle);
    expect(levy).toMatchObject({ kind: 'worker', attack: 0, order: 'flee', routed: true });
  });
  it('charges15 per draft, caps affordability and charges again when re-raising', () => {
    const state = fixture(); state.factions[0].gold = 45;
    expect(levyStatus(state)).toMatchObject({ available: 2, draftCost: 30 });
    expect(levyPopulation(state, 3)).toMatchObject({ ok: true, count: 2 });
    expect(state.factions[0].gold).toBe(15);
    dismissLevy(state); expect(state.factions[0].gold).toBe(15);
    expect(levyPopulation(state).ok).toBe(false);
    state.factions[0].gold = 15.1; expect(levyPopulation(state)).toMatchObject({ ok: true, count: 1 });
    expect(state.factions[0].gold).toBeCloseTo(.1);
    updateMassLevy(state); expect(levies(state)).toHaveLength(1);
  });
});

describe('authoritative mass levy commands', () => {
  function duel(): GameState {
    const state = fixture();
    state.factions.push({ ...structuredClone(state.factions[0]), id: 1, relation: 'war' });
    entityStore(state).buildings.add({ ...structuredClone(state.buildings[0]), id: 300, faction: 1, x: 28, y: 28 });
    entityStore(state).units.add({ ...unit(310, 'leader', 1), x: 26, y: 26 }, ...Array.from({ length: 9 }, (_, i) => ({ ...unit(311 + i, 'worker', 1), x: 25 + i % 3, y: 25 + Math.floor(i / 3), home: 300 })));
    state.multiplayer = { humanFactionIds: [0, 1], inputs: { 0: idle, 1: idle }, winner: null,
      controls: { 0: { retinueStance: 'defensive', movementMode: 'travel' }, 1: { retinueStance: 'defensive', movementMode: 'travel' } } };
    return state;
  }
  it.each([0, 1])('uses authenticated faction %s and ignores forged faction/unit/quantity fields', actor => {
    const state = duel(), other = 1 - actor, enemyBefore = structuredClone(state.units.filter(unit => unit.faction === other));
    expect(applyGameCommand(state, actor, { type: 'levy', faction: other, count: 9999, unitId: state.units.find(unit => unit.faction === other)!.id }).ok).toBe(true);
    expect(levies(state).filter(unit => unit.faction === actor)).toHaveLength(3);
    expect(state.units.filter(unit => unit.faction === other)).toEqual(enemyBefore);
    expect(applyGameCommand(state, other, { type: 'dismiss-levy', faction: actor }).ok).toBe(false);
    expect(levies(state)).toHaveLength(3);
    expect(applyGameCommand(state, actor, { type: 'dismiss-levy', faction: other }).ok).toBe(true);
    expect(levies(state)).toHaveLength(0);
  });
  it('rejects missing research, unavailable actors and ended games despite forged unlock fields', () => {
    const state = duel(); delete state.factions[1].research!.levels.massLevy;
    expect(applyGameCommand(state, 1, { type: 'levy', researched: true }).ok).toBe(false);
    expect(applyGameCommand(state, 9, { type: 'levy' }).ok).toBe(false);
    state.gameOver = true; expect(applyGameCommand(state, 0, { type: 'levy' }).ok).toBe(false);
    expect(levies(state)).toHaveLength(0);
  });
});
