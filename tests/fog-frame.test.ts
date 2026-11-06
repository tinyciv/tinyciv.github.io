import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { FOG_SAMPLE_INTERVAL, beginFogFrame, endFogFrame, invalidateFog, pointInSight, presentationFog, publishFog, refreshFogUnit, updateFog } from '../src/game/fog';
import { type Building, type GameState, type Unit } from '../src/game/types';

function fixture(): GameState {
    return {
        world: { width: 48, height: 32, seed: 'fog-frame', source: 'test', spawns: [], revision: 0,
            tiles: Array.from({ length: 48 * 32 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
                moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
        units: [], buildings: [], fields: [], factions: [{ id: 0, name: 'Player', color: '#3988ff', affinity: 100,
            relation: 'self', food: 100, gold: 100, production: 0, population: 0, yields: { food: 0, production: 0, gold: 0 }, nextRaid: 10000, defeated: false }],
        time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
        buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'fog-frame', rngState: 1,
    };
}
const scout = (id: number, x: number): Unit => ({ id, kind: 'leader', faction: 0, x, y: 15.5,
    hp: 100, morale: 100, attack: 25, defense: 5, speed: 3.6, range: 4, order: 'hold', cooldown: 0,
    lastCombat: -60, moving: false, facing: 0, attackTime: 0 });
const house = (id: number, faction: number, x: number): Building => ({ id, kind: 'house', faction,
    x, y: 15, hp: 100, maxHp: 100, capacity: 4 });

describe('live fog validation during the unit phase', () => {
    it('avoids repeated army scans and still refreshes immediately when a scout changes cells', () => {
        const state = fixture(), unit = scout(1, 12.5); entityStore(state).units.add(unit);
        let reads = 0;
        Object.defineProperty(unit, 'faction', { get: () => { reads++; return 0; }, enumerable: true });
        beginFogFrame(state);
        try {
            expect(pointInSight(updateFog(state), 3.5, 15.5)).toBe(true);
            const before = reads;
            for (let i = 0; i < 100; i++) updateFog(state);
            expect(reads).toBe(before);
            unit.x = 32.5; refreshFogUnit(state, unit);
            expect(pointInSight(updateFog(state), 3.5, 15.5)).toBe(false);
            expect(pointInSight(updateFog(state), 41.5, 15.5)).toBe(true);
        } finally { endFogFrame(state); }
        unit.x = 12.5;
        expect(pointInSight(updateFog(state), 3.5, 15.5)).toBe(true);
    });

    it('sees dispatch, death, radius and ownership changes before the next query', () => {
        const state = fixture(), unit = scout(1, 24.5); unit.inside = true; entityStore(state).units.add(unit);
        beginFogFrame(state);
        try {
            expect(pointInSight(updateFog(state), 24.5, 15.5)).toBe(false);
            unit.inside = false; refreshFogUnit(state, unit);
            expect(pointInSight(updateFog(state), 33.5, 15.5)).toBe(true);
            entityStore(state).setUnitRole(unit, { kind: 'worker' }); refreshFogUnit(state, unit);
            expect(pointInSight(updateFog(state), 33.5, 15.5)).toBe(false);
            unit.faction = 1; refreshFogUnit(state, unit);
            expect(pointInSight(updateFog(state), 24.5, 15.5)).toBe(false);
            unit.faction = 0; refreshFogUnit(state, unit);
            expect(pointInSight(updateFog(state), 24.5, 15.5)).toBe(true);
            unit.hp = 0; invalidateFog(state);
            expect(pointInSight(updateFog(state), 24.5, 15.5)).toBe(false);
        } finally { endFogFrame(state); }
    });

    it('validates structural replacement and retains the original observation cadence', () => {
        const state = fixture(), building = house(10, 1, 14); entityStore(state).units.add(scout(1, 12.5)); entityStore(state).buildings.add(building);
        beginFogFrame(state);
        try {
            expect(updateFog(state).buildings[0].hp).toBe(100);
            building.hp = 50; invalidateFog(state);
            expect(updateFog(state).buildings[0].hp).toBe(100);
            state.time = .1;
            expect(updateFog(state).buildings[0].hp).toBe(50);
            entityStore(state).units.replace([scout(2, 38.5)]);
            expect(pointInSight(updateFog(state), 3.5, 15.5)).toBe(false);
            entityStore(state).buildings.replace([house(11, 0, 3)]);
            expect(pointInSight(updateFog(state), 3.5, 15.5)).toBe(true);
            state.buildings[0].hp = 0; invalidateFog(state);
            expect(pointInSight(updateFog(state), 3.5, 15.5)).toBe(false);
        } finally { endFogFrame(state); }
    });
});

describe('incremental sight coverage', () => {
    it('matches the full source union as overlapping and duplicate scouts move, disappear and return', () => {
        const state = fixture(), a = scout(1, 12.5), b = scout(2, 12.5), c = scout(3, 16.5);
        entityStore(state).units.add(a, b, c);
        const verify = () => {
            const fog = updateFog(state);
            for (let y = 0; y < fog.height; y++) for (let x = 0; x < fog.width; x++) {
                const visible = fog.sources.some(source => (x + .5 - source.x) ** 2 + (y + .5 - source.y) ** 2 <= source.radius ** 2);
                expect(pointInSight(fog, x + .5, y + .5)).toBe(visible);
            }
        };
        verify(); a.x = 32.5; verify(); b.hp = 0; verify(); c.inside = true; verify();
        a.x = 16.5; verify(); c.inside = false; verify(); a.hp = 0; verify(); c.x = 42.5; verify();
    });

    it('retains owned sight when scout coverage is removed and removes claims when their source dies', () => {
        const state = fixture(), unit = scout(1, 12.5), building = house(10, 0, 12);
        entityStore(state).units.add(unit); entityStore(state).buildings.add(building);
        updateFog(state);
        unit.hp = 0;
        expect(pointInSight(updateFog(state), 12.5, 15.5)).toBe(true);
        building.hp = 0;
        const fog = updateFog(state);
        expect(pointInSight(fog, 12.5, 15.5)).toBe(false);
        expect(fog.explored[15 * fog.width + 12]).toBe(1);
    });
});


it('does not invalidate presentation when a moving scout stays inside an unchanged sight union', () => {
    const state = fixture(), leader = scout(1, 20.5), worker = scout(2, 20.5);
    worker.kind = 'worker'; entityStore(state).units.add(leader, worker);
    entityStore(state).buildings.add(house(10, 1, 22));
    const fog = updateFog(state), revision = fog.revision, visible = fog.visible.slice(), memories = fog.buildings;
    worker.x += 1;
    expect(updateFog(state).visible).toEqual(visible);
    expect(fog.revision).toBe(revision);
    expect(fog.buildings).toBe(memories);
    state.buildings[0].hp = 50; state.time = .1;
    expect(updateFog(state).buildings[0].hp).toBe(50);
    expect(fog.buildings).not.toBe(memories);
    worker.x += 10;
    expect(updateFog(state).revision).toBeGreaterThan(revision);
});

it('retains unchanged sight and memories while refreshing visible crop observation time', () => {
    const state = fixture(), unit = scout(1, 12.5), building = house(10, 1, 14);
    entityStore(state).units.add(unit); entityStore(state).buildings.add(building);
    state.fields = [{ id: 20, camp: building.id, faction: 1, x: 15, y: 15, planted: true, food: 0, nextHarvest: 60 }];
    const fog = updateFog(state), sources = fog.sources, buildings = fog.buildings, fields = fog.fields;
    state.time = .1;
    updateFog(state);
    expect(fog.sources).toBe(sources); expect(fog.buildings).toBe(buildings); expect(fog.fields).toBe(fields);
    expect(fields[0].observedAt).toBe(.1);
    // Going out of sight stops the timestamp; later live crop mutations must
    // not alter the last-seen shape or progression.
    unit.x = 38.5; updateFog(state);
    state.time = 10; state.fields[0].food = 5; state.fields[0].planted = false;
    updateFog(state);
    expect(fields[0]).toMatchObject({ food: 0, planted: true, observedAt: .1 });
    unit.x = 12.5;
    expect(updateFog(state).fields[0]).toMatchObject({ food: 5, planted: false, observedAt: 10 });
});

it('copies changed nested defense state and optional properties without leaking hidden changes', () => {
    const state = fixture(), unit = scout(1, 12.5), building = house(10, 1, 14);
    building.fort = { brigadeLevel: 1, nextUpkeepAt: 30, funded: true, nextRecruitAt: 30 };
    entityStore(state).units.add(unit); entityStore(state).buildings.add(building);
    const first = updateFog(state).buildings[0];
    building.fort.brigadeLevel = 2; state.time = .1;
    const second = updateFog(state).buildings[0];
    expect(first.fort!.brigadeLevel).toBe(1); expect(second.fort!.brigadeLevel).toBe(2);
    unit.x = 38.5; updateFog(state);
    building.fort.brigadeLevel = 3; building.cityName = 'Changed while hidden'; state.time = .2;
    expect(updateFog(state).buildings[0]).toBe(second);
    expect(second.fort!.brigadeLevel).toBe(2); expect(second.cityName).toBeUndefined();
    unit.x = 12.5;
    expect(updateFog(state).buildings[0]).toMatchObject({ cityName: 'Changed while hidden', fort: { brigadeLevel: 3 } });
    delete building.cityName; delete building.fort; state.time = .3;
    const cleared = updateFog(state).buildings[0];
    expect(cleared).not.toHaveProperty('cityName'); expect(cleared).not.toHaveProperty('fort');
});

it('renders committed fog without rediscovering sources and invalidates paused boarding changes', () => {
    const state = fixture(), unit = scout(1, 12.5); entityStore(state).units.add(unit);
    let reads = 0;
    Object.defineProperty(unit, 'x', { configurable: true, enumerable: true, get: () => { reads++; return 12.5; } });
    const committed = publishFog(state), before = reads;
    for (let i = 0; i < 100; i++) expect(presentationFog(state)).toBe(committed);
    expect(reads).toBe(before);
    expect(pointInSight(committed, 3.5, 15.5)).toBe(true);
    state.paused = true; unit.inside = true; refreshFogUnit(state, unit);
    expect(pointInSight(presentationFog(state), 3.5, 15.5)).toBe(false);
    publishFog(state);
    unit.inside = false; refreshFogUnit(state, unit);
    expect(pointInSight(presentationFog(state), 3.5, 15.5)).toBe(true);
});

it('samples live simulation sight and memories at most 1.5 times a second despite invalidations', async () => {
    const { withSimulationReads } = await import('../src/game/simulation-reads');
    const state = fixture(), unit = scout(1, 12.5), building = house(10, 1, 14);
    entityStore(state).units.add(unit); entityStore(state).buildings.add(building);
    withSimulationReads(state, () => {
        const fog = publishFog(state);
        expect(pointInSight(fog, 3.5, 15.5)).toBe(true);
        let reads = 0;
        Object.defineProperty(unit, 'faction', { enumerable: true, get: () => { reads++; return 0; } });
        unit.x = 32.5; building.hp = 50;
        for (let frame = 1; frame < 40; frame++) {
            state.time = frame / 60; invalidateFog(state); beginFogFrame(state); refreshFogUnit(state, unit);
            publishFog(state); endFogFrame(state);
            expect(pointInSight(fog, 3.5, 15.5)).toBe(true);
            expect(fog.buildings.find(b => b.id === 10)!.hp).toBe(100);
        }
        expect(reads).toBe(0);
        state.time = FOG_SAMPLE_INTERVAL; publishFog(state);
        expect(reads).toBeGreaterThan(0);
        expect(pointInSight(fog, 3.5, 15.5)).toBe(false);
        expect(pointInSight(fog, 41.5, 15.5)).toBe(true);
    });
});
