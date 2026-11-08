import { describe, expect, it } from 'vitest';
import { nextRecruitRole, scheduleArcheryTraining, setSpearmanFraction, updateArcheryTraining } from '../src/game/archery';
import { blacksmithUpgradeStatus, purchaseBlacksmithUpgrade } from '../src/game/blacksmith';
import { citySummaries, factionFoodConsumption } from '../src/game/cities';
import { entityStore } from '../src/game/entity-store';
import { cityDevelopmentNeeds } from '../src/game/governor';
import { buildAt, updateGame } from '../src/game/simulation';
import { markWorldChanged } from '../src/game/world-revisions';
import { scoutRealm } from './helpers/scouts';
import { withDevelopedResources } from './helpers/developed-resources';

function realm() {
    const state = withDevelopedResources(scoutRealm(), []);
    const smithy = { ...state.buildings[0], id: 900, kind: 'blacksmith' as const, x: 14 };
    entityStore(state).buildings.add(smithy);
    state.factions[0].research!.levels.siegeEngines = 1;
    return { state, smithy };
}

describe('developed resource effects', () => {
    it('requires owned developed copper for spear allocation, recruitment and completed training', () => {
        const { state, smithy } = realm(), faction = state.factions[0];
        faction.spearmanFraction = 1;
        expect(setSpearmanFraction(state, smithy, 1)).toBe(false);
        expect(nextRecruitRole(state, faction)).toBe('warrior');
        scheduleArcheryTraining(state, true);
        expect(state.units.some(unit => unit.training?.role === 'spearman')).toBe(false);
        withDevelopedResources(state, ['copper']);
        expect(setSpearmanFraction(state, smithy, 1)).toBe(true);
        const trainee = state.units.find(unit => unit.training?.role === 'spearman')!;
        trainee.training!.enteredAt = 0; trainee.inside = true; state.time = 5;
        const deposit = state.world.tiles.find(tile => tile.resource === 'copper')!;
        deposit.resourceDeveloped = false; markWorldChanged(state.world, 'appearance');
        updateArcheryTraining(state, trainee, .1, () => {});
        expect(trainee.kind).toBe('warrior'); expect(trainee.inside).toBe(true);
        expect(nextRecruitRole(state, faction)).toBe('warrior');
        deposit.resourceDeveloped = true; markWorldChanged(state.world, 'appearance');
        updateArcheryTraining(state, trainee, .1, () => {});
        expect(trainee.kind).toBe('spearman'); expect(trainee.inside).toBe(false);
        deposit.resourceDeveloped = false; markWorldChanged(state.world, 'appearance');
        scheduleArcheryTraining(state, true);
        expect(trainee.kind).toBe('spearman');
    });

    it('requires iron for ballista orders and both smith upgrades without revoking issued equipment', () => {
        const { state, smithy } = realm(), faction = state.factions[0];
        const gold = faction.gold;
        for (const track of ['armor', 'weapon'] as const) {
            expect(blacksmithUpgradeStatus(state, smithy, track).reason).toContain('iron mine');
            expect(purchaseBlacksmithUpgrade(state, smithy, track).ok).toBe(false);
        }
        expect(buildAt(state, 'ballista', 14, 14).message).toContain('iron mine');
        expect(faction.gold).toBe(gold);
        withDevelopedResources(state, ['iron']);
        expect(purchaseBlacksmithUpgrade(state, smithy, 'weapon').ok).toBe(true);
        expect(buildAt(state, 'ballista', 14, 14).ok).toBe(true);
        const deposit = state.world.tiles.find(tile => tile.resource === 'iron')!;
        deposit.resourceDeveloped = false; markWorldChanged(state.world, 'appearance');
        expect(blacksmithUpgradeStatus(state, smithy, 'weapon').available).toBe(false);
        expect(faction.weaponLevel).toBe(1);
        expect(state.units.find(unit => unit.kind === 'leader')!.weaponLevel).toBe(1);
        expect(state.buildings.find(building => building.kind === 'ballista')!.hp).toBeGreaterThan(0);
    });

    it('shares salt coverage across the whole faction and applies the same saving to city rates and actual meals', () => {
        const { state } = realm(), faction = state.factions[0];
        const palace = state.buildings.find(building => building.kind === 'palace')!;
        palace.capacity = 0;
        const second = { ...palace, id: 901, x: 28 };
        entityStore(state).buildings.add(second,
            { ...palace, id: 902, kind: 'house', x: 5, capacity: 20, residents: 20 },
            { ...palace, id: 903, kind: 'house', x: 29, capacity: 20, residents: 20 });
        faction.population = 40; faction.food = 100;
        const before = cityDevelopmentNeeds(state, second).foodCapacity;
        withDevelopedResources(state, ['salt']);
        expect(factionFoodConsumption(state, 0)).toBeCloseTo(37.5);
        expect(citySummaries(state).map(city => city.food)).toEqual([expect.closeTo(-18.75), expect.closeTo(-18.75)]);
        expect(cityDevelopmentNeeds(state, second).foodCapacity - before).toBeCloseTo(1.25);
        state.time = 29.9;
        updateGame(state, .1, { up: false, down: false, left: false, right: false });
        expect(faction.food).toBeCloseTo(62.5);
        withDevelopedResources(state, ['salt', 'salt', 'salt', 'salt', 'salt']);
        expect(factionFoodConsumption(state, 0)).toBeCloseTo(30);
        expect(citySummaries(state).reduce((sum, city) => sum + city.food, 0)).toBeCloseTo(-30);
    });
});
