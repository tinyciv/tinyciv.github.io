import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { geographicDiscoveryAt, initializeTreasureChests, TREASURE_GOLD, updateTreasureChests } from '../src/game/treasure';
import { updateFog } from '../src/game/fog';
import { travelTimeMap } from '../src/game/pathfinding';
import type { GameState } from '../src/game/types';
import { createGame } from '../src/game/simulation';
import { generateWorld } from '../src/world/generator';
import { ridgeFootprintAllowed, ridgeGroundWalkable, ridgeIsLedge } from '../src/game/ridges';

function fixture(): GameState {
    return { world: { width: 64, height: 48, seed: 'treasure-seed', source: 'test', spawns: [],
        tiles: Array.from({ length: 64 * 48 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .5, food: 2, production: 1, gold: 0, variation: .3 })) },
        units: [{ id: 1, kind: 'leader', faction: 0, x: 6.5, y: 6.5, hp: 100, morale: 100, attack: 25, defense: 5, speed: 3.6, range: 4,
            order: 'hold', cooldown: 0, lastCombat: -100, moving: false, facing: 0, attackTime: 0 }],
        buildings: [{ id: 2, kind: 'palace', faction: 0, x: 4, y: 8, hp: 650, maxHp: 650, capacity: 0 },
            { id: 3, kind: 'palace', faction: 1, x: 45, y: 8, hp: 650, maxHp: 650, capacity: 0 }],
        factions: [{ id: 0, name: 'Player', color: '#00f', affinity: 100, relation: 'self', food: 50, gold: 50, production: 0,
            population: 10, yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1000, defeated: false }],
        raiderCamps: [{ id: 10, size: 'small', name: 'Raiders', x: 22, y: 26, width: 7, height: 7, gate: { x: 25, y: 32 }, houses: [], nextRaidAt: 1000, waves: 0 }],
        time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
        buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'treasure-seed', rngState: 123 };
}

