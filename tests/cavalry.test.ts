import { describe, expect, it } from 'vitest';
import { CAVALRY_CHARGE_COOLDOWN, CAVALRY_CHARGE_DISTANCE, recordCavalryMovement, tryCavalryCharge } from '../src/game/cavalry';
import { entityStore } from '../src/game/entity-store';
import { beginUnitFrame, endUnitFrame, nearbyUnits } from '../src/game/spatial';
import type { Building, GameState, Unit } from '../src/game/types';

const unit = (id: number, x: number, y: number, faction = 0, kind: Unit['kind'] = 'horseman'): Unit => ({ id, x, y, faction, kind,
  hp: 100, maxHp: 100, attack: 25.5, defense: 4, speed: 6.534, range: 1.1, morale: 100, order: 'follow',
  cooldown: 0, attackTime: 0, moving: true, facing: 0, lastCombat: -60 });
function fixture(): GameState {
  return { world: { width: 24, height: 16, seed: 'cavalry', source: 'test', spawns: [], revision: 0,
    tiles: Array.from({ length: 384 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5,
      food: 2, production: 1, gold: 0, variation: .5 })) }, units: [], buildings: [], factions: [],
    time: 0, tick: 0, paused: false, speed: 1, seed: 'cavalry', rngState: 1, gameOver: false, victory: false,
    events: [], particles: [], fields: [], selected: null, selectedType: null, buildMode: null, diplomacy: null };
}
function ride(state: GameState, rider: Unit, tiles = CAVALRY_CHARGE_DISTANCE, dx = 1, dy = 0): void {
  for (let n = 0; n < tiles * 4; n++) {
    const from = { x: rider.x, y: rider.y }; rider.x += dx * .25; rider.y += dy * .25; state.time += .05;
    recordCavalryMovement(state, rider, from, .05);
  }
}
function hitList() {
  const hits: { id: number; multiplier: number }[] = [];
  return { hits, combat: { hostile: (a: number, b: number) => a !== b, clear: () => true,
    hit: (target: Unit | Building, multiplier: number) => { hits.push({ id: target.id, multiplier }); target.hp -= 10 * multiplier; } } };
}

