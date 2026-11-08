import { entityStore } from '../src/game/entity-store';
import { unlockBuildingResearch } from './helpers/research';
import { describe, expect, it } from 'vitest';
import { buildingWithinBorders } from '../src/game/border-placement';
import { insideOwnBorders, territory } from '../src/game/borders';
import { buildAt, createGame, updateGame, validateBuildAt, BUILD_COSTS } from '../src/game/simulation';
import { constructionLine, planConstruction } from '../src/game/construction';
import { recordTraffic, ROAD_TRAFFIC_THRESHOLD, updateTraffic } from '../src/game/traffic';
import { synchronizeFarms } from '../src/game/farms';
import { updateFog } from '../src/game/fog';
import { ridgeFootprintAllowed } from '../src/game/ridges';
import { type Building, type BuildingKind, type GameState } from '../src/game/types';

function fixture(): GameState {
    const state: GameState = { world: { width: 40, height: 32, seed: 'border-placement', source: 'test', revision: 1, spawns: [],
        tiles: Array.from({ length: 1280 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .5, food: 3, production: 1, gold: 0, variation: .3 })) },
        units: [{ id: 1, kind: 'leader', faction: 0, x: 12.5, y: 12.5, hp: 100, morale: 100, attack: 17.5, defense: 4, speed: 3.6, range: 4, order: 'hold', cooldown: 0, lastCombat: -100, moving: false, facing: 0, attackTime: 0 }],
        buildings: [{ id: 2, kind: 'palace', faction: 0, x: 10, y: 10, hp: 650, maxHp: 650, capacity: 0 }],
        factions: [0, 1].map(id => ({ id, name: `Faction ${id}`, color: '#3988ff', affinity: 0, relation: id ? 'peace' : 'self', food: 500, gold: 10000, production: 0,
            population: 30, culture: 0, yields: { food: 0, gold: 0, production: 0 }, nextRaid: Infinity, defeated: false })),
        time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], fields: [], treasures: [],
        marauderPacks: [], raiderCamps: [], roamingMaraudersVersion: 1, fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 1 },
        selected: null, selectedType: null, buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'border-placement', rngState: 1 };
    state.factions.forEach(unlockBuildingResearch);
  updateFog(state); return state;
}
function add(state: GameState, kind: BuildingKind, x: number, y: number, faction = 0): Building {
    const building: Building = { id: state.buildings.length + 1000, kind, x, y, faction, hp: 100, maxHp: 100, capacity: 0 };
    entityStore(state).buildings.add(building); return building;
}