describe('wilderness treasure', () => {
    it('recognizes existing groves, passes and lake shores without inventing landmarks on empty plains', () => {
        const { world } = fixture(), x = 30, y = 30;
        expect(geographicDiscoveryAt(world, x, y)).toBeUndefined();
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++)
            if (dx || dy) world.tiles[(y + dy) * world.width + x + dx].overlay = 'forest';
        expect(geographicDiscoveryAt(world, x, y)).toBe('ancient-grove');
        world.tiles[y * world.width + x + 1].mountainPass = true;
        expect(geographicDiscoveryAt(world, x, y)).toBe('mountain-pass');
        for (const tile of world.tiles) { tile.overlay = 'none'; delete tile.mountainPass; }
        for (let dy = -2; dy <= 2; dy++) for (let dx = 1; dx <= 3; dx++) world.tiles[(y + dy) * world.width + x + dx].terrain = 'lake';
        expect(geographicDiscoveryAt(world, x, y)).toBe('lake-shore');
    });

    it('makes a rare contextual discovery with a named reward and records its collection once', () => {
        const state = fixture(); state.raiderCamps = [];
        for (let y = 35; y <= 40; y++) for (let x = 46; x <= 52; x++) state.world.tiles[y * 64 + x].terrain = 'lake';
        initializeTreasureChests(state);
        const discoveries = state.treasures!.filter(chest => chest.discovery);
        expect(discoveries).toHaveLength(1);
        const chest = discoveries[0];
        expect(chest.discovery).toBe('lake-shore'); expect(chest.name).toMatch(/Hidden Mere$/);
        expect(chest.rewardGold).toBeGreaterThan(TREASURE_GOLD);
        state.units[0].x = chest.x + .5; state.units[0].y = chest.y + .5;
        updateTreasureChests(state); updateTreasureChests(state);
        expect(state.factions[0].gold).toBe(50 + chest.rewardGold!);
        expect(state.events).toHaveLength(1); expect(state.events[0].text).toContain(chest.name);
    });

    it.each(['BTV-fog-of-war', 'treasure-valley', 'woodland-trails', 'river-crossings'])('seeds reachable, hidden treasure in generated world %s', seed => {
        const state = createGame(generateWorld(seed));
        const leader = state.units.find(unit => unit.kind === 'leader' && unit.faction === 0)!;
        const reachable = travelTimeMap(state, leader, 0, 1, Infinity), fog = updateFog(state);
        expect(state.treasures!.length).toBeGreaterThan(0);
        for (const chest of state.treasures!) {
            const cell = chest.y * state.world.width + chest.x;
            expect(Number.isFinite(reachable[cell])).toBe(true);
            expect(fog.explored[cell]).toBe(0);
            expect(state.world.tiles[cell].overlay).toBe('none');
            expect(['ocean', 'coast', 'river', 'lake']).not.toContain(state.world.tiles[cell].terrain);
            expect(ridgeFootprintAllowed(state.world, chest.x, chest.y)).toBe(true);
        }
        for (const unit of state.units) if (!unit.inside) {
            expect(ridgeGroundWalkable(state.world, unit.x, unit.y)).toBe(true);
            expect(ridgeIsLedge(state.world, unit.x, unit.y)).toBe(false);
        }
    });

    it('places deterministic, spaced, reachable chests beyond all settlements without consuming game RNG', () => {
        const state = fixture(), initial = updateFog(state).explored.slice(), rng = state.rngState;
        // The far right island is unreachable, despite offering ample empty land.
        for (let y = 0; y < 48; y++) state.world.tiles[y * 64 + 56].terrain = 'river';
        state.world.revision = 1;
        initializeTreasureChests(state);
        expect(state.rngState).toBe(rng);
        expect(state.treasures!.length).toBeGreaterThan(0); expect(state.treasures!.length).toBeLessThanOrEqual(5);
        const reachable = travelTimeMap(state, state.units[0], 0, 1, Infinity);
        for (const chest of state.treasures!) {
            const cell = chest.y * 64 + chest.x;
            expect(initial[cell]).toBe(0); expect(Number.isFinite(reachable[cell])).toBe(true);
            for (const palace of state.buildings) expect(Math.hypot(chest.x + .5 - palace.x - 1, chest.y + .5 - palace.y - 1)).toBeGreaterThanOrEqual(18);
            expect(Math.hypot(chest.x + .5 - 25.5, chest.y + .5 - 29.5)).toBeGreaterThanOrEqual(12);
            for (const other of state.treasures!) if (other !== chest) expect(Math.hypot(chest.x - other.x, chest.y - other.y)).toBeGreaterThanOrEqual(8);
        }
        const repeat = fixture(); repeat.world = structuredClone(state.world); repeat.rngState = 999;
        initializeTreasureChests(repeat); expect(repeat.treasures).toEqual(state.treasures);
    });

    it('never places treasure on already explored cells, fields, or impassable ground', () => {
        const state = fixture(), fog = updateFog(state);
        fog.explored.fill(1); fog.explored[42 * 64 + 50] = 0;
        state.world.tiles[42 * 64 + 50].overlay = 'glacier';
        initializeTreasureChests(state); expect(state.treasures).toEqual([]);
        const field = fixture(), fieldFog = updateFog(field); fieldFog.explored.fill(1); fieldFog.explored[42 * 64 + 50] = 0;
        field.fields = [{ id: 5, camp: 5, faction: 1, x: 50, y: 42, planted: false, food: 0, nextHarvest: 30 }];
        initializeTreasureChests(field); expect(field.treasures).toEqual([]);
    });

    it('keeps treasure off ledges, ramps and their landings while allowing reachable plateau floor', () => {
        const state = fixture(), { world } = state;
        for (let y = 32; y <= 45; y++) for (let x = 40; x <= 54; x++) world.tiles[y * world.width + x].ridge = 1;
        world.tiles[38 * world.width + 40].stair = 'east'; world.revision = 1;
        const fog = updateFog(state); fog.explored.fill(1);
        for (const [x, y] of [[45, 32], [40, 38], [39, 38], [41, 38], [46, 38]]) fog.explored[y * world.width + x] = 0;
        initializeTreasureChests(state);
        expect(state.treasures).toEqual([{ id: 1, x: 46, y: 38 }]);
    });

    it('only the living player Leader collects, awards exactly 200 once, and preserves collection on save', () => {
        const state = fixture(), leader = state.units[0]; state.treasures = [{ id: 1, x: 20, y: 20 }];
        entityStore(state).units.add({ ...leader, id: 20, kind: 'worker', x: 20.5, y: 20.5 });
        entityStore(state).units.add({ ...leader, id: 21, faction: 1, x: 20.5, y: 20.5 });
        updateTreasureChests(state); expect(state.factions[0].gold).toBe(50);
        leader.x = 20.5; leader.y = 20.5; leader.hp = 0;
        updateTreasureChests(state); expect(state.factions[0].gold).toBe(50);
        leader.hp = 100; updateTreasureChests(state);
        expect(state.factions[0].gold).toBe(50 + TREASURE_GOLD);
        expect(state.treasures[0].collected).toBe(true);
        expect(state.particles).toEqual([{ x: 20.5, y: 20.5, text: '+200 gold', color: '#ffe33d', life: 1.6, duration: 1.6 }]);
        const restored: GameState = JSON.parse(JSON.stringify(state));
        initializeTreasureChests(restored); updateTreasureChests(restored);
        expect(restored.treasures).toEqual(state.treasures); expect(restored.factions[0].gold).toBe(250);
        expect(restored.particles).toHaveLength(1);
    });
});
