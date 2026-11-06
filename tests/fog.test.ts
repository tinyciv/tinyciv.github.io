import { recordNativeFrame } from './helpers/native-renderer';
import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import type { Building, FarmField, GameState, Unit, World } from '../src/game/types';
import { FOG_SAMPLE_INTERVAL, pointInSight, entityVisible, isExplored, isVisible, updateFog } from '../src/game/fog';
import { fieldGrowth } from '../src/game/farm-art';
import { withSimulationReads } from '../src/game/simulation-reads';
import { CHECK_INTERVAL } from '../src/game/work-cadence';

const unit = (x: number, y: number, faction = 0, kind: Unit['kind'] = 'leader'): Unit => ({
    id: 1 + faction, x, y, faction, kind, hp: 100, morale: 100, attack: 25, defense: 5,
    speed: 3.6, range: .85, order: 'follow', cooldown: 0, lastCombat: -100,
    moving: false, facing: 0, attackTime: 0,
});
const building = (id: number, x: number, y: number, faction = 0, kind: Building['kind'] = 'camp'): Building => ({
    id, x, y, faction, kind, hp: 100, maxHp: 100, capacity: 1,
});
const field = (id: number, x: number, y: number, faction = 1): FarmField => ({
    id, x, y, faction, camp: 20, planted: true, food: 3, harvestedAt: 30, nextHarvest: 60,
});
function fixture(): GameState {
    const world: World = { width: 64, height: 48, seed: 'fog-test', source: 'test', spawns: [], tiles: [] };
    return { world, units: [unit(10.5, 12.5)], buildings: [], factions: [], time: 0, tick: 0,
        paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
        buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: world.seed, rngState: 1 };
}

