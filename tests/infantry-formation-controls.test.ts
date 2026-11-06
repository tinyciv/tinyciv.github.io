import { describe, expect, it } from 'vitest';
import { infantryFormationControl, leaderHeldTurnForKey, leaderHotbarActionForKey } from '../src/ui/infantry-formation-controls';
import { toggleInfantryFormation } from '../src/game/infantry-drill';
import { scoutRealm } from './helpers/scouts';
import { entityStore } from '../src/game/entity-store';

describe('Formation 3 controls', () => {
  it('keeps numeric commands fixed and changes only Q/E while formation is active', () => {
    for (const active of [false, true]) {
      expect(leaderHotbarActionForKey('1', active)).toBe('recall');
      expect(leaderHotbarActionForKey('2', active)).toBe('stance');
      expect(leaderHotbarActionForKey('3', active)).toBe('formation');
      expect(leaderHotbarActionForKey('4', active)).toBeUndefined();
      expect(leaderHotbarActionForKey('a', active)).toBeUndefined();
    }
    expect(leaderHotbarActionForKey('q', false)).toBe('stance');
    expect(leaderHotbarActionForKey('e', false)).toBe('recall');
    expect(leaderHotbarActionForKey('Q', true)).toBeUndefined();
    expect(leaderHotbarActionForKey('E', true)).toBeUndefined();
    expect(leaderHeldTurnForKey('Q', true)).toBe('turnLeft');
    expect(leaderHeldTurnForKey('E', true)).toBe('turnRight');
    expect(leaderHeldTurnForKey('q', false)).toBeUndefined();
    expect(leaderHeldTurnForKey('e', false)).toBeUndefined();
  });

  it('shows an explicitly locked action until Infantry Drill is complete', () => {
    const state = scoutRealm();
    expect(infantryFormationControl(state)).toMatchObject({ active: false, unlocked: false, enabled: false, reason: 'Research Infantry Drill first.' });
    state.factions[0].research!.levels.infantryDrill = 1;
    expect(infantryFormationControl(state)).toMatchObject({ enabled: false, reason: 'Formation requires 8 living retinue soldiers (4/8).' });
    entityStore(state).units.add(...state.units.slice(1).map((unit, index) => ({ ...unit, id: 20 + index })));
    expect(infantryFormationControl(state)).toMatchObject({ active: false, unlocked: true, enabled: true });
    expect(toggleInfantryFormation(state).ok).toBe(true);
    expect(infantryFormationControl(state)).toMatchObject({ active: true, enabled: true });
    expect(infantryFormationControl(state).title).toContain('Hold Q/E to rotate');
    expect(infantryFormationControl(state).title).toContain('below 5, all ranks and the Leader rout');
    state.units[1].hp = state.units[2].hp = state.units[3].hp = 0;
    expect(infantryFormationControl(state)).toMatchObject({ active: true, enabled: true });
  });

  it('keeps the action unavailable when the Leader cannot command on land', () => {
    const state = scoutRealm(), leader = state.units[0]; state.factions[0].research!.levels.infantryDrill = 1;
    leader.embarkedOn = 999; expect(infantryFormationControl(state).enabled).toBe(false);
    delete leader.embarkedOn; leader.boardingBoat = 999; expect(infantryFormationControl(state).enabled).toBe(false);
    delete leader.boardingBoat; leader.order = 'flee'; expect(infantryFormationControl(state).enabled).toBe(false);
    leader.order = 'hold'; leader.inside = true; expect(infantryFormationControl(state).enabled).toBe(false);
    delete leader.inside; leader.hp = 0; expect(infantryFormationControl(state).enabled).toBe(false);
    leader.hp = 100; state.gameOver = true; expect(infantryFormationControl(state).enabled).toBe(false);
  });
});
