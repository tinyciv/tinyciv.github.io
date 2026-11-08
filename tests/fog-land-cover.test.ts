import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { entityVisible, fogRenderMask, fogRevealMask, isExplored, pointInSight, updateFog } from '../src/game/fog';
import { territory } from '../src/game/borders';
import { landCoverSightCost, sightDistance } from '../src/game/sight';
import type { Building, Faction, GameState, Overlay, Unit, World } from '../src/game/types';

function fixture(overlay: Overlay = 'none'): GameState {
    const world: World = { width: 32, height: 28, seed: 'woodland-sight', source: 'test', revision: 0, spawns: [],
        tiles: Array.from({ length: 32 * 28 }, () => ({ terrain: 'grassland', overlay,
            elevation: .4, moisture: .5, food: 2, production: 1, gold: 0, variation: .3 })) };
    const leader: Unit = { id: 1, kind: 'leader', faction: 0, x: 10.5, y: 12.5, hp: 100, morale: 100,
        attack: 25, defense: 5, speed: 3.6, range: .85, order: 'follow', cooldown: 0, lastCombat: -100,
        moving: false, facing: 0, attackTime: 0 };
    return { world, units: [leader], buildings: [], factions: [], time: 0, tick: 0, paused: false, speed: 1,
        events: [], particles: [], selected: null, selectedType: null, buildMode: null, diplomacy: null,
        gameOver: false, victory: false, seed: world.seed, rngState: 1 };
}

function forestStrip(state: GameState, overlay: Overlay = 'forest'): void {
    for (let y = 0; y < state.world.height; y++) for (const x of [12, 13])
        state.world.tiles[y * state.world.width + x].overlay = overlay;
    state.world.revision = (state.world.revision ?? 0) + 1;
}