describe('fog of war', () => {
    it.each([30, 60, 120])('samples production sight at half the sensing rate with %i simulation steps/second', hz => {
        const state = fixture(), sampled: number[] = [];
        let revision = -1;
        for (let frame = 0; frame <= hz * 2; frame++) {
            state.time = frame / hz;
            state.units[0].x = 10.5 + state.time * 10;
            withSimulationReads(state, () => {
                const fog = updateFog(state);
                if (fog.revision !== revision) { sampled.push(state.time); revision = fog.revision; }
                expect(updateFog(state).revision).toBe(revision);
            });
        }
        expect(FOG_SAMPLE_INTERVAL).toBe(CHECK_INTERVAL * 2);
        expect(sampled).toHaveLength(4); // Initial sample plus 1.5 samples/second.
        for (let i = 1; i < sampled.length; i++) expect(sampled[i] - sampled[i - 1]).toBeCloseTo(2 / 3, 8);
    });

    it('updates last-seen building details on the slower sight clock while presentation time advances', () => {
        const state = fixture(), enemy = building(20, 12, 12, 1, 'house');
        entityStore(state).buildings.add(enemy);
        withSimulationReads(state, () => {
            const first = updateFog(state);
            expect(first.buildings.find(b => b.id === enemy.id)?.hp).toBe(100);
            enemy.hp = 40; state.time = CHECK_INTERVAL;
            const held = updateFog(state);
            expect(held.buildings.find(b => b.id === enemy.id)?.hp).toBe(100);
            expect(held.presentationTime).toBe(CHECK_INTERVAL);
            state.time = FOG_SAMPLE_INTERVAL;
            expect(updateFog(state).buildings.find(b => b.id === enemy.id)?.hp).toBe(40);
        });
    });

    it('samples circular sight once per cell across moving-source replacements', () => {
        const state = fixture();
        entityStore(state).units.replace(Array.from({ length: 32 }, (_, i) => ({ ...unit((i * 11.75) % 64, (i * 7.125) % 48), id: i + 1 })));
        for (let frame = 0; frame < 2; frame++) {
            const fog = updateFog(state);
            for (let y = .125; y < 48; y += 1.75) for (let x = .375; x < 64; x += 1.75) {
                const expected = fog.sources.some(source => (Math.floor(x) + .5 - source.x) ** 2 + (Math.floor(y) + .5 - source.y) ** 2 <= source.radius ** 2);
                expect(pointInSight(fog, x, y)).toBe(expected);
            }
            entityStore(state).units.replace([unit(63.5, 47.5)]); state.time++;
        }
    });

    it('keeps the whole visibility cell steady until a scout enters its next cell', () => {
        const state = fixture(), first = updateFog(state), revision = first.revision;
        state.units[0].x += .4; state.units[0].y -= .4;
        expect(updateFog(state).revision).toBe(revision);
        state.units[0].x += .2;
        expect(updateFog(state).revision).toBeGreaterThan(revision);
        for (let y = 0; y < first.height; y++) for (let x = 0; x < first.width; x++)
            expect(pointInSight(first, x + .01, y + .01)).toBe(pointInSight(first, x + .99, y + .99));
    });

    it('keeps palace collectors hidden inside and grants tower sight only on completion', () => {
        const state = fixture();
        const collector = { ...unit(36.5, 24.5, 0, 'worker'), id: 42, collector: true, inside: true };
        const tower = { ...building(50, 40, 24, 0, 'tower'), construction: { startedAt: 0, duration: 20 } };
        entityStore(state).units.replace([collector]); entityStore(state).buildings.replace([tower]);
        expect(updateFog(state).sources).toHaveLength(0);
        expect(entityVisible(state, collector)).toBe(false);
        expect(isVisible(state, 54.5, 24.5)).toBe(false);
        delete (tower as Building).construction;
        expect(updateFog(state).sources).toContainEqual({ x: 40.5, y: 24.5, radius: 18 });
        expect(isVisible(state, 54.5, 24.5)).toBe(true);
        collector.inside = false;
        expect(entityVisible(state, collector)).toBe(true);
    });

    it('starts unexplored and reveals only surviving player units and occupied player buildings', () => {
        const state = fixture();
        entityStore(state).units.add(unit(48.5, 30.5, 1), unit(40.5, 8.5, -2));
        entityStore(state).buildings.add(building(10, 33, 30, 1), building(11, 55, 42, 0, 'road'));
        const fog = updateFog(state);
        expect(isVisible(state, 10.5, 12.5)).toBe(true);
        expect(isExplored(state, 0, 0)).toBe(false);
        expect(isExplored(state, 48.5, 30.5)).toBe(false);
        expect(isExplored(state, 40.5, 8.5)).toBe(false);
        expect(isExplored(state, 55.5, 42.5)).toBe(false);
        expect(fog.explored.filter(Boolean).length).toBeLessThan(320);
        state.units[0].hp = 0;
        expect(isVisible(state, 10.5, 12.5)).toBe(false);
        expect(isExplored(state, 10.5, 12.5)).toBe(true);
        entityStore(state).buildings.add(building(12, 30, 20));
        expect(isVisible(state, 30.5, 20.5)).toBe(true);
    });

    it('remembers terrain after a scout leaves while hiding every unseen moving unit', () => {
        const state = fixture(), enemy = unit(11.5, 12.5, 1), marauder = unit(12.5, 12.5, -2);
        entityStore(state).units.add(enemy, marauder);
        expect(entityVisible(state, enemy)).toBe(true);
        expect(entityVisible(state, marauder)).toBe(true);
        state.units[0].x = 38.5;
        const fog = updateFog(state), revision = fog.revision;
        expect(isExplored(state, 11.5, 12.5)).toBe(true);
        expect(isVisible(state, 11.5, 12.5)).toBe(false);
        expect(entityVisible(state, enemy)).toBe(false);
        expect(entityVisible(state, marauder)).toBe(false);
        enemy.x = 14.5; marauder.y = 15.5;
        expect(updateFog(state).revision).toBe(revision);
        expect(entityVisible(state, enemy)).toBe(false);
        expect(entityVisible(state, marauder)).toBe(false);
        expect(entityVisible(state, state.units[0])).toBe(true);
    });

    it('keeps last-seen structures until scouting observes their removal or replacement', () => {
        const state = fixture(), camp = building(20, 14, 12, 1);
        entityStore(state).buildings.add(camp);
        expect(updateFog(state).buildings.find(b => b.id === 20)?.hp).toBe(100);
        state.units[0].x = 40.5;
        updateFog(state);
        entityStore(state).buildings.replace([]);
        expect(updateFog(state).buildings.some(b => b.id === 20)).toBe(true);
        const hidden = building(21, 15, 12, 1);
        entityStore(state).buildings.add(hidden);
        expect(updateFog(state).buildings.some(b => b.id === 21)).toBe(false);
        state.units[0].x = 10.5;
        const memories = updateFog(state).buildings;
        expect(memories.some(b => b.id === 20)).toBe(false);
        expect(memories.find(b => b.id === 21)).toEqual(hidden);
        expect(memories.find(b => b.id === 21)).not.toBe(hidden);
    });

    it('persists exploration and building memory across JSON saves but recomputes current sight', () => {
        const state = fixture();
        entityStore(state).buildings.add(building(30, 12, 12, 1));
        updateFog(state);
        state.units[0].x = 40.5;
        updateFog(state);
        const restored: GameState = JSON.parse(JSON.stringify(state));
        expect(isExplored(restored, 10.5, 12.5)).toBe(true);
        expect(isVisible(restored, 10.5, 12.5)).toBe(false);
        expect(isVisible(restored, 40.5, 12.5)).toBe(true);
        expect(updateFog(restored).buildings.some(b => b.id === 30)).toBe(true);
        restored.world.seed = 'different-map';
        expect(isExplored(restored, 10.5, 12.5)).toBe(false);
    });

    it('never reveals enemy reservations, active work, paused sites, or their fields', () => {
        const state = fixture(), active = building(35, 14, 12, 1), reserved = building(36, 15, 12, 1), paused = building(37, 16, 12, 1);
        active.construction = { startedAt: 2, duration: 30, waitingForBuilder: false, builderId: 91 };
        reserved.construction = { startedAt: 0, duration: 30, waitingForBuilder: true, builderId: 92 };
        paused.construction = { startedAt: 0, duration: 30, waitingForBuilder: true, pausedAt: 5 };
        state.time = 12; entityStore(state).buildings.add(active, reserved, paused);
        state.fields = [{ ...field(100, 14, 12), camp: active.id }];
        expect(isVisible(state, 14.5, 12.5)).toBe(true);
        for (const site of state.buildings) expect(entityVisible(state, site)).toBe(false);
        expect(updateFog(state).buildings).toEqual([]);
        expect(updateFog(state).fields).toEqual([]);
        expect(state.fog!.buildings).toEqual([]);

        state.units[0].x = 40.5; state.time = 18;
        delete active.construction;
        expect(updateFog(state).buildings).toEqual([]);
        const restored: GameState = JSON.parse(JSON.stringify(state));
        expect(updateFog(restored).buildings).toEqual([]);
        restored.units[0].x = 10.5;
        expect(updateFog(restored).buildings.map(b => b.id)).toEqual([active.id]);
        expect(updateFog(restored).fields.map(f => f.id)).toEqual([100]);
        expect(entityVisible(restored, restored.buildings[0])).toBe(true);
    });

    it('keeps player construction orders visible and removes them if captured while unfinished', () => {
        const state = fixture(), own = building(36, 40, 30, 0, 'house');
        own.construction = { startedAt: 0, duration: 30, waitingForBuilder: true };
        entityStore(state).buildings.add(own);
        expect(isVisible(state, 40.5, 30.5)).toBe(false);
        expect(entityVisible(state, own)).toBe(true);
        expect(updateFog(state).buildings[0].construction).toEqual(own.construction);
        own.faction = 1; state.time++;
        expect(updateFog(state).buildings).toEqual([]);
        expect(entityVisible(state, own)).toBe(false);
    });

    it('draws friendly tree orders through unexplored fog without enemy order markers or revealing terrain', () => {
        const state = fixture();
        state.world.tiles = Array.from({ length: state.world.width * state.world.height }, () => ({
            terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: .5,
        }));
        state.treeClearings = [{ x: 40, y: 30, faction: 0 }, { x: 41, y: 30, faction: 1 }, { x: 14, y: 12, faction: 1 }];
        const enemySite = building(50, 14, 12, 1, 'house'), ownSite = building(51, 42, 30, 0, 'road');
        enemySite.construction = ownSite.construction = { startedAt: 0, duration: 30, waitingForBuilder: true };
        entityStore(state).buildings.add(enemySite, ownSite);
        const fog = updateFog(state);
        expect(pointInSight(fog, 40.5, 30.5)).toBe(false);
        expect(fog.explored[30 * fog.width + 40]).toBe(0);
        const frame = recordNativeFrame(state, { fog });
        const markers = frame.sprites.filter(sprite => sprite.key === 'tree-clearing');
        expect(markers).toHaveLength(1);
        expect(markers[0]).toMatchObject({ x: (40 + .78) * 32, y: (30 + .18) * 32 });
        const buildings = frame.sprites.filter(sprite => sprite.key === 'building');
        expect(buildings.length).toBeGreaterThan(0);
        expect(buildings.every(sprite => sprite.x === ownSite.x * 32 && sprite.y === ownSite.y * 32)).toBe(true);
        expect(fog.explored[30 * fog.width + 40]).toBe(0);
    });

    it('freezes observed field occupancy, grain and harvests while hidden farms change or expand', () => {
        const state = fixture(), plot = field(100, 13, 12);
        state.time = 38; state.fields = [plot];
        entityStore(state).buildings.replace([building(20, 14, 12, 1)]);
        plot.claimedBy = 99; plot.expiresAt = 105;
        const seen = updateFog(state).fields[0];
        expect(seen).not.toBe(plot);
        expect(seen).toMatchObject({ id: 100, planted: true, food: 3, observedAt: 38, harvestedAt: 30, expiresAt: 105 });
        expect(seen.claimedBy).toBeUndefined();
        expect(fieldGrowth(seen, seen.observedAt)).toBe(1);

        state.units[0].x = 40.5; updateFog(state);
        Object.assign(plot, { planted: false, food: 0, harvestedAt: 60, nextHarvest: 90, expiresAt: undefined });
        state.fields.push(field(101, 15, 12));
        state.time = 80;
        expect(updateFog(state).fields).toEqual([seen]);

        const restored: GameState = JSON.parse(JSON.stringify(state));
        restored.time = 120;
        expect(updateFog(restored).fields).toEqual([seen]);
        expect(fieldGrowth(updateFog(restored).fields[0], seen.observedAt)).toBe(1);
        restored.units[0].x = 10.5;
        const revisited = updateFog(restored).fields;
        expect(revisited).toHaveLength(2);
        expect(revisited.find(field => field.id === 100)).toMatchObject({ planted: false, food: 0, observedAt: 120 });
    });

    it('retains vanished hidden fields until their own tile is scouted again', () => {
        const state = fixture();
        state.fields = [field(100, 13, 12)];
        updateFog(state);
        state.units[0].x = 40.5; updateFog(state);
        state.fields = [];
        expect(updateFog(state).fields.map(field => field.id)).toEqual([100]);
        state.units[0].x = 10.5;
        expect(updateFog(state).fields).toEqual([]);
        expect(state.fog!.fields).toEqual([]);
    });

    it('remembers a visible edge plot without revealing its unseen camp or opposite fields', () => {
        const state = fixture();
        state.units[0].x = 11.5;
        entityStore(state).buildings.replace([building(20, 21, 12, 1)]);
        state.fields = [field(100, 19, 12), field(101, 21, 12)];
        const fog = updateFog(state);
        expect(fog.buildings).toEqual([]);
        expect(fog.fields.map(field => field.id)).toEqual([100]);
    });

    it('loads older saves without field memories without revealing unseen live farms', () => {
        const state = fixture();
        entityStore(state).buildings.replace([building(20, 14, 12, 1)]);
        state.fields = [field(100, 13, 12), field(102, 45, 12, 0)];
        updateFog(state);
        state.units[0].x = 40.5; updateFog(state);
        delete state.fog!.fields;
        const restored: GameState = JSON.parse(JSON.stringify(state));
        expect(updateFog(restored).fields.map(field => field.id)).toEqual([102]);
        expect(updateFog(restored).buildings.map(building => building.id)).toContain(20);
        restored.units[0].x = 10.5;
        expect(updateFog(restored).fields.map(field => field.id).sort()).toEqual([100, 102]);
        restored.fields = [];
        expect(updateFog(restored).fields).toEqual([]);
    });

    it('uses radial sight and handles map edges and large building footprints', () => {
        const state = fixture();
        state.units[0].x = .5; state.units[0].y = .5;
        expect(isVisible(state, -1, 0)).toBe(false);
        expect(isVisible(state, 64, 12)).toBe(false);
        expect(isVisible(state, 7.5, .5)).toBe(true);
        expect(isVisible(state, 7.5, 7.5)).toBe(false);
        expect(entityVisible(state, building(40, 8, 0, 1, 'palace'))).toBe(true);
        expect(entityVisible(state, building(41, 8, 8, 1, 'palace'))).toBe(false);
    });
});
