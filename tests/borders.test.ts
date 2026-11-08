import { recordNativeFrame } from './helpers/native-renderer';
import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { borderRadius, insideOwnBorders, territory, UNCLAIMED } from '../src/game/borders';
import { updateFog } from '../src/game/fog';
import type { Building, GameState } from '../src/game/types';

const building = (id: number, faction: number, x: number, y: number, kind: Building['kind'] = 'house'): Building => ({ id, faction, x, y, kind, hp: 100, maxHp: 100, capacity: 4 });
function fixture(): GameState {
    return { world: { width: 48, height: 32, seed: 'territory', source: 'test', spawns: [],
        tiles: Array.from({ length: 48 * 32 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .5, food: 2, production: 1, gold: 0, variation: .3 })) },
        units: [], buildings: [building(1, 0, 8, 8, 'palace')],
        factions: [0, 1].map(id => ({ id, name: `Faction ${id}`, color: id ? '#f00' : '#00f', affinity: 0, relation: id ? 'war' : 'self', food: 50, gold: 50, production: 0,
            population: 10, yields: { food: 0, gold: 0, production: 0 }, nextRaid: 1000, defeated: false })),
        time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
        buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'territory', rngState: 1 };
}

describe('settlement borders', () => {
    it('validates direct source edits and equivalent array replacements without retaining object aliases', () => {
        const state = fixture(); entityStore(state).buildings.replace([building(1, 0, 8, 8)]);
        const first = territory(state);
        entityStore(state).buildings.replace(state.buildings.map(source => ({ ...source })));
        state.factions = state.factions.map(faction => ({ ...faction }));
        expect(territory(state)).toBe(first);
        state.buildings[0].x = 28;
        const moved = territory(state);
        expect(moved.revision).toBe(first.revision + 1);
        expect(insideOwnBorders(state, 0, 8.5, 8.5)).toBe(false);
        expect(insideOwnBorders(state, 0, 28.5, 8.5)).toBe(true);
        state.buildings[0].faction = 1;
        expect(insideOwnBorders(state, 0, 28.5, 8.5)).toBe(false);
        expect(insideOwnBorders(state, 1, 28.5, 8.5)).toBe(true);
        entityStore(state).setBuildingKind(state.buildings[0], 'monument');
        expect(insideOwnBorders(state, 1, 32.5, 8.5)).toBe(true);
        expect(insideOwnBorders(state, 1, 33.5, 8.5)).toBe(false);
        const changed = territory(state);
        state.factions[1].defeated = true;
        expect(territory(state).revision).toBe(changed.revision + 1);
        expect(insideOwnBorders(state, 1, 28.5, 8.5)).toBe(false);
    });

    it('keeps logical revisions stable when irrelevant properties and ineligible entities change', () => {
        const state = fixture(), first = territory(state);
        state.buildings[0].hp = 50; state.buildings[0].capacity = 12;
        state.factions[0].culture = 99; state.factions[0].population = 123;
        const pending = building(2, 0, 28, 8); pending.construction = { startedAt: 0, duration: 20 };
        const road = building(3, 0, 29, 8, 'road');
        entityStore(state).buildings.add(pending, road, building(4, 99, 30, 8));
        expect(territory(state)).toBe(first);
        pending.construction.startedAt = 10; road.x = 30; road.hp = 0;
        entityStore(state).buildings.replace([...state.buildings].reverse());
        expect(territory(state)).toBe(first);
        delete pending.construction;
        expect(territory(state).revision).toBe(first.revision + 1);
    });

    it('retains Map-derived faction semantics and observes world replacement and revision changes', () => {
        const state = fixture(), first = territory(state);
        // A duplicate with identical values does not alter Map iteration or claims.
        state.factions.push({ ...state.factions[0] });
        expect(territory(state)).toBe(first);
        expect(territory(state)).toBe(first);
        state.factions[state.factions.length - 1].culture = 100;
        const expanded = territory(state);
        expect(expanded.revision).toBe(first.revision + 1);
        state.world = { ...state.world, tiles: state.world.tiles.map(tile => ({ ...tile })) };
        const replaced = territory(state);
        expect(replaced.revision).toBe(expanded.revision + 1);
        state.world.tiles[8 * 48 + 8].terrain = 'ocean'; state.world.revision = 1;
        // The settlement's protected footing remains owned even if the map is edited.
        expect(territory(state).owners[8 * 48 + 8]).toBe(0);
    });

    it('uses fixed bases plus culture levels and ignores population, including cache invalidation', () => {
        const state = fixture(), first = territory(state);
        expect(borderRadius('palace')).toBe(6.5); expect(borderRadius('house')).toBe(3.25); expect(borderRadius('monument')).toBe(4);
        expect(borderRadius('house', 300)).toBeCloseTo(4.5 * 1.3);
        expect(insideOwnBorders(state, 0, 14.5, 9.5)).toBe(true);
        expect(insideOwnBorders(state, 0, 15.5, 9.5)).toBe(false);
        expect(territory(state)).toBe(first);
        for (const population of [0, 20, 500]) {
            state.factions[0].population = population;
            expect(territory(state)).toBe(first);
            expect(insideOwnBorders(state, 0, 15.5, 9.5)).toBe(false);
        }
        state.factions[0].culture = 99;
        expect(territory(state)).toBe(first);
        state.factions[0].culture = 100;
        expect(territory(state).revision).toBe(first.revision + 1);
        expect(insideOwnBorders(state, 0, 15.5, 9.5)).toBe(true);
        const expanded = territory(state);
        state.factions[0].culture = 299.9;
        expect(territory(state)).toBe(expanded);
        state.factions[0].culture = 300;
        expect(territory(state).revision).toBe(expanded.revision + 1);
        expect(insideOwnBorders(state, 0, 17.5, 9.5)).toBe(true);
        const house = building(2, 0, 35, 20); house.construction = { startedAt: 0, duration: 20 };
        entityStore(state).buildings.add(house);
        expect(insideOwnBorders(state, 0, 35.5, 20.5)).toBe(false);
        delete house.construction;
        expect(insideOwnBorders(state, 0, 35.5, 20.5)).toBe(true);
        house.hp = 0;
        expect(insideOwnBorders(state, 0, 35.5, 20.5)).toBe(false);
    });

    it('claims the doubled four-tile monument radius, then spends culture on further reach', () => {
        const state = fixture(), monument = building(3, 0, 30, 20, 'monument');
        monument.construction = { startedAt: 0, duration: 20, waitingForBuilder: true };
        entityStore(state).buildings.add(monument);
        expect(insideOwnBorders(state, 0, 30.5, 20.5)).toBe(false);
        const unfinished = territory(state); delete monument.construction;
        expect(territory(state)).not.toBe(unfinished);
        // Test the entire local disk, including its exact axial radius and
        // excluded diagonal/next-ring cells, before any culture is earned.
        for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++)
            expect(insideOwnBorders(state, 0, 30.5 + dx, 20.5 + dy)).toBe(dx * dx + dy * dy <= 16);
        state.factions[0].culture = 100;
        expect(borderRadius('monument', 100)).toBe(5.3);
        expect(insideOwnBorders(state, 0, 35.5, 20.5)).toBe(true);
        expect(insideOwnBorders(state, 0, 36.5, 20.5)).toBe(false);
        monument.faction = 1;
        expect(insideOwnBorders(state, 0, 35.5, 20.5)).toBe(false);
        expect(insideOwnBorders(state, 1, 34.5, 20.5)).toBe(true);
        expect(insideOwnBorders(state, 1, 35.5, 20.5)).toBe(false);
        monument.hp = 0;
        expect(insideOwnBorders(state, 1, 30.5, 20.5)).toBe(false);
        expect(insideOwnBorders(state, 0, 14.5, 9.5)).toBe(true);
    });

    it('spends more cultural influence crossing woods and expands again after clearing them', () => {
        const state = fixture(), clear = territory(state);
        for (let y = 3; y <= 15; y++) state.world.tiles[y * 48 + 12].overlay = y % 2 ? 'forest' : 'jungle';
        state.world.revision = 1;
        const wooded = territory(state);
        expect(wooded).not.toBe(clear);
        expect(insideOwnBorders(state, 0, 12.5, 9.5)).toBe(true); // Can afford the woodland edge.
        expect(insideOwnBorders(state, 0, 14.5, 9.5)).toBe(false); // Clear land behind the same stand costs more too.
        expect(insideOwnBorders(state, 0, 3.5, 9.5)).toBe(true); // Open westward reach is unchanged.
        expect(territory(state)).toBe(wooded);
        state.factions[0].culture = 300;
        expect(insideOwnBorders(state, 0, 14.5, 9.5)).toBe(true);
        state.factions[0].culture = 0;
        for (let y = 3; y <= 15; y++) state.world.tiles[y * 48 + 12].overlay = 'none';
        state.world.revision++;
        expect([...territory(state).owners]).toEqual([...clear.owners]);
    });

    it('uses cultural traversal cost rather than geometric distance in contested land', () => {
        const state = fixture();
        entityStore(state).buildings.replace([building(1, 0, 10, 10), building(2, 1, 14, 10)]);
        expect(territory(state).owners[10 * 48 + 12]).toBe(0); // Equal open-ground distance, lower faction wins.
        state.world.tiles[10 * 48 + 11].overlay = 'forest'; state.world.revision = 1;
        expect(territory(state).owners[10 * 48 + 12]).toBe(1);
        const owners = [...territory(state).owners]; entityStore(state).buildings.replace([...state.buildings].reverse());
        expect([...territory(state).owners]).toEqual(owners);
    });

    it('keeps the irregular woodland claim connected to its source', () => {
        const state = fixture();
        for (let y = 3; y <= 15; y++) for (let x = 3; x <= 15; x++)
            if ((x * 13 + y * 7) % 11 < 3) state.world.tiles[y * 48 + x].overlay = 'forest';
        const owners = territory(state).owners, seed = 8 * 48 + 8, reached = new Set([seed]), queue = [seed];
        for (let head = 0; head < queue.length; head++) {
            const at = queue[head], x = at % 48, y = Math.floor(at / 48);
            for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
                const next = (y + dy) * 48 + x + dx;
                if (x + dx < 0 || x + dx >= 48 || y + dy < 0 || y + dy >= 32 || owners[next] !== 0 || reached.has(next)) continue;
                reached.add(next); queue.push(next);
            }
        }
        expect(reached.size).toBe([...owners].filter(owner => owner === 0).length);
    });

    it('transmits influence across unclaimed water consistently in wooded surroundings', () => {
        const state = fixture();
        for (let y = 0; y < 32; y++) for (const x of [10, 11]) state.world.tiles[y * 48 + x].terrain = 'lake';
        expect(insideOwnBorders(state, 0, 12.5, 9.5)).toBe(true);
        state.world.tiles[5 * 48 + 5].overlay = 'forest'; state.world.revision = 1;
        expect(insideOwnBorders(state, 0, 12.5, 9.5)).toBe(true);
        expect(insideOwnBorders(state, 0, 10.5, 9.5)).toBe(true); // Immediate coastal buffer.
        expect(insideOwnBorders(state, 0, 11.5, 9.5)).toBe(false); // Farther water remains unclaimed.
    });

    it('never grants territory to raider, neutral, missing or defeated factions', () => {
        const state = fixture();
        entityStore(state).buildings.replace([building(1, -2, 8, 8, 'palace'), building(2, -1, 20, 8), building(3, 99, 32, 8, 'monument')]);
        state.factions.push({ ...state.factions[1], id: -2, culture: 10000 });
        expect([...territory(state).owners].every(owner => owner === UNCLAIMED)).toBe(true);
        expect(territory(state).edges).toEqual([]);
        expect(insideOwnBorders(state, -2, 8.5, 8.5)).toBe(false);
        const home = building(4, 1, 20, 20); entityStore(state).buildings.add(home);
        expect(insideOwnBorders(state, 1, 20.5, 20.5)).toBe(true);
        state.factions[1].defeated = true;
        expect(insideOwnBorders(state, 1, 20.5, 20.5)).toBe(false);
    });

    it('claims rivers, excludes open water, and resolves overlaps independently of building order', () => {
        const state = fixture(); entityStore(state).buildings.replace([building(1, 0, 10, 10), building(2, 1, 14, 10)]);
        const before = Array.from(territory(state).owners);
        expect(insideOwnBorders(state, 0, 12.5, 10.5)).toBe(true);
        expect(insideOwnBorders(state, 1, 13.5, 10.5)).toBe(true);
        entityStore(state).buildings.replace([...state.buildings].reverse());
        expect(Array.from(territory(state).owners)).toEqual(before);
        state.world.tiles[10 * 48 + 12].terrain = 'river'; state.world.revision = 1;
        expect(territory(state).owners[10 * 48 + 12]).toBe(0);
        for (const terrain of ['lake', 'coast', 'ocean'] as const) {
            state.world.tiles[10 * 48 + 12].terrain = terrain; state.world.revision!++;
            expect(territory(state).owners[10 * 48 + 12]).toBe(UNCLAIMED);
        }
        expect(insideOwnBorders(state, 0, -1, 10)).toBe(false);
        state.factions[1].defeated = true;
        expect(insideOwnBorders(state, 1, 14.5, 10.5)).toBe(false);
    });

    it('has no bank outline along a river fully inside one faction’s territory', () => {
        const state = fixture();
        for (let y = 0; y < 32; y++) state.world.tiles[y * 48 + 9].terrain = 'river';
        const borders = territory(state);
        for (let y = 7; y <= 11; y++) {
            for (const x of [8, 9, 10]) expect(insideOwnBorders(state, 0, x + .5, y + .5)).toBe(true);
            expect(borders.edges.some(edge => !edge.horizontal && [9, 10].includes(edge.x) && edge.y === y)).toBe(false);
        }
        expect(territory(state).paths).toBe(borders.paths);
    });

    it.each([[14, 10], [10, 14]])('retains both owners of a frontier toward (%i,%i) without duplicate physical edges', (x, y) => {
        const state = fixture();
        entityStore(state).buildings.replace([building(1, 0, 10, 10), building(2, 1, x, y)]);
        const borders = territory(state), shared = borders.edges.filter(edge => edge.neighborFaction !== undefined);
        expect(shared.length).toBeGreaterThan(0);
        expect(new Set(borders.edges.map(edge => `${edge.x},${edge.y},${edge.horizontal}`)).size).toBe(borders.edges.length);
        for (const edge of shared) {
            expect([edge.faction, edge.neighborFaction].sort()).toEqual([0, 1]);
            expect(borders.owners[edge.cell]).toBe(edge.faction);
            expect(borders.owners[edge.neighborCell!]).toBe(edge.neighborFaction);
            expect(edge.cell - edge.neighborCell!).toBe(edge.horizontal ? state.world.width : 1);
        }
        entityStore(state).buildings.replace([...state.buildings].reverse());
        expect(territory(state).edges).toEqual(borders.edges);
    });

    it('joins rounded shared turns continuously even when the two spatial owners switch sides', () => {
        const state = fixture();
        entityStore(state).buildings.replace([building(1, 0, 10, 10), building(2, 1, 14, 14)]);
        const paths = territory(state).paths.filter(path => path.edge.neighborFaction !== undefined);
        const endpoints = new Map<string, { x: number; y: number }[]>();
        for (const path of paths) {
            for (const [key, point] of [[`${path.edge.x},${path.edge.y}`, path.start],
                [`${path.edge.x + Number(path.edge.horizontal)},${path.edge.y + Number(!path.edge.horizontal)}`, path.end]] as const) {
                const points = endpoints.get(key) ?? []; points.push(point); endpoints.set(key, points);
            }
        }
        const joins = [...endpoints.values()].filter(points => points.length === 2);
        expect(joins.length).toBeGreaterThan(0);
        expect(paths.some(path => path.from || path.to)).toBe(true);
        for (const [a, b] of joins) expect(a).toEqual(b);
    });

    it('paints each shared path once with white-blue-white-red stripes, retaining external two-color borders', () => {
        const state = fixture();
        entityStore(state).buildings.replace([building(1, 0, 10, 10), building(2, 1, 14, 10)]);
        const fog = updateFog(state); fog.visible.fill(1);
        const frame = recordNativeFrame(state, { fog }), borders = territory(state);
        const shared = borders.paths.filter(path => path.edge.neighborFaction !== undefined);
        const sprites = frame.sprites.filter(sprite => sprite.key.startsWith('border:'));
        expect(sprites).toHaveLength(borders.paths.length);
        const sharedStrokes = frame.strokes.filter(stroke => stroke.key.includes('#00f,#f00'));
        expect(sharedStrokes).toHaveLength(shared.length * 3);
        const straight = shared.find(path => !path.from && !path.to)!;
        expect(straight).toBeDefined();
        const strokes = sharedStrokes.filter(stroke => stroke.commands[0][1] === straight.edge.x * 32
            && stroke.commands[0][2] === straight.edge.y * 32);
        expect(strokes).toHaveLength(3);
        // Sample the resulting dash coverage, rather than just matching the
        // implementation's offsets: no segment may be blank or doubly painted.
        const sample = (distance: number) => strokes.filter(stroke => {
            const period = stroke.dash.reduce((sum, value) => sum + value, 0);
            const phase = ((distance + stroke.offset) % period + period) % period;
            return phase < stroke.dash[0];
        }).map(stroke => stroke.color);
        expect([4, 12, 20, 28, 36, 44, 52, 60].map(sample)).toEqual([
            ['#fff8e5'], ['#00f'], ['#fff8e5'], ['#f00'], ['#fff8e5'], ['#00f'], ['#fff8e5'], ['#f00'],
        ]);
        const external = frame.strokes.filter(stroke => stroke.key.startsWith('border:') && !stroke.key.includes('#00f,#f00'));
        expect(external).toHaveLength((borders.paths.length - shared.length) * 2);
        expect(external.every(stroke => stroke.dash.join(',') === '8,8')).toBe(true);
    });

    it('draws both frontier colors from either visible side and through remembered fog', () => {
        const state = fixture();
        entityStore(state).buildings.replace([building(1, 0, 10, 10), building(2, 1, 14, 10)]);
        const borders = territory(state), shared = borders.edges.find(edge => edge.neighborFaction !== undefined)!;
        const fog = updateFog(state);
        for (const cell of [shared.cell, shared.neighborCell!, undefined]) {
            fog.visible.fill(0); if (cell !== undefined) fog.visible[cell] = 1;
            const frame = recordNativeFrame(state, { fog });
            expect(new Set(frame.strokes.filter(stroke => stroke.key.startsWith('border:')).map(stroke => stroke.color)))
                .toEqual(new Set(['#fff8e5', '#f00', '#00f']));
            expect(frame.sprites.filter(sprite => sprite.key.startsWith('border:') && sprite.x === shared.x * 32 && sprite.y === shared.y * 32)).toHaveLength(1);
            expect(frame.drawOrder.findIndex(key => key.startsWith('border:'))).toBeGreaterThan(frame.drawOrder.indexOf('fog'));
        }
    });

    it('retains curved translucent stripes on discovered ground but hides unexplored growth', () => {
        const state = fixture(); entityStore(state).buildings.add(building(2, 1, 36, 20));
        const fog = updateFog(state); fog.explored.fill(1);
        const draw = () => recordNativeFrame(state, { fog }).strokes.filter(stroke => stroke.key.startsWith('border:'));
        const strokes = draw();
        expect(new Set(strokes.map(stroke => stroke.color))).toEqual(new Set(['#fff8e5', '#00f', '#f00']));
        expect(strokes.every(stroke => stroke.width === 3 && stroke.opacity === .75)).toBe(true);
        expect(strokes.every(stroke => stroke.dash.join(',') === '8,8')).toBe(true);
        expect(strokes.filter(stroke => stroke.color === '#fff8e5').every(stroke => stroke.offset === 0)).toBe(true);
        expect(strokes.filter(stroke => stroke.color === '#00f').every(stroke => stroke.offset === 8)).toBe(true);
        const curves = strokes.flatMap(stroke => stroke.commands.filter(command => command[0] === 2));
        expect(curves.length).toBeGreaterThan(0);
        expect(curves.every(([, cx, cy, x, y]) => cx !== x || cy !== y)).toBe(true);
        state.factions[1].culture = 300;
        const expanded = draw(); expect(expanded).not.toEqual(strokes);
        fog.visible.fill(0);
        fog.explored.fill(0);
        expect(draw()).toEqual([]);
        fog.explored.fill(1);
        expect(draw()).toEqual(expanded);
    });
});
