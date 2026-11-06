import { beforeAll, describe, expect, it } from 'vitest';
import { createGame, migrateGame, setRetinueOrder } from '../src/game/simulation';
import { type GameState, unitMaxHp } from '../src/game/types';
import { retinueCommand, toggleRetinueOrder } from '../src/ui/retinue-controls';
import { updateFogRaids } from '../src/game/fog-raids';

let initial: GameState;
beforeAll(() => {
  initial = createGame({ width: 60, height: 40, seed: 'health-orders', source: 'test',
    spawns: [{ x: 12.5, y: 18.5 }, { x: 46.5, y: 22.5 }],
    tiles: Array.from({ length: 2400 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
      moisture: .5, food: 2, production: 2, gold: 1, variation: .5 })) });
});
const fixture = (): GameState => structuredClone(initial);

describe('unit health and visible retinue controls', () => {
  it('starts every unit at its own full health, with 50 HP peasants', () => {
    expect(initial.units.some(unit => unit.marauderPack !== undefined)).toBe(true);
    expect(initial.units.some(unit => unit.kind === 'worker')).toBe(true);
    for (const unit of initial.units) {
      expect(unit.hp / unitMaxHp(unit)).toBe(1);
      if (unit.kind === 'worker') expect(unit.hp).toBe(unit.villageId === undefined ? 50 : 45);
    }
  });

  it('halves legacy peasant health once, retaining their injury ratio', () => {
    const state = fixture(), worker = state.units.find(unit => unit.kind === 'worker')!;
    delete worker.maxHp; worker.hp = 60;
    migrateGame(state);
    expect(worker).toMatchObject({ hp: 30, maxHp: 50 });
    migrateGame(state);
    expect(worker).toMatchObject({ hp: 30, maxHp: 50 });
  });

  it('retains explicitly recorded raider maxima without healing their wounds', () => {
    const state = fixture(); state.time = state.fogRaids!.nextAt; updateFogRaids(state);
    const raider = state.units.find(unit => !unit.marauderLeader && state.marauderPacks?.some(pack => pack.raid && pack.id === unit.marauderPack))!;
    expect(raider.hp).toBe(raider.maxHp);
    const maximum = raider.maxHp!;
    raider.hp = maximum / 2;
    migrateGame(state);
    expect(raider.maxHp).toBe(maximum);
    expect(raider.hp / unitMaxHp(raider)).toBe(.5);
  });

  it('cycles all three retinue stances with the Leader selected, clearing movement orders', () => {
    const state = fixture(), soldiers = state.units.filter(unit => unit.faction === 0 && unit.kind === 'warrior');
    state.selected = state.units.find(unit => unit.faction === 0 && unit.kind === 'leader')!.id;
    state.selectedType = 'unit';
    soldiers[0].destination = { x: 20, y: 20 }; soldiers[0].moving = true;
    toggleRetinueOrder(state);
    expect(soldiers.every(unit => unit.retinueStance === 'defensive' && !unit.destination && !unit.moving)).toBe(true);
    expect(retinueCommand(state).nextStance).toBe('hold');
    toggleRetinueOrder(state);
    expect(soldiers.every(unit => unit.order === 'hold' && unit.retinueStance === 'hold')).toBe(true);
    toggleRetinueOrder(state);
    expect(soldiers.every(unit => unit.order === 'follow')).toBe(true);
    expect(retinueCommand(state).stance).toBe('aggressive');
  });

  it('commands the whole retinue with a warrior selected and preserves routed orders', () => {
    const state = fixture(), soldiers = state.units.filter(unit => unit.faction === 0 && unit.kind === 'warrior');
    state.selected = soldiers[0].id; state.selectedType = 'unit';
    toggleRetinueOrder(state);
    expect(soldiers.every(unit => unit.retinueStance === 'defensive')).toBe(true);
    soldiers[0].order = 'flee'; soldiers[0].routOrder = 'hold';
    setRetinueOrder(state, 'follow', soldiers[0].id);
    expect(soldiers[0]).toMatchObject({ order: 'flee', routOrder: 'follow' });
  });
});