describe('land-cover line of sight', () => {
    it('observes owned woodland completely without revealing rival territory and updates claims without movement', () => {
        const state = fixture('forest'); entityStore(state).units.replace([]);
        const faction = (id: number): Faction => ({ id, name: `Faction ${id}`, color: '#397cc6', affinity: 50,
            relation: id ? 'war' : 'self', food: 100, gold: 100, production: 0, population: 1, yields: { food: 0, gold: 0, production: 0 }, nextRaid: 100, defeated: false, culture: 0 });
        state.factions = [faction(0), faction(1)];
        entityStore(state).buildings.replace([
            { id: 10, kind: 'palace', faction: 0, x: 9, y: 11, hp: 650, maxHp: 650, capacity: 0 },
            { id: 11, kind: 'palace', faction: 1, x: 25, y: 22, hp: 650, maxHp: 650, capacity: 0 },
        ]);
        const before = territory(state), fog = updateFog(state), mask = fogRenderMask(fog), revision = fog.revision;
        expect(pointInSight(fog, 11.5, 12.5)).toBe(true);
        expect(pointInSight(fog, 15.5, 12.5)).toBe(false); // Woodland now consumes cultural influence as well as sight.
        for (let i = 0; i < before.owners.length; i++) if (before.owners[i] === 0) {
            expect(fog.visible[i]).toBe(1); expect(fog.explored[i]).toBe(1);
            const x = i % fog.width, y = Math.floor(i / fog.width);
            for (let sy = 0; sy < mask.scale; sy++) for (let sx = 0; sx < mask.scale; sx++)
                expect(mask.alpha[(y * mask.scale + sy) * mask.width + x * mask.scale + sx]).toBe(0);
        }
        expect(pointInSight(fog, 26.5, 22.5)).toBe(false);
        expect(isExplored(state, 26.5, 22.5)).toBe(false);
        // Dense woodland keeps the first culture step inside the settlement's
        // guaranteed 4×4 footing/buffer. No visible change needs a fog revision.
        state.factions[0].culture = 100;
        expect([...territory(state).owners]).toEqual([...before.owners]);
        expect(updateFog(state).revision).toBe(revision);
        state.factions[0].culture = 300;
        const expanded = updateFog(state), claims = territory(state);
        expect(expanded.revision).toBeGreaterThan(revision);
        expect([...claims.owners].filter(owner => owner === 0).length).toBeGreaterThan([...before.owners].filter(owner => owner === 0).length);
        for (let i = 0; i < claims.owners.length; i++) if (claims.owners[i] === 0) expect(expanded.visible[i]).toBe(1);
        state.buildings[0].faction = 1;
        const lost = updateFog(state);
        expect(lost.visible.some(Boolean)).toBe(false);
        expect(lost.owned!.some(Boolean)).toBe(false);
    });

    it.each(['forest', 'jungle'] as const)('leaves 30% sight range, sampled once per %s cell', overlay => {
        const state = fixture(overlay), fog = updateFog(state), range = 9 * .3;
        expect(sightDistance(state.world, state.units[0], 12.5, 12.5)).toBeCloseTo(2 / .3);
        for (let y = 0; y < fog.height; y++) for (let x = 0; x < fog.width; x++) {
            const expected = Math.hypot(x + .5 - 10.5, y + .5 - 12.5) <= range;
            expect(!!fog.visible[y * fog.width + x]).toBe(expected);
            expect(pointInSight(fog, x + .01, y + .99)).toBe(expected);
            expect(pointInSight(fog, x + .99, y + .01)).toBe(expected);
        }
    });

    it('charges the actual forest distance between observers and targets in clearings', () => {
        const state = fixture(); forestStrip(state);
        const fog = updateFog(state);
        expect(state.world.tiles[12 * 32 + 10].overlay).toBe('none');
        expect(state.world.tiles[12 * 32 + 17].overlay).toBe('none');
        expect(sightDistance(state.world, state.units[0], 17.5, 12.5)).toBeCloseTo(5 + 2 / .3);
        expect(pointInSight(fog, 17.5, 12.5)).toBe(false);
        expect(pointInSight(fog, 3.5, 12.5)).toBe(true);
        expect(isExplored(state, 17.5, 12.5)).toBe(false);
        // Fractional traversal matters at both edges of a tree tile.
        expect(sightDistance(state.world, { x: 11.75, y: 12.5 }, 12.25, 12.5)).toBeCloseTo(.25 + .25 / .3);
        expect(sightDistance(state.world, { x: 12.25, y: 12.5 }, 11.75, 12.5)).toBeCloseTo(.25 + .25 / .3);
    });

    it('handles diagonal corner crossings and boundary-aligned rays without extra obstruction', () => {
        const state = fixture();
        state.world.tiles[13 * 32 + 12].overlay = 'forest';
        const start = { x: 12, y: 12 };
        // The diagonal only touches this forest tile at a corner.
        expect(sightDistance(state.world, start, 14, 14)).toBeCloseTo(Math.sqrt(8));
        expect(sightDistance(state.world, { x: 14, y: 14 }, 12, 12)).toBeCloseTo(Math.sqrt(8));
        expect(sightDistance(state.world, start, 12, 14)).toBeCloseTo(1 + 1 / .3);
        expect(sightDistance(state.world, start, 12, 12)).toBe(0);
    });

    it.each(['none', 'swamp', 'ford', 'volcano', 'glacier'] as const)('keeps the existing open-ground range for %s', overlay => {
        const state = fixture(overlay), fog = updateFog(state);
        expect(landCoverSightCost(overlay)).toBe(1);
        expect(pointInSight(fog, 19.99, 12.5)).toBe(true);
        expect(pointInSight(fog, 20, 12.5)).toBe(false);
    });

    it('updates stationary sight and the render mask as soon as trees are cleared', () => {
        const state = fixture(); forestStrip(state);
        const fog = updateFog(state), revision = fog.revision;
        const blocked = fogRevealMask(fog);
        const sample = Math.floor(12.5 * blocked.scale) * blocked.width + Math.floor(17.5 * blocked.scale);
        expect(blocked.alpha[sample]).toBe(0);
        expect(pointInSight(fog, 17.5, 12.5)).toBe(false);
        forestStrip(state, 'none');
        const cleared = updateFog(state);
        expect(cleared.revision).toBeGreaterThan(revision);
        expect(pointInSight(cleared, 17.5, 12.5)).toBe(true);
        expect(cleared.visible[12 * 32 + 17]).toBe(1);
        expect(cleared.explored[12 * 32 + 17]).toBe(1);
        expect(fogRevealMask(cleared).alpha[sample]).toBe(255);
        expect(fogRevealMask(cleared)).toBe(fogRevealMask(cleared));
    });

    it('replaces terrain-dependent caches when the world object changes with the same seed and size', () => {
        const state = fixture(), before = updateFog(state);
        expect(fogRevealMask(before).alpha.some(alpha => alpha === 255)).toBe(true);
        const replacement = structuredClone(state.world);
        replacement.tiles.forEach(tile => { tile.overlay = 'forest'; });
        state.world = replacement;
        const after = updateFog(state);
        expect(after).not.toBe(before);
        expect(after.world).toBe(replacement);
        expect(pointInSight(after, 17.5, 12.5)).toBe(false);
        const mask = fogRevealMask(after);
        expect(mask.alpha[Math.floor(12.5 * mask.scale) * mask.width + Math.floor(17.5 * mask.scale)]).toBe(0);
    });

    it('remembers explored terrain and last-seen buildings but hides live enemies behind woods', () => {
        const state = fixture(), enemy: Unit = { ...state.units[0], id: 2, faction: 1, x: 17.5 };
        const house: Building = { id: 3, x: 17, y: 12, kind: 'house', faction: 1, hp: 100, maxHp: 100, capacity: 4 };
        entityStore(state).units.add(enemy); entityStore(state).buildings.add(house);
        expect(entityVisible(state, enemy)).toBe(true);
        expect(entityVisible(state, house)).toBe(true);
        forestStrip(state);
        house.hp = 50; state.time++;
        const hidden = updateFog(state);
        expect(isExplored(state, 17.5, 12.5)).toBe(true);
        expect(entityVisible(state, enemy)).toBe(false);
        expect(entityVisible(state, house)).toBe(false);
        expect(hidden.buildings.find(building => building.id === house.id)?.hp).toBe(100);
        entityStore(state).units.add({ ...state.units[0], id: 4, x: 18.5 });
        expect(entityVisible(state, enemy)).toBe(true);
        expect(updateFog(state).buildings.find(building => building.id === house.id)?.hp).toBe(50);
    });

    it('softens only the visual woodland edge while retaining whole-cell sight', () => {
        const fog = updateFog(fixture('forest')), mask = fogRevealMask(fog);
        expect(mask.scale).toBe(8);
        expect(mask.width).toBe(fog.width * mask.scale);
        expect(mask.height).toBe(fog.height * mask.scale);
        for (let y = 0; y < fog.height; y++) for (let x = 0; x < fog.width; x++) {
            const visible = pointInSight(fog, x + .5, y + .5);
            expect(pointInSight(fog, x + .01, y + .99)).toBe(visible);
            expect(mask.alpha[(y * mask.scale + mask.scale / 2) * mask.width + x * mask.scale + mask.scale / 2]).toBe(visible ? 255 : 0);
            if (!visible) for (let sy = 0; sy < mask.scale; sy++) for (let sx = 0; sx < mask.scale; sx++)
                expect(mask.alpha[(y * mask.scale + sy) * mask.width + x * mask.scale + sx]).toBe(0);
        }
        expect(mask.alpha.some(alpha => alpha > 0 && alpha < 255)).toBe(true);
    });
});