describe('construction territory rules', () => {
    it.each(['house', 'woodenTower', 'guardPost', 'well', 'monument', 'fort'] as const)('rejects an explored %s order outside the border without spending or reserving land', kind => {
        const state = fixture();
        const before = JSON.stringify(state);
        expect(validateBuildAt(state, kind, 18, 12)).toEqual({ ok: false, message: 'Build entirely within your faction’s borders.' });
        expect(JSON.stringify(state)).toBe(before);
        expect(buildAt(state, kind, 18, 12).ok).toBe(false);
        expect(JSON.stringify(state)).toBe(before);
    });

    it('requires every Fort footprint cell to be owned, even when its first cell is inside', () => {
        const state = fixture();
        expect(insideOwnBorders(state, 0, 16.5, 12.5)).toBe(true);
        expect(insideOwnBorders(state, 0, 17.5, 12.5)).toBe(false);
        expect(buildingWithinBorders(state, 'fort', 16, 12)).toBe(false);
        expect(validateBuildAt(state, 'fort', 16, 12)).toMatchObject({ ok: false, message: 'Build entirely within your faction’s borders.' });
        expect(buildingWithinBorders(state, 'palace', 16, 12)).toBe(true);
    });

    it('queues a complete bridge across an unclaimed wide river while retaining terrain and world bounds', () => {
        const state = fixture();
        state.factions[0].research!.levels.engineering = 1;
        for (let y = 0; y < 32; y++) for (let x = 18; x <= 21; x++) state.world.tiles[y * 40 + x].terrain = 'river';
        state.world.revision!++;
        expect(insideOwnBorders(state, 0, 18.5, 12.5)).toBe(false);
        const line = constructionLine({ x: 18, y: 12 }, { x: 21, y: 12 });
        expect(planConstruction(state, 'bridge', line).tiles).toEqual(line);
        for (const point of line) expect(buildAt(state, 'bridge', point.x, point.y).ok).toBe(true);
        expect(state.buildings.filter(building => building.kind === 'bridge' && building.construction)).toHaveLength(4);
        expect(validateBuildAt(state, 'bridge', 17, 12).ok).toBe(false);
        expect(buildingWithinBorders(state, 'bridge', 40, 12)).toBe(false);
    });

    it('allows construction on stairs and landings while rejecting cliff faces and mixed-height footprints', () => {
        const state = fixture();
        state.world.tiles[12 * 40 + 17].ridge = 1;
        expect(validateBuildAt(state, 'camp', 16, 12).ok).toBe(true);
        expect(validateBuildAt(state, 'camp', 17, 12).ok).toBe(false);
        // A valid north-facing flight joins low ground to the plateau interior.
        for (let y = 9; y <= 12; y++) for (let x = 15; x <= 18; x++) state.world.tiles[y * 40 + x].ridge = 1;
        state.world.tiles[12 * 40 + 16].stair = 'north';
        state.world.revision!++;
        expect(validateBuildAt(state, 'wall', 16, 12).ok).toBe(true);
        expect(validateBuildAt(state, 'wall', 16, 13).ok).toBe(true);
        expect(validateBuildAt(state, 'wall', 16, 11).ok).toBe(true);
        expect(validateBuildAt(state, 'camp', 17, 12).ok).toBe(false);
        expect(ridgeFootprintAllowed(state.world, 16, 12, 1, 2)).toBe(false);
    });

    it('allows farm plots beyond the border while keeping complete world bounds and palace claims', () => {
        const state = fixture();
        expect(insideOwnBorders(state, 0, 16.5, 12.5)).toBe(true);
        expect(buildingWithinBorders(state, 'house', 16, 12)).toBe(true);
        expect(buildingWithinBorders(state, 'camp', 16, 12)).toBe(true);
        expect(validateBuildAt(state, 'camp', 16, 12).ok).toBe(true);
        expect(buildingWithinBorders(state, 'camp', 15, 12)).toBe(true);
        expect(buildingWithinBorders(state, 'palace', 16, 12)).toBe(true);
        expect(buildingWithinBorders(state, 'palace', 15, 11)).toBe(true);
        expect(buildingWithinBorders(state, 'camp', -.5, 1)).toBe(false);
        expect(buildingWithinBorders(state, 'camp', 39, 12)).toBe(true);
        expect(buildingWithinBorders(state, 'camp', 40, 12)).toBe(false);
        expect(buildingWithinBorders(state, 'road', 40, 12)).toBe(false);
        expect(buildingWithinBorders(state, 'road', 18, 12, -2)).toBe(false);
    });

    it.each(['road', 'camp', 'wall', 'palisade'] as const)('places a visible %s outside borders without relaxing its normal placement rules', kind => {
        const state = fixture();
        expect(insideOwnBorders(state, 0, 18.5, 12.5)).toBe(false);
        if (kind === 'road') {
            expect(validateBuildAt(state, kind, 18, 12).message).toBe('Extend an existing road or bridge, or start from a ford.');
            add(state, 'road', 17, 12);
        } else {
            state.world.tiles[12 * 40 + 18].terrain = 'river';
            expect(validateBuildAt(state, kind, 18, 12).ok).toBe(false);
            state.world.tiles[12 * 40 + 18].terrain = 'grassland';
        }
        const gold = state.factions[0].gold;
        expect(validateBuildAt(state, kind, 18, 12).ok).toBe(true);
        expect(buildAt(state, kind, 18, 12).ok).toBe(true);
        expect(state.buildings.some(building => building.kind === kind && building.x === 18 && building.y === 12 && building.construction)).toBe(true);
        expect(state.factions[0].gold).toBe(gold - BUILD_COSTS[kind].gold);
    });

    it('does not let a queued monument expand construction land until it completes', () => {
        const state = fixture();
        expect(buildAt(state, 'monument', 16, 11).ok).toBe(true);
        const monument = state.buildings.at(-1)!, gold = state.factions[0].gold;
        const reserved = territory(state);
        expect(buildAt(state, 'monument', 18, 11).message).toContain('borders');
        expect(state.factions[0].gold).toBe(gold); expect(territory(state)).toBe(reserved);
        delete monument.construction;
        expect(validateBuildAt(state, 'monument', 18, 11).ok).toBe(true);
    });

    it('does not let an outlying wall grant land for a tower or guard post', () => {
        const state = fixture(); add(state, 'wall', 18, 12);
        expect(insideOwnBorders(state, 0, 18.5, 12.5)).toBe(false);
        for (const kind of ['woodenTower', 'guardPost'] as const)
            expect(validateBuildAt(state, kind, 18, 12).message).toContain('borders');
    });

    it.each(['wall', 'palisade'] as const)('extends a %s drag across the border and keeps the preview read-only', kind => {
        const state = fixture(), before = JSON.stringify(state);
        const line = constructionLine({ x: 15, y: 11 }, { x: 20, y: 11 });
        const plan = planConstruction(state, kind, line);
        expect(plan.cells.every(cell => cell.ok)).toBe(true);
        expect(plan.tiles).toEqual(line);
        expect(JSON.stringify(state)).toBe(before);
    });

    it('uses each faction’s own territory for NPC construction and never treats allies as ownership', () => {
        const state = fixture(); add(state, 'palace', 28, 10, 1);
        entityStore(state).units.add({ ...state.units[0], id: 3, faction: 1, x: 27.5, y: 12.5 });
        expect(validateBuildAt(state, 'woodenTower', 25, 12, 1).ok).toBe(true);
        expect(validateBuildAt(state, 'woodenTower', 21, 12, 1).message).toContain('borders');
        expect(buildingWithinBorders(state, 'woodenTower', 25, 12, 0)).toBe(false);
        state.factions[1].relation = 'confederated';
        expect(buildingWithinBorders(state, 'woodenTower', 25, 12, 0)).toBe(false);
        expect(buildingWithinBorders(state, 'woodenTower', 25, 12, 1)).toBe(true);
        for (const kind of ['wall', 'palisade'] as const) {
            expect(validateBuildAt(state, kind, 21, 12, 1).ok).toBe(true);
            expect(buildingWithinBorders(state, kind, 25, 12, 0)).toBe(true);
        }
        add(state, 'monument', 20, 20, -2);
        expect(buildingWithinBorders(state, 'wall', 20, 20, -2)).toBe(false);
    });

    it('leaves tree-clearing permissions independent of construction territory', () => {
        const state = fixture(); state.world.tiles[12 * 40 + 18].overlay = 'forest'; state.world.revision!++;
        expect(buildingWithinBorders(state, 'house', 18, 12)).toBe(false);
        expect(validateBuildAt(state, 'clearTrees', 18, 12).ok).toBe(true);
    });
});

