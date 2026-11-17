import { describe, expect, it } from 'vitest';
import { retinueComposition } from '../src/game/archery';
import { entityStore } from '../src/game/entity-store';
import { applyGameCommand } from '../src/multiplayer/commands';
import { scoutRealm } from './helpers/scouts';
import { withDevelopedResources } from './helpers/developed-resources';

const controls = ['archeryRange', 'blacksmith', 'barracks', 'stable'] as const;
const roles = [
  ['warriors', 'warriors'], ['archers', 'archers'], ['spearmen', 'spearmen'], ['swordsmen', 'swordsmen'],
  ['pikemen', 'pikemen'], ['horsemen', 'horsemen'], ['horse-archers', 'horseArchers'], ['knights', 'knights'],
] as const;
const fields = ['archerFraction', 'spearmanFraction', 'swordsmanFraction', 'pikemanFraction',
  'horsemanFraction', 'horseArcherFraction', 'knightFraction'] as const;

function fixture() {
  const state = withDevelopedResources(scoutRealm(), ['copper']), faction = state.factions[0];
  Object.assign(faction.research!.levels, { metalCasting: 1, urbanMilitia: 1, horsebackRiding: 1, compoundBow: 1, stirrups: 1 });
  const buildings = controls.map((kind, index) => ({ ...state.buildings[0], id: 300 + index, kind, x: 14 }));
  entityStore(state).buildings.add(...buildings);
  return { state, faction, buildings };
}

describe.each(controls)('shared army controls at %s', kind => {
  it.each(roles)('can assign %s even when cavalry already occupies every slot', (type, count) => {
    const { state, faction, buildings } = fixture();
    faction.knightFraction = 1;
    const building = buildings.find(building => building.kind === kind)!;
    expect(applyGameCommand(state, 0, { type, buildingId: building.id, fraction: .5 }).ok).toBe(true);
    const counts = retinueComposition(state, 0);
    expect(counts[count]).toBe(2);
    expect(roles.reduce((sum, [, role]) => sum + counts[role], 0)).toBe(counts.total);
    expect(fields.reduce((sum, field) => sum + faction[field]!, 0)).toBeLessThanOrEqual(1);
  });
});

describe('retinue allocation changes', () => {
  it('consumes spare warrior slots before changing other assigned roles', () => {
    const { state, faction, buildings } = fixture(), buildingId = buildings[0].id;
    faction.archerFraction = .25;
    expect(applyGameCommand(state, 0, { type: 'spearmen', buildingId, fraction: .5 }).ok).toBe(true);
    expect(retinueComposition(state, 0)).toMatchObject({ archers: 1, spearmen: 2, warriors: 1 });
    expect(applyGameCommand(state, 0, { type: 'swordsmen', buildingId, fraction: .5 }).ok).toBe(true);
    expect(retinueComposition(state, 0)).toMatchObject({ archers: 1, swordsmen: 2, spearmen: 1, warriors: 0 });
  });

  it('keeps reduced allocations from returning after their replacement is reduced', () => {
    const { state, faction, buildings } = fixture(), buildingId = buildings[0].id;
    faction.knightFraction = 1;
    expect(applyGameCommand(state, 0, { type: 'pikemen', buildingId, fraction: 1 }).ok).toBe(true);
    expect(applyGameCommand(state, 0, { type: 'pikemen', buildingId, fraction: .25 }).ok).toBe(true);
    expect(retinueComposition(state, 0)).toMatchObject({ knights: 0, pikemen: 1, warriors: 3 });
    expect(faction.knightFraction).toBe(0);
  });

  it('accounts for pikemen when directly exchanging warriors and archers', () => {
    const { state, faction, buildings } = fixture(), buildingId = buildings[0].id;
    faction.pikemanFraction = .5;
    expect(applyGameCommand(state, 0, { type: 'warriors', buildingId, fraction: .25 }).ok).toBe(true);
    expect(retinueComposition(state, 0)).toMatchObject({ pikemen: 2, warriors: 1, archers: 1 });
    expect(applyGameCommand(state, 0, { type: 'warriors', buildingId, fraction: 1 }).ok).toBe(true);
    expect(retinueComposition(state, 0)).toMatchObject({ pikemen: 0, warriors: 4, archers: 0 });
  });

  it('edits at one building and sends trainees to the correct training building', () => {
    const { state, buildings } = fixture();
    const stable = buildings.find(building => building.kind === 'stable')!;
    const smithy = buildings.find(building => building.kind === 'blacksmith')!;
    expect(applyGameCommand(state, 0, { type: 'spearmen', buildingId: stable.id, fraction: .5 }).ok).toBe(true);
    const trainees = state.units.filter(unit => unit.training?.role === 'spearman');
    expect(trainees).toHaveLength(2);
    expect(trainees.every(unit => unit.training?.range === smithy.id)).toBe(true);
  });

  it('preserves research and command validation at shared controls', () => {
    const { state, faction, buildings } = fixture(), buildingId = buildings[0].id;
    delete faction.research!.levels.metalCasting;
    expect(applyGameCommand(state, 0, { type: 'swordsmen', buildingId, fraction: .5 }).ok).toBe(false);
    delete faction.research!.levels.militaryTactics;
    expect(applyGameCommand(state, 0, { type: 'spearmen', buildingId, fraction: .5 }).ok).toBe(false);
    for (const fraction of [NaN, Infinity, -.01, 1.01]) {
      expect(applyGameCommand(state, 0, { type: 'archers', buildingId, fraction }).ok).toBe(false);
    }
    expect(fields.every(field => faction[field] === undefined)).toBe(true);
  });
});
