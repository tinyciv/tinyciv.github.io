import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { beginNavigationFrame, canMove, canWalk, endNavigationFrame } from '../src/game/pathfinding';
import { NEUTRAL_WALL_FACTION, updateWallOwnership, WALL_CLAIM_RADIUS } from '../src/game/wall-ownership';
import type { Building, GameState } from '../src/game/types';

function fixture(): GameState {
    return {
        world: { width: 40, height: 32, seed: 'wall-ownership', source: 'test', spawns: [], revision: 0,
            tiles: Array.from({ length: 40 * 32 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3,
                moisture: .5, food: 2, production: 1, gold: 0, variation: .2 })) },
        buildings: [], units: [], factions: [0, 1, 2].map(id => ({ id, name: `Faction ${id}`, color: '#38f',
            affinity: 0, relation: id === 0 ? 'self' : 'war', food: 1000, gold: 1000, production: 0, population: 5,
            culture: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false })),
        time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], raiderCamps: [], marauderPacks: [],
        selected: null, selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false,
        seed: 'wall-ownership', rngState: 1,
    };
}
function add(state: GameState, kind: Building['kind'], faction: number, x = 16, y = 16): Building {
    const building: Building = { id: state.buildings.length + 1, kind, faction, x, y, hp: 100, maxHp: 100, capacity: kind === 'house' ? 4 : 0 };
    entityStore(state).buildings.add(building); return building;
}