describe('automatic construction territory rules', () => {
    it('keeps worn roads inside borders and farm builders never extend them outside', () => {
        const state = fixture(), unit = state.units[0]; add(state, 'road', 15, 11);
        unit.kind = 'militia';
        Object.assign(unit, { x: 16.5, y: 11.5 });
        for (let i = 0; i < ROAD_TRAFFIC_THRESHOLD; i++) recordTraffic(state, unit, { x: 15.5, y: 11.5 });
        expect(state.buildings.some(building => building.kind === 'road' && building.x === 16)).toBe(true);
        Object.assign(unit, { x: 17.5, y: 11.5 });
        expect(insideOwnBorders(state, 0, unit.x, unit.y)).toBe(false);
        for (let i = 0; i < ROAD_TRAFFIC_THRESHOLD; i++) expect(recordTraffic(state, unit, { x: 16.5, y: 11.5 })).toBe(false);
        expect(state.traffic?.[11 * 40 + 17]).toBeUndefined();
        expect(state.buildings.filter(building => building.kind === 'road').map(building => building.x)).toEqual([15, 16]);
        const camp = add(state, 'camp', 20, 20); camp.construction = { startedAt: 0, duration: 10, waitingForBuilder: true, builderId: unit.id };
        Object.assign(unit, { builder: true, buildSite: camp.id, buildPhase: 'outbound' });
        expect(recordTraffic(state, unit, { x: 16.5, y: 11.5 })).toBe(false);
        unit.x = 18.5;
        expect(recordTraffic(state, unit, { x: 17.5, y: 11.5 })).toBe(false);
        expect(state.buildings.filter(building => building.kind === 'road').map(building => building.x)).toEqual([15, 16]);
    });

    it('does not mature ordinary trails outside claims when the road frontier arrives', () => {
        const state = fixture(); add(state, 'road', 15, 11);
        state.traffic = Object.fromEntries([16, 17, 18].map(x => [11 * 40 + x, Array(ROAD_TRAFFIC_THRESHOLD).fill(0)]));
        expect(updateTraffic(state)).toBe(true);
        expect(state.buildings.filter(building => building.kind === 'road').map(building => building.x)).toEqual([15, 16]);
        expect(state.buildings.filter(building => building.kind === 'road').every(building => building.faction === 0)).toBe(true);
        add(state, 'palace', 28, 10, 1); add(state, 'road', 25, 14, -1);
        state.time = 1; state.traffic[14 * 40 + 24] = Array(ROAD_TRAFFIC_THRESHOLD).fill(1);
        expect(updateTraffic(state)).toBe(true);
        expect(state.buildings.find(building => building.kind === 'road' && building.x === 24 && building.y === 14)?.faction).toBe(1);
    });

    it('never leaves a prepared farm route to pave later when a road reaches it', () => {
        const state = fixture();
        const unit = state.units[0], camp = add(state, 'camp', 20, 20);
        camp.construction = { startedAt: 0, duration: 10, waitingForBuilder: true, builderId: unit.id };
        Object.assign(unit, { builder: true, buildSite: camp.id, buildPhase: 'outbound', x: 18.5, y: 11.5 });
        for (let i = 0; i < 24; i++) expect(recordTraffic(state, unit, { x: 19.5, y: 11.5 })).toBe(false);
        add(state, 'road', 17, 11);
        expect(updateTraffic(state)).toBe(false);
        expect(state.buildings.some(building => building.kind === 'road' && building.x === 18)).toBe(false);
        expect(state.traffic?.[11 * 40 + 18]).toBeUndefined();
    });

    it('ignores hostile and raider traffic inside another faction’s territory', () => {
        const state = fixture(), unit = state.units[0]; add(state, 'road', 15, 11);
        Object.assign(unit, { x: 16.5, y: 11.5, faction: -2 });
        for (let i = 0; i < ROAD_TRAFFIC_THRESHOLD; i++) expect(recordTraffic(state, unit, { x: 15.5, y: 11.5 })).toBe(false);
        expect(state.traffic).toBeUndefined();
        expect(state.buildings.filter(building => building.kind === 'road')).toHaveLength(1);
    });

    it('keeps automatic houses inside claims while allowing farms to use unclaimed land', () => {
        const empty = fixture(); empty.world.spawns = [{ x: 11, y: 12 }]; const state = createGame(empty.world);
        entityStore(state).units.replace(state.units.filter(unit => unit.faction === 0)); state.marauderPacks = []; state.raiderCamps = [];
        state.fogRaids = { nextAt: Infinity, waves: 0, pressureVersion: 1 };
        state.factions[0].gold = 10000;
        // Keep vacancy at 25% so this fixture tests placement, not expansion throttling.
        state.factions[0].population = 18;
        // Supply the city before testing housing location; the governor now
        // correctly chooses farms first when food is the bottleneck.
        for (const [x,y] of [[4,4],[6,4],[8,4],[10,4]]) add(state,'camp',x,y);
        synchronizeFarms(state);
        const initial = new Set(state.buildings.map(building => building.id)), initialClaims = territory(state);
        state.time = 29.9; updateGame(state, .1, { up: false, down: false, left: false, right: false });
        const houses = state.buildings.filter(building => !initial.has(building.id) && building.kind === 'house');
        expect(houses.length).toBeGreaterThan(0);
        expect(houses.every(building => buildingWithinBorders(state, building.kind, building.x, building.y, 0, initialClaims))).toBe(true);
        for (const house of houses) delete house.construction;
        state.factions[0].population = 100; state.buildings.find(building => building.kind === 'palace' && building.faction === 0)!.populationGrowth = -100; synchronizeFarms(state);
        const beforeFarm = new Set(state.buildings.map(building => building.id)), farmClaims = territory(state);
        // Fertile land beyond the frontier should remain an AI farm candidate.
        // Desert inside the claim makes the otherwise valid outside site win.
        for (let i = 0; i < state.world.tiles.length; i++) if (farmClaims.owners[i] === 0) state.world.tiles[i].terrain = 'desert';
        state.world.revision = (state.world.revision ?? 0) + 1;
        state.time = 59.9; updateGame(state, .1, { up: false, down: false, left: false, right: false });
        const farms = state.buildings.filter(building => !beforeFarm.has(building.id) && building.kind === 'camp');
        expect(farms.length).toBeGreaterThan(0);
        expect(farms.every(building => buildingWithinBorders(state, 'camp', building.x, building.y, 0, farmClaims))).toBe(true);
        expect(farms.some(building => !insideOwnBorders(state, 0, building.x + .5, building.y + .5, farmClaims))).toBe(true);
        expect(state.buildings.filter(building => initial.has(building.id)).length).toBe(initial.size);
    });
});
