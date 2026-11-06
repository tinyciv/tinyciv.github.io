import { describe, expect, it } from 'vitest';
import { entityStore } from '../src/game/entity-store';
import { parseGameSave, serializeGameSave } from '../src/game/game-save';
import { commandAttackAt, getLeader, recallRetinue, updateGame } from '../src/game/simulation';
import { updateFog } from '../src/game/fog';
import { synchronizeRetinueSquads } from '../src/game/retinue-squads';
import { unitAttack, unitDamage } from '../src/game/veterancy';
import { citySummaries } from '../src/game/cities';
import { isRetinueMember, type GameState } from '../src/game/types';
import { updateScoutLodges } from '../src/game/scout-lodges';
import { toggleRetinueOrder } from '../src/ui/retinue-controls';
import { scoutRealm } from './helpers/scouts';
const idle = { up: false, down: false, left: false, right: false };
function fixture(): GameState {
  const state = scoutRealm(); state.victoryContinued = true;
  entityStore(state).buildings.add({ id: 103, kind: 'palace', faction: 0, x: 8, y: 18, hp: 650, maxHp: 650,
    capacity: 4, governorPermissions: { farms: false, housing: false } });
  for (const unit of state.units) unit.attack = 0;
  return state;
}
const scouts = (state: GameState) => state.units.filter(unit => unit.kind === 'scout' && unit.hp > 0);
const advance = (state: GameState, seconds: number) => { for (let i = 0; i < Math.round(seconds * 10); i++) updateGame(state, .1, idle); };

describe('independent lodge scouts in the full simulation', () => {
  it('launches and replaces scouts automatically while the full combat retinue remains intact', () => {
    const state = fixture(); updateGame(state, .1, idle);
    expect(scouts(state)).toHaveLength(2); expect(state.units.filter(isRetinueMember)).toHaveLength(4);
    const victim = scouts(state)[0]; victim.hp = 0;
    const before = state.factions[0].population;
    advance(state, .2); expect(scouts(state)).toHaveLength(1);
    advance(state, 14); expect(scouts(state)).toHaveLength(1);
    advance(state, 2); expect(scouts(state)).toHaveLength(2);
    expect(scouts(state).some(unit => unit.id === victim.id)).toBe(false);
    expect(state.units.filter(isRetinueMember)).toHaveLength(4);
    expect(state.factions[0].population).toBe(before);
  });

  it('keeps scouts outside recalls, stance commands, combat upkeep, and squad experience after reload', () => {
    const state = fixture(), before = citySummaries(state)[0].gold;
    updateScoutLodges(state); synchronizeRetinueSquads(state);
    expect(citySummaries(state)[0].gold).toBe(before);
    recallRetinue(state); toggleRetinueOrder(state);
    expect(scouts(state).every(scout => scout.retinueSquad === undefined && scout.recallIssuedAt === undefined
      && scout.retinueStance === undefined && !scout.joiningRetinue)).toBe(true);
    const loaded = parseGameSave(serializeGameSave(state)), originalIds = scouts(state).map(unit => unit.id);
    updateScoutLodges(loaded);
    expect(scouts(loaded).map(unit => unit.id)).toEqual(originalIds);
    for (const scout of scouts(loaded)) {
      expect(scout.speed).toBeCloseTo(3.96 * 1.2); expect(scout.scoutLodge).toBe(101);
    }
    expect(loaded.buildings.find(building => building.id === 101)?.scoutLodge).toEqual(state.buildings[1].scoutLodge);
  });

  it('never attacks enemies or wildlife, even with veterancy, equipment, and an attack command', () => {
    const state = fixture(); updateScoutLodges(state); const scout = scouts(state)[0];
    for (const unit of state.units) unit.attack = 0;
    Object.assign(scout, { x: 20.5, y: 12.5, kills: 500, weaponLevel: 6 });
    const enemy = { ...getLeader(state)!, id: 900, kind: 'warrior' as const, faction: -2, x: 21.5, y: 12.5, speed: 0, attack: 0, order: 'hold' as const };
    const animal = { ...enemy, id: 901, kind: 'boar' as const, faction: -3, x: 20.5, y: 13.5, order: 'wander' as const };
    entityStore(state).units.add(enemy, animal); updateFog(state);
    commandAttackAt(state, enemy.x, enemy.y);
    expect(scout.forcedAttack).toBeUndefined(); expect(unitAttack(scout)).toBe(0); expect(unitDamage(scout, 0)).toBe(0);
    advance(state, 1);
    expect(enemy.hp).toBe(100); expect(animal.hp).toBe(100);
    expect(scout.routed).toBe(false); expect(scout.attackTime).toBe(0);
    expect(state.projectiles ?? []).toHaveLength(0);
  });
});