describe('local wall ownership', () => {
    it('retains defended walls outside borders until their last local supporting building is destroyed', () => {
        const state = fixture(), wall = add(state, 'wall', 1), ownerHouse = add(state, 'well', 1, 18, 16);
        add(state, 'well', 0, 15, 15); add(state, 'well', 0, 15, 17); add(state, 'blacksmith', 0, 14, 16);
        expect(updateWallOwnership(state)).toBe(false);
        expect(wall.faction).toBe(1); // A larger rival town cannot steal a defended wall.
        ownerHouse.hp = 0;
        expect(updateWallOwnership(state)).toBe(true);
        expect(wall.faction).toBe(0);
    });

    it('leaves unsupported walls neutral; roads, farms, other walls and ruins do not preserve them', () => {
        const state = fixture(), wall = add(state, 'wall', 1);
        for (const kind of ['road', 'bridge', 'camp', 'shack', 'cottage', 'wall', 'palisade', 'ruin'] as const) add(state, kind, 1, 17, 17);
        add(state, 'house', 1, 18, 17).hp = 0;
        expect(updateWallOwnership(state)).toBe(true);
        expect(wall.faction).toBe(NEUTRAL_WALL_FACTION);
        expect(updateWallOwnership(state)).toBe(false);
    });

    it.each([false, true])('awards neutral walls to the unique building-count majority regardless of array order (%s)', reverse => {
        const state = fixture(), wall = add(state, 'palisade', -1);
        add(state, 'library', 0, 15, 16); // One large building counts once, not once per occupied tile.
        add(state, 'well', 1, 21, 15); add(state, 'woodenTower', 1, 21, 16); add(state, 'well', 1, 21, 17);
        add(state, 'well', 2, 17, 15); add(state, 'well', 2, 17, 17);
        if (reverse) entityStore(state).buildings.replace([...state.buildings].reverse());
        expect(updateWallOwnership(state)).toBe(true);
        expect(wall.faction).toBe(1);
    });

    it('keeps ties neutral until a completed building gives one faction a majority', () => {
        const state = fixture(), wall = add(state, 'wall', -1);
        add(state, 'well', 0, 15, 16); add(state, 'well', 1, 17, 16);
        expect(updateWallOwnership(state)).toBe(false);
        const order = add(state, 'blacksmith', 1, 17, 17);
        order.construction = { startedAt: 0, duration: 20 };
        expect(updateWallOwnership(state)).toBe(false);
        expect(wall.faction).toBe(-1);
        delete order.construction;
        expect(updateWallOwnership(state)).toBe(true);
        expect(wall.faction).toBe(1);
    });

    it('retains defeated owners while their buildings survive but prevents new defeated-faction claims', () => {
        const state = fixture(), wall = add(state, 'wall', 1), house = add(state, 'house', 1, 17, 16);
        state.factions[1].defeated = true;
        expect(updateWallOwnership(state)).toBe(false);
        expect(wall.faction).toBe(1);
        wall.faction = -1;
        expect(updateWallOwnership(state)).toBe(false);
        expect(wall.faction).toBe(-1);
        state.factions[1].defeated = false;
        expect(updateWallOwnership(state)).toBe(true);
        expect(wall.faction).toBe(1);
        house.hp = 0;
        expect(updateWallOwnership(state)).toBe(true);
        expect(wall.faction).toBe(-1);
    });

    it('uses an inclusive eight-tile radius and checks each wall locally', () => {
        const state = fixture(), near = add(state, 'wall', 0), far = add(state, 'wall', 0, 15, 15);
        add(state, 'house', 0, 16 + WALL_CLAIM_RADIUS, 16);
        expect(updateWallOwnership(state)).toBe(true);
        expect(near.faction).toBe(0);
        expect(far.faction).toBe(-1);
    });

    it('preserves commissioned unfinished walls until they are complete', () => {
        const state = fixture(), wall = add(state, 'wall', 0);
        wall.construction = { startedAt: 0, duration: 4, waitingForBuilder: true };
        expect(updateWallOwnership(state)).toBe(false);
        expect(wall.faction).toBe(0);
        delete wall.construction;
        expect(updateWallOwnership(state)).toBe(true);
        expect(wall.faction).toBe(-1);
    });

    it('keeps active raider camp walls until the core towers fall, but raiders cannot claim neutral walls', () => {
        const state = fixture(), wall = add(state, 'wall', -2), core = add(state, 'woodenTower', -2, 18, 16);
        wall.raiderCamp = core.raiderCamp = 1;
        state.raiderCamps = [{ id: 1, size: 'small', name: 'Camp', x: 16, y: 14, width: 5, height: 5, gate: { x: 16, y: 16 },
          houses: [], coreTowers: [core.id], nextRaidAt: Infinity, waves: 0 }];
        add(state, 'well', 0, 14, 16); add(state, 'well', 0, 14, 17);
        const neutral = add(state, 'wall', -1, 25, 16);
        expect(updateWallOwnership(state)).toBe(false);
        expect(wall.faction).toBe(-2);
        expect(neutral.faction).toBe(-1);
        core.hp = 0;
        expect(updateWallOwnership(state)).toBe(true);
        expect(wall.faction).toBe(0);
    });

    it('transfers gate paving with a claimed wall and invalidates same-frame gate access', () => {
        const state = fixture(), wall = add(state, 'wall', 1), road = add(state, 'road', 1);
        const approach = add(state, 'road', 1, 15, 16);
        wall.repairerId = road.repairerId = 99;
        add(state, 'house', 0, 18, 16);
        beginNavigationFrame(state);
        try {
            expect(canWalk(state, 16.5, 16.5, 0)).toBe(false);
            expect(canWalk(state, 16.5, 16.5, 1)).toBe(true);
            expect(updateWallOwnership(state)).toBe(true);
            expect(wall.faction).toBe(0); expect(road.faction).toBe(0);
            expect(approach.faction).toBe(0); // The road is also inside the claimant's borders.
            expect(wall.repairerId).toBeUndefined(); expect(road.repairerId).toBeUndefined();
            expect(canWalk(state, 16.5, 16.5, 0)).toBe(true);
            expect(canWalk(state, 16.5, 16.5, 1)).toBe(false);
        } finally { endNavigationFrame(state); }
    });

    it('rechecks direct building moves/removals and preserves revisions on unchanged frames', () => {
        const state = fixture(), wall = add(state, 'wall', 0), house = add(state, 'house', 0, 18, 16);
        expect(updateWallOwnership(state)).toBe(false);
        const revision = state.world.revision;
        house.hp = 80; state.time++;
        expect(updateWallOwnership(state)).toBe(false);
        expect(state.world.revision).toBe(revision);
        house.x = 35;
        expect(updateWallOwnership(state)).toBe(true);
        expect(wall.faction).toBe(-1);
        expect(state.world.revision).toBe(revision! + 1);
        house.x = 18;
        expect(updateWallOwnership(state)).toBe(true);
        expect(wall.faction).toBe(0);
        entityStore(state).buildings.replace(state.buildings.filter((_, index) => index < (state.buildings.indexOf(house)) || index >= (state.buildings.indexOf(house)) + (1)));
        expect(updateWallOwnership(state)).toBe(true);
        expect(wall.faction).toBe(-1);
    });

    it('pauses transferred gate paving, releases old workers and stops newly friendly attacks', () => {
        const state = fixture(), wall = add(state, 'wall', 1), road = add(state, 'road', 1);
        add(state, 'house', 0, 18, 16);
        state.time = 5;
        road.construction = { startedAt: 4, duration: 2, builderId: 100, waitingForBuilder: false, cleared: true };
        wall.repairerId = 101;
        const unit = { kind: 'worker' as const, x: 15.5, y: 16.5, hp: 100, morale: 100, attack: 0, defense: 0,
            speed: 2, range: 1, order: 'work' as const, cooldown: 0, lastCombat: -60, moving: true, facing: 0, attackTime: 1 };
        entityStore(state).units.add(
            { ...unit, id: 100, faction: 1, builder: true, buildSite: road.id, buildPhase: 'working', destination: { x: 16, y: 16 }, path: [{ x: 16, y: 16 }] },
            { ...unit, id: 101, faction: 1, builder: true, repairSite: wall.id, buildPhase: 'repairing' },
            { ...unit, id: 102, kind: 'warrior', faction: 0, order: 'follow', target: wall.id,
                forcedAttack: { target: wall.id, previousDestination: { x: 12.5, y: 12.5 }, previousRecallIssuedAt: 3, previousPosition: { x: 14.5, y: 14.5 } } },
        );
        const previousActivity = { ...state.units[2].forcedAttack };
        expect(updateWallOwnership(state)).toBe(true);
        expect(road.construction).toEqual({ startedAt: 4, duration: 2, waitingForBuilder: true, cleared: false, pausedAt: 5 });
        expect(road.faction).toBe(0);
        for (const worker of state.units.slice(0, 2)) {
            expect(worker.buildSite).toBeUndefined(); expect(worker.repairSite).toBeUndefined();
            expect(worker.buildPhase).toBe('returning'); expect(worker.destination).toBeUndefined(); expect(worker.path).toBeUndefined();
        }
        expect(state.units[2].target).toBeUndefined(); expect(state.units[2].forcedAttack).toEqual(previousActivity);
    });

    it('evacuates former-owner gate occupants onto legal ground before closing a captured gate', () => {
        const state = fixture(), wall = add(state, 'wall', 1);
        add(state, 'road', 1); add(state, 'house', 0, 18, 16);
        const warrior = { id: 100, kind: 'warrior' as const, faction: 1, x: 16.5, y: 16.5, hp: 100, morale: 100,
            attack: 12, defense: 4, speed: 3, range: 1, order: 'follow' as const, cooldown: 0,
            lastCombat: -60, moving: false, facing: 0, attackTime: 0 };
        entityStore(state).units.add(warrior);
        expect(canMove(state, warrior, { x: 15.5, y: 16.5 }, 1)).toBe(true);
        expect(updateWallOwnership(state)).toBe(true);
        expect(wall.faction).toBe(0);
        expect(warrior).toMatchObject({ x: 15.5, y: 16.5 });
        expect(canWalk(state, warrior.x, warrior.y, 1)).toBe(true);
        expect(canMove(state, warrior, { x: 14.5, y: 16.5 }, 1)).toBe(true);
        expect(canWalk(state, 16.5, 16.5, 1)).toBe(false);
    });

    it('keeps a gate public when its occupant has no exit and retries the claim after terrain opens', () => {
        const state = fixture(), wall = add(state, 'wall', 1), road = add(state, 'road', 1);
        add(state, 'house', 0, 18, 16);
        const warrior = { id: 100, kind: 'warrior' as const, faction: 1, x: 16.5, y: 16.5, hp: 100, morale: 100,
            attack: 12, defense: 4, speed: 3, range: 1, order: 'follow' as const, cooldown: 0,
            lastCombat: -60, moving: false, facing: 0, attackTime: 0 };
        entityStore(state).units.add(warrior);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy)
            state.world.tiles[(16 + dy) * state.world.width + 16 + dx].terrain = 'river';
        expect(updateWallOwnership(state)).toBe(true);
        expect(wall.faction).toBe(-1); expect(road.faction).toBe(-1);
        expect(warrior).toMatchObject({ x: 16.5, y: 16.5 });
        expect(canWalk(state, 16.5, 16.5, 1)).toBe(true);
        expect(updateWallOwnership(state)).toBe(false);
        expect(wall.faction).toBe(-1);
        // No building changes: pending claims must not use the static cache.
        state.world.tiles[16 * state.world.width + 15].terrain = 'grassland';
        state.world.revision!++;
        expect(updateWallOwnership(state)).toBe(true);
        expect(wall.faction).toBe(0); expect(road.faction).toBe(0);
        expect(warrior).toMatchObject({ x: 15.5, y: 16.5 });
        expect(canWalk(state, warrior.x, warrior.y, 1)).toBe(true);
    });
});
