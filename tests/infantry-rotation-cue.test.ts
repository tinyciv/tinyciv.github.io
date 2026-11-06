import { describe, expect, it } from 'vitest';
import { scoutRealm } from './helpers/scouts';
import { recordNativeFrame } from './helpers/native-renderer';
import { infantryRotationAlpha, toggleInfantryFormation } from '../src/game/infantry-drill';
import { updateGame } from '../src/game/simulation';
import { entityStore } from '../src/game/entity-store';

const idle = { up: false, down: false, left: false, right: false };

describe('formation advance direction cue', () => {
  it('renders a translucent arrow during rotation and fades after release without changing the held angle', () => {
    const state = scoutRealm(), leader = state.units[0];
    entityStore(state).units.add(...state.units.slice(1).map((unit, index) => ({ ...unit, id: 20 + index })));
    Object.assign(leader, { x: 20.5, y: 18.5, facing: 0 });
    entityStore(state).buildings.replace([{ id: 100, kind: 'palace', faction: 0, x: 2, y: 2,
      hp: 650, maxHp: 650, capacity: 4, governorPermissions: { farms: false, housing: false } }]);
    state.factions[0].research!.levels.infantryDrill = 1;
    expect(toggleInfantryFormation(state).ok).toBe(true);
    expect(recordNativeFrame(state).sprites.some(sprite => sprite.key === 'infantry-advance-arrow')).toBe(false);

    updateGame(state, .1, { ...idle, turnRight: true });
    const heading = leader.infantryFormation!.heading, frame = recordNativeFrame(state);
    expect(heading).toBeGreaterThan(0);
    expect(frame.sprites.find(sprite => sprite.key === 'infantry-advance-arrow')?.alpha).toBeCloseTo(.42);
    expect(frame.drawOrder.indexOf('infantry-advance-arrow')).toBeGreaterThan(frame.drawOrder.indexOf('fog'));

    updateGame(state, .1, idle);
    expect(infantryRotationAlpha(leader, state.time)).toBeGreaterThan(0);
    expect(infantryRotationAlpha(leader, state.time)).toBeLessThan(.42);
    updateGame(state, .2, idle);
    expect(leader.infantryFormation!.heading).toBe(heading);
    expect(recordNativeFrame(state).sprites.some(sprite => sprite.key === 'infantry-advance-arrow')).toBe(false);

    updateGame(state, .1, { ...idle, turnLeft: true });
    expect(infantryRotationAlpha(leader, state.time)).toBeGreaterThan(0);
    toggleInfantryFormation(state);
    expect(recordNativeFrame(state).sprites.some(sprite => sprite.key === 'infantry-advance-arrow')).toBe(false);
  });
});
