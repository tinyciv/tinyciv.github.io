import { describe, expect, it } from 'vitest';
import { scoutRealm } from './helpers/scouts';
import { entityStore } from '../src/game/entity-store';
import { buildAt, moveUnit } from '../src/game/simulation';
import { areHorsemenUnlocked, isBuildingUnlocked, RESEARCH_BRANCHES } from '../src/game/research';
import { nextRecruitRole, retinueComposition, setArcherFraction, setHorsemanFraction, setSoldierRole,
  setSpearmanFraction, updateArcheryTraining } from '../src/game/archery';
import { synchronizeRetinueSquads } from '../src/game/retinue-squads';
import { unitRespectsForbidden } from '../src/game/forbidden-zones';
import { isRetinueMember, type Building } from '../src/game/types';

function realm() {
  const state = scoutRealm();
  const stable: Building = { id: 102, kind: 'stable', x: 16, y: 12, faction: 0, hp: 250, maxHp: 250, capacity: 0 };
  entityStore(state).buildings.retain(b => b.kind !== 'scoutLodge');
  entityStore(state).buildings.add(stable, { ...stable, id: 103, kind: 'palace', x: 10, y: 9, capacity: 4,
    governorPermissions: { farms: false, housing: false } });
  state.factions[0].research!.levels.horsebackRiding = 1;
  return { state, stable };
}

describe('mounted retinue and stable', () => {
  it('locks the stable behind income-funded Horseback Riding and charges separately for construction', () => {
    const { state, stable } = realm(); entityStore(state).buildings.retain(b => b !== stable);
    delete state.factions[0].research!.levels.horsebackRiding;
    expect(areHorsemenUnlocked(state.factions[0])).toBe(false);
    expect(isBuildingUnlocked(state.factions[0], 'stable')).toBe(false);
    expect(buildAt(state, 'stable', 14, 13).ok).toBe(false);
    const technology = RESEARCH_BRANCHES.find(b => b.id === 'horsebackRiding')!;
    expect(technology.prerequisites).toEqual(['infantryDrill']);
    expect(technology.tiers[0]).toMatchObject({ points: 435 });
    expect(technology.tiers[0]).not.toHaveProperty('seconds');
    expect(technology.tiers[0]).not.toHaveProperty('gold');
    state.factions[0].research!.levels.horsebackRiding = 1;
    expect(buildAt(state, 'stable', 14, 13)).toMatchObject({ ok: true });
    expect(state.factions[0].gold).toBe(650);
    expect(state.buildings.find(b => b.kind === 'stable')).toMatchObject({ construction: { duration: 60, paidGold: 350 } });
  });

  it('uses a shared finite quota without removing scouts or growing the army', () => {
    const { state, stable } = realm(), range = state.buildings[0];
    const smithy = { ...range, id: 104, kind: 'blacksmith' as const, x: 14 }; entityStore(state).buildings.add(smithy);
    expect(setArcherFraction(state, range, .5)).toBe(true);
    expect(setSpearmanFraction(state, smithy, .25)).toBe(true);
    expect(setHorsemanFraction(state, stable, .5)).toBe(true);
    const counts = retinueComposition(state, 0);
    expect(counts).toMatchObject({ total: 4, horsemen: 2, archers: 2, warriors: 0, spearmen: 0 });
    expect(state.units.filter(isRetinueMember)).toHaveLength(4);
    expect(setArcherFraction(state, range, 1)).toBe(true);
    expect(state.factions[0].archerFraction).toBe(.5);
    expect(state.units.filter(u => u.training?.role === 'horseman')).toHaveLength(2);
  });

  it('requires an owned completed nearby stable and rejects non-finite allocation', () => {
    const { state, stable } = realm();
    expect(setHorsemanFraction(state, state.buildings[0], .5)).toBe(false);
    expect(setHorsemanFraction(state, stable, NaN)).toBe(false);
    stable.construction = { startedAt: 0, duration: 60 };
    expect(setHorsemanFraction(state, stable, .5)).toBe(false);
    delete stable.construction; state.units[0].x = 35;
    expect(setHorsemanFraction(state, stable, .5)).toBe(false);
  });

  it('physically visits a stable and preserves squad experience and wounds', () => {
    const { state, stable } = realm(); synchronizeRetinueSquads(state);
    expect(setHorsemanFraction(state, stable, .25)).toBe(true);
    const soldier = state.units.find(u => u.training?.role === 'horseman')!;
    const squad = soldier.retinueSquad; soldier.hp = 60; soldier.kills = 250;
    soldier.weaponLevel = 3; soldier.armorLevel = 2;
    for (let i = 0; i < 200 && soldier.kind !== 'horseman'; i++) {
      state.time += .1; updateArcheryTraining(state, soldier, .1, moveUnit);
    }
    expect(soldier).toMatchObject({ kind: 'horseman', hp: 60, maxHp: 100, attack: 25.5, defense: 4,
      retinueSquad: squad, kills: 250, weaponLevel: 3, armorLevel: 2, joiningRetinue: true, inside: false });
    expect(soldier.speed).toBeCloseTo(3.96 * 1.65);
    expect(unitRespectsForbidden(state, soldier)).toBe(false);
    expect(setHorsemanFraction(state, stable, 0)).toBe(true);
    for (let i = 0; i < 200 && soldier.kind === 'horseman'; i++) {
      state.time += .1; updateArcheryTraining(state, soldier, .1, moveUnit);
    }
    expect(soldier.kind).toBe('warrior');
    expect(soldier.speed).toBeCloseTo(3.96); expect(soldier.attack).toBe(17);
    expect(soldier.retinueSquad).toBe(squad); expect(soldier.hp).toBe(60);
  });

  it('evacuates a captured stable without converting its trainee to the enemy', () => {
    const { state, stable } = realm(); setHorsemanFraction(state, stable, .25);
    const soldier = state.units.find(u => u.training)!;
    soldier.training!.enteredAt = 0; soldier.inside = true;
    soldier.x = stable.x + .5; soldier.y = stable.y + .5; stable.faction = 1; state.time = 5;
    updateArcheryTraining(state, soldier, .1, moveUnit);
    expect(soldier.training).toBeUndefined(); expect(soldier.inside).toBe(false);
    expect(soldier.faction).toBe(0); expect(soldier.kind).toBe('warrior');
  });

  it('requires a surviving stable for mounted replacements and never compounds role bonuses', () => {
    const { state, stable } = realm(); state.factions[0].horsemanFraction = .5;
    expect(nextRecruitRole(state, state.factions[0])).toBe('horseman');
    stable.hp = 0;
    expect(nextRecruitRole(state, state.factions[0])).toBe('warrior');
    const soldier = state.units[1];
    for (let i = 0; i < 10; i++) for (const role of ['horseman', 'archer', 'spearman', 'warrior'] as const) setSoldierRole(soldier, role);
    expect(soldier.attack).toBeCloseTo(17); expect(soldier.speed).toBeCloseTo(3.96);
    expect(soldier.defense).toBe(4); expect(soldier.maxHp).toBe(100);
  });
});