describe('horseman running charge', () => {
  it.each(['knight', 'horseArcher'] as const)('allows only melee cavalry to charge: %s', kind => {
    const state = fixture(), rider = unit(1, 2.5, 5.5, 0, kind); ride(state, rider);
    const target = unit(2, rider.x + 1, rider.y, 1);
    expect(tryCavalryCharge(state, rider, target, hitList().combat)).toBe(kind === 'knight');
  });

  it('requires three actual tiles, adds a primary bonus and damages nearby hostile units exactly once', () => {
    const state = fixture(), rider = unit(1, 2.5, 5.5), primary = unit(2, 6.5, 5.5, 1, 'warrior');
    const secondary = unit(3, 7.5, 5.5, 1, 'warrior'), ally = unit(4, 6.5, 6.5), outside = unit(5, 6.5, 7.01, 1);
    entityStore(state).units.replace([rider, primary, secondary, ally, outside]); const { hits, combat } = hitList();
    ride(state, rider, 2.75); expect(tryCavalryCharge(state, rider, primary, combat)).toBe(false);
    ride(state, rider, .25); expect(tryCavalryCharge(state, rider, primary, combat)).toBe(true);
    expect(hits).toEqual([{ id: 2, multiplier: 2 }, { id: 3, multiplier: .6 }]);
    expect({ x: primary.x, y: primary.y }).toEqual({ x: 6.5, y: 5.5 });
    expect({ x: secondary.x, y: secondary.y }).toEqual({ x: 7.5, y: 5.5 });
    expect(ally.hp).toBe(100); expect(outside.hp).toBe(100);
    expect(tryCavalryCharge(state, rider, primary, combat)).toBe(false);
  });

  it('cannot accumulate charge from blocked movement, a teleport, fleeing, or a sharp reversal', () => {
    for (const reason of ['blocked', 'teleport', 'flee', 'reverse'] as const) {
      const state = fixture(), rider = unit(1, 2.5, 5.5); ride(state, rider, 2.75);
      if (reason === 'blocked') { state.time += .5; recordCavalryMovement(state, rider, { ...rider }, .5); }
      if (reason === 'teleport') { const from = { ...rider }; rider.x += 10; state.time += .05; recordCavalryMovement(state, rider, from, .05); }
      if (reason === 'flee') { rider.order = 'flee'; ride(state, rider, 1); rider.order = 'follow'; }
      if (reason === 'reverse') ride(state, rider, .25, -1);
      const target = unit(2, rider.x + 1, rider.y, 1);
      expect(tryCavalryCharge(state, rider, target, hitList().combat), reason).toBe(false);
    }
  });

  it('expires at rest and does not charge a target behind the horse', () => {
    const state = fixture(), rider = unit(1, 2.5, 5.5); ride(state, rider);
    expect(tryCavalryCharge(state, rider, unit(2, rider.x - 1, rider.y, 1), hitList().combat)).toBe(false);
    state.time += .36;
    expect(tryCavalryCharge(state, rider, unit(2, rider.x + 1, rider.y, 1), hitList().combat)).toBe(false);
  });

  it('requires a fresh runup after the eight-second cooldown and persists that cooldown through JSON saves', () => {
    const state = fixture(), rider = unit(1, 2.5, 5.5); ride(state, rider);
    expect(tryCavalryCharge(state, rider, unit(2, 6.5, 5.5, 1), hitList().combat)).toBe(true);
    const saved = JSON.parse(JSON.stringify(rider)) as Unit;
    ride(state, saved, 3); expect(tryCavalryCharge(state, saved, unit(2, saved.x + 1, saved.y, 1), hitList().combat)).toBe(false);
    state.time += CAVALRY_CHARGE_COOLDOWN;
    ride(state, saved, 3); expect(tryCavalryCharge(state, saved, unit(2, saved.x + 1, saved.y, 1), hitList().combat)).toBe(true);
  });

  it('never splashes across blocked contact, onto allies, hidden/dead units or the primary twice', () => {
    const state = fixture(), rider = unit(1, 2.5, 5.5); ride(state, rider);
    const primary = unit(2, 6.5, 5.5, 1), blocked = unit(3, 6.5, 6.5, 1), dead = { ...unit(4, 6.5, 6), hp: 0 },
      inside = { ...unit(5, 6.5, 5, 1), inside: true };
    entityStore(state).units.replace([rider, primary, blocked, dead, inside]); const { hits, combat } = hitList(); combat.clear = () => false;
    expect(tryCavalryCharge(state, rider, primary, combat)).toBe(true); expect(hits).toEqual([{ id: 2, multiplier: 2 }]);
  });

  it('rechecks allegiance and life after a primary hit captures a settlement', () => {
    const state = fixture(), rider = unit(1, 2.5, 5.5); ride(state, rider);
    const primary: Building = { id: 2, kind: 'house', faction: 1, x: 6, y: 5, hp: 10, maxHp: 10, capacity: 4 };
    const converted = unit(3, 6.5, 6.5, 1), dead = unit(4, 7.5, 5.5, 1);
    entityStore(state).units.replace([rider, converted, dead]); const hits: number[] = [];
    expect(tryCavalryCharge(state, rider, primary, { hostile: (a, b) => a !== b, clear: () => true,
      hit: target => { hits.push(target.id); converted.faction = 0; dead.hp = 0; } })).toBe(true);
    expect(hits).toEqual([2]); expect(converted.hp).toBe(100); expect(converted.x).toBe(6.5); expect(converted.y).toBe(6.5);
    expect(dead.x).toBe(7.5);
  });

  it('preserves struck units’ positions, spatial membership and movement paths', () => {
    const state = fixture(), rider = unit(1, 2.5, 5.5), primary = unit(2, 6.5, 5.5, 1, 'warrior'), secondary = unit(3, 7.5, 5.5, 1);
    entityStore(state).units.replace([rider, primary, secondary]); ride(state, rider);
    const targets = [primary, secondary];
    for (const target of targets) {
      target.path = [{ x: target.x, y: 4.5 }]; target.pathGoal = { x: target.x, y: 4.5 }; target.repathAt = 10;
    }
    const before = targets.map(target => ({ position: { x: target.x, y: target.y }, path: target.path, pathGoal: target.pathGoal }));
    beginUnitFrame(state);
    try {
      expect(tryCavalryCharge(state, rider, primary, hitList().combat)).toBe(true);
      for (const [index, target] of targets.entries()) {
        expect({ x: target.x, y: target.y }).toEqual(before[index].position);
        expect(nearbyUnits(state, before[index].position, .01)).toContain(target);
        expect(target.path).toBe(before[index].path); expect(target.pathGoal).toBe(before[index].pathGoal);
        expect(target.repathAt).toBe(10);
      }
    } finally { endUnitFrame(state); }
  });
});
