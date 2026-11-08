import { describe, expect, it } from 'vitest';
import { developResourceGroup } from '../src/game/resource-development';
import { onResourceDeveloped, RESOURCE_WORK_SECONDS, updateResourceWorker, updateResourceWorkforce } from '../src/game/resource-workers';
import { entityStore } from '../src/game/entity-store';
import { canDispatchPeasant } from '../src/game/peasant-capacity';
import { personFrame } from '../src/game/unit-sprites';
import { levyPopulation, dismissLevy } from '../src/game/mass-levy';
import { markWorldChanged } from '../src/game/world-revisions';
import { moveUnit, updateGame } from '../src/game/simulation';
import { resourceBlocksGround } from '../src/game/resource-terrain';
import { distance, tileAt, type GameState, type Point, type ResourceWorkKind, type Unit } from '../src/game/types';

function fixture(resource: ResourceWorkKind = 'copper', population = 20): GameState {
    const state: GameState = { world: { width: 40, height: 24, seed: 'resource-workers', source: 'test', spawns: [], revision: 0,
        tiles: Array.from({ length: 960 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 3, production: 1, gold: 0, variation: .5 })) },
        units: [], buildings: [{ id: 1, kind: 'palace', faction: 0, x: 6, y: 8, hp: 1000, maxHp: 1000, capacity: 30,
            unhousedResidents: population, initialCity: true, governorPermissions: { farms: false, housing: false } }],
        factions: [{ id: 0, name: 'Rome', color: '#d54b4b', relation: 'self', affinity: 100, population, gold: 5000, food: 1000,
            production: 0, yields: { food: 0, gold: 0, production: 0 }, defeated: false, nextRaid: Infinity, nextRetinueAt: Infinity }],
        time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null, buildMode: null,
        diplomacy: null, gameOver: false, victory: false, seed: 'resource-workers', rngState: 1, fields: [],
        marauderPacks: [], raiderCamps: [], fogRaids: { nextAt: Infinity, waves: 0, pressureVersion: 2 },
        wildlife: { herds: [], sequence: 0, nextRespawnAt: Infinity, targetHerds: 0 } };
    for (const [x, y] of [[11, 8], [12, 8], [11, 9], [12, 9]]) Object.assign(state.world.tiles[y * 40 + x], { resource, resourceGroup: 1 });
    return state;
}
const walk = (_state: GameState, unit: Unit, point: Point, dt: number) => {
    const d = distance(unit, point), step = Math.min(d, unit.speed * dt);
    unit.moving = step > .001;
    if (!d) return;
    unit.facing = Math.atan2(point.y - unit.y, point.x - unit.x);
    unit.x += (point.x - unit.x) / d * step; unit.y += (point.y - unit.y) / d * step; unit.stuckFor = 0;
};
function tick(state: GameState, dt = .1, dispatch = true): void {
    state.time += dt;
    if (dispatch) updateResourceWorkforce(state);
    for (const unit of [...state.units]) if (unit.resourceWork) updateResourceWorker(state, unit, dt, walk);
}
function develop(state: GameState): void { expect(developResourceGroup(state, 11, 8).ok).toBe(true); }
function visitor(state: GameState): Unit {
    // Finish the initial road-building assignment before the scheduled visit.
    for (let n = 0; n < 100 && !state.resourceWorkSites![0].roadComplete; n++) tick(state);
    state.time = 10; updateResourceWorkforce(state);
    return state.units.find(unit => unit.resourceWork?.phase === 'outbound')!;
}

describe('resource resident jobs', () => {
    it('immediately dispatches a road worker, charges only development, and builds along the physical trip', () => {
        const state = fixture(); develop(state);
        expect(state.factions[0].gold).toBe(4800);
        const worker = state.units.find(unit => unit.resourceWork)!;
        expect(worker).toMatchObject({ kind: 'worker', home: 1, inside: false, resourceWork: { phase: 'road' } });
        expect(worker.builder).toBeUndefined(); expect(worker.collector).toBeUndefined();
        expect(state.buildings.filter(b => b.kind === 'road')).toHaveLength(0);
        tick(state, .3); expect(state.buildings.filter(b => b.kind === 'road')).toHaveLength(0);
        tick(state, .3); expect(state.buildings.filter(b => b.kind === 'road')).toHaveLength(1);
        for (let i = 0; i < 100 && state.units.includes(worker); i++) tick(state);
        expect(state.resourceWorkSites![0].roadComplete).toBe(true);
        expect(state.units).not.toContain(worker);
        expect(state.factions[0].population).toBe(20); expect(state.factions[0].gold).toBe(4800);
    });

    it('dispatches every ten game seconds, hides the miner for exactly five seconds, then walks back', () => {
        const state = fixture(); develop(state);
        state.time = 9.99; updateResourceWorkforce(state);
        expect(state.units.filter(unit => unit.resourceWork?.phase === 'outbound')).toHaveLength(0);
        state.time = 10; updateResourceWorkforce(state);
        const worker = state.units.find(unit => unit.resourceWork?.phase === 'outbound')!;
        expect(worker).toBeDefined();
        updateResourceWorkforce(state);
        expect(state.units.filter(unit => unit.resourceWork?.phase === 'outbound')).toHaveLength(1);
        for (let n = 0; n < 100 && worker.resourceWork?.phase !== 'working'; n++) tick(state, .1, false);
        expect(worker.resourceWork?.phase).toBe('working'); expect(worker.inside).toBe(true);
        expect(entityStore(state).units.query('active')).toContain(worker);
        for (let n = 0; n < 49; n++) { state.time += .1; updateResourceWorker(state, worker, .1, walk); }
        expect(worker.resourceWork?.worked).toBeCloseTo(RESOURCE_WORK_SECONDS - .1);
        expect(worker.inside).toBe(true);
        state.time += .1; updateResourceWorker(state, worker, .1, walk);
        expect(worker.resourceWork?.phase).toBe('returning'); expect(worker.inside).toBe(false);
        const before = { x: worker.x, y: worker.y };
        state.time += .1; updateResourceWorker(state, worker, .1, walk);
        expect(distance(before, worker)).toBeGreaterThan(0); expect(state.units).toContain(worker);
        for (let n = 0; n < 100 && state.units.includes(worker); n++) { state.time += .1; updateResourceWorker(state, worker, .1, walk); }
        expect(state.units).not.toContain(worker);
    });

    it('keeps a ten-second schedule under coarse updates and skips missed visits without a burst', () => {
        const state = fixture(); develop(state); state.resourceWorkSites![0].roadComplete = true;
        state.time = 10.25; updateResourceWorkforce(state);
        expect(state.resourceWorkSites![0].nextVisitAt).toBe(20);
        state.time = 20.5; updateResourceWorkforce(state);
        expect(state.resourceWorkSites![0].nextVisitAt).toBe(30);
        const before = state.units.length;
        state.time = 105; updateResourceWorkforce(state);
        expect(state.resourceWorkSites![0].nextVisitAt).toBe(110);
        expect(state.units.length).toBe(before + 1);
    });

    it.each(['olives', 'salt'] as const)('walks around inside %s and alternates walking with tool animation', resource => {
        const state = fixture(resource); develop(state); const worker = visitor(state);
        expect(worker).toBeDefined();
        for (let n = 0; n < 100 && worker.resourceWork?.phase !== 'working'; n++) tick(state, .1, false);
        const positions = new Set<string>(), orders = new Set<string>();
        for (let n = 0; n < 48; n++) {
            state.time += .1; updateResourceWorker(state, worker, .1, walk);
            expect(worker.inside).toBe(false);
            expect(state.resourceWorkSites![0].cells).toContain(Math.floor(worker.y) * 40 + Math.floor(worker.x));
            positions.add(`${worker.x.toFixed(1)},${worker.y.toFixed(1)}`); orders.add(worker.order);
        }
        expect(positions.size).toBeGreaterThan(4); expect(orders).toEqual(new Set(['work', 'hold']));
    });

    it('keeps the quarry worker visible and animating against the original rock', () => {
        const state = fixture('stone'); develop(state); const worker = visitor(state);
        for (let n = 0; n < 100 && worker.resourceWork?.phase !== 'working'; n++) tick(state, .1, false);
        expect(worker.resourceWork?.phase).toBe('working'); expect(worker.inside).toBe(false);
        const position = { x: worker.x, y: worker.y }, frames = new Set<number>();
        for (let i = 0; i < 10; i++) {
            state.time += .2; updateResourceWorker(state, worker, .2, walk);
            expect(worker.order).toBe('work'); expect(worker.moving).toBe(false);
            frames.add(personFrame(worker, state.time).frame);
        }
        expect(worker.x).toBe(position.x); expect(worker.y).toBe(position.y); expect(frames.size).toBeGreaterThan(1);
    });

    it('counts hidden miners as busy residents and never borrows levied civilians', () => {
        const state = fixture('copper', 2); develop(state);
        const first = state.units[0]; first.resourceWork!.phase = 'working'; first.inside = true;
        const levy: Unit = { ...first, id: 99, kind: 'levyInfantry', inside: false, resourceWork: undefined,
            levy: { city: 1, previousKind: 'warrior', activatedAt: 0 } } as unknown as Unit;
        entityStore(state).units.add(levy);
        state.resourceWorkSites![0].roadComplete = true; state.time = 10;
        updateResourceWorkforce(state);
        expect(state.units.filter(unit => unit.resourceWork)).toHaveLength(1);
        const second: Unit = { ...first, id: 100, resourceWork: undefined, inside: true };
        const other: Unit = { ...first, id: 101, resourceWork: { ...first.resourceWork! } };
        entityStore(state).units.add(other);
        expect(canDispatchPeasant(state, second)).toBe(false);
    });

    it('does not accumulate visits while paused, and abandons a lost resource before going home', () => {
        const state = fixture('iron'); develop(state); const worker = visitor(state);
        for (let n = 0; n < 100 && worker.resourceWork?.phase !== 'working'; n++) tick(state, .1, false);
        state.paused = true; state.time = 100;
        const count = state.units.length, worked = worker.resourceWork!.worked;
        updateResourceWorkforce(state); updateResourceWorker(state, worker, 1, walk);
        expect(state.units.length).toBe(count); expect(worker.resourceWork!.worked).toBe(worked);
        state.paused = false;
        for (const tile of state.world.tiles) if (tile.resource) tile.resourceDeveloped = false;
        markWorldChanged(state.world, 'appearance'); updateResourceWorkforce(state);
        updateResourceWorker(state, worker, .1, walk);
        expect(worker.inside).toBe(false); expect(worker.resourceWork?.phase).toBe('returning');
        expect(state.resourceWorkSites).toHaveLength(0);
    });

    it('backs off blocked travel and leaves a visible civilian when every settlement is lost', () => {
        const state = fixture(); develop(state); const worker = visitor(state);
        worker.stuckFor = 5;
        updateResourceWorker(state, worker, .1, () => { worker.moving = false; });
        expect(worker.resourceWork?.phase).toBe('returning');
        expect(state.resourceWorkSites![0].retryAt).toBeGreaterThan(state.time);
        entityStore(state).buildings.retain(b => b.kind !== 'palace'); updateResourceWorkforce(state);
        updateResourceWorker(state, worker, .1, walk);
        expect(worker.resourceWork).toBeUndefined(); expect(worker.inside).toBe(false); expect(worker.hp).toBe(50);
    });

    it('replaces a fallen road worker without inventing a resident or counting the casualty twice', () => {
        const state = fixture(); develop(state); const first = state.units[0];
        first.hp = 0; updateResourceWorkforce(state);
        expect(state.factions[0].population).toBe(19);
        expect(state.units.filter(unit => unit.hp > 0 && unit.resourceWork?.phase === 'road')).toHaveLength(1);
        updateResourceWorkforce(state); expect(state.factions[0].population).toBe(19);
    });

    it('musters a hidden miner at the mine, then returns that civilian home after dismissal', () => {
        const state = fixture(); develop(state); const worker = state.units[0];
        entityStore(state).units.add({ ...worker, id: 900, kind: 'leader', hp: 100, maxHp: 100,
            x: 5.5, y: 8.5, resourceWork: undefined, inside: false, order: 'hold' });
        state.factions[0].research = { focus: 'massLevy', levels: { massLevy: 1 }, progress: {} };
        worker.resourceWork!.phase = 'working'; worker.inside = true; Object.assign(worker, worker.resourceWork!.approach);
        const entrance = { x: worker.x, y: worker.y };
        state.resourceWorkSites![0].roadComplete = true;
        expect(levyPopulation(state, 1).ok).toBe(true);
        expect(worker.kind).toBe('levyInfantry'); expect(worker.x).toBe(entrance.x); expect(worker.y).toBe(entrance.y);
        expect(worker.inside).toBe(false); expect(worker.resourceWork?.phase).toBe('returning');
        state.time = 31; expect(dismissLevy(state).ok).toBe(true);
        expect(worker.kind).toBe('worker');
        for (let n = 0; n < 100 && state.units.includes(worker); n++) { state.time += .1; updateResourceWorker(state, worker, .1, walk); }
        expect(state.units).not.toContain(worker); expect(state.factions[0].population).toBe(20);
    });

    it('continues hidden mining through the real game update scheduler', () => {
        const state = fixture(); develop(state);
        const worker = state.units[0], job = worker.resourceWork!;
        entityStore(state).units.add({ ...worker, id: 900, kind: 'leader', hp: 100, maxHp: 100,
            x: 5.5, y: 8.5, resourceWork: undefined, inside: false, order: 'hold' });
        state.resourceWorkSites![0].roadComplete = true;
        job.phase = 'working'; job.worked = 0; worker.inside = true; Object.assign(worker, job.approach);
        for (let i = 0; i < 51; i++) updateGame(state, .1, { up: false, down: false, left: false, right: false });
        expect(worker.resourceWork?.phase).toBe('returning'); expect(worker.inside).toBe(false);
    });

    it.each(['stone', 'copper', 'iron'] as const)('reaches and works %s from its perimeter with real navigation', resource => {
        const state = fixture(resource); develop(state); const worker = visitor(state);
        const phases = new Set<string>();
        for (let step = 0; step < 400 && state.units.includes(worker); step++) {
            state.time += .1;
            updateResourceWorker(state, worker, .1, moveUnit);
            expect(resourceBlocksGround(tileAt(state.world, worker.x, worker.y))).toBe(false);
            if (worker.resourceWork) phases.add(worker.resourceWork.phase);
        }
        expect(phases.has('working')).toBe(true); expect(phases.has('returning')).toBe(true);
        expect(state.units).not.toContain(worker);
    });

    it('completes a real road, mine entry, timed shift and physical return using game navigation', () => {
        const state = fixture(); develop(state);
        entityStore(state).units.add({ ...state.units[0], id: 900, kind: 'leader', hp: 100, maxHp: 100,
            x: 5.5, y: 8.5, resourceWork: undefined, inside: false, order: 'hold' });
        let visiting: Unit | undefined, working = false, returning = false;
        for (let i = 0; i < 260; i++) {
            updateGame(state, .1, { up: false, down: false, left: false, right: false });
            visiting ??= state.units.find(unit => unit.resourceWork?.phase === 'outbound');
            if (visiting?.resourceWork?.phase === 'working') { working = true; expect(visiting.inside).toBe(true); }
            if (visiting?.resourceWork?.phase === 'returning' && state.units.includes(visiting)) { returning = true; expect(visiting.inside).toBe(false); }
        }
        expect(state.resourceWorkSites![0].roadComplete).toBe(true);
        expect(working).toBe(true); expect(returning).toBe(true);
        expect(state.units).not.toContain(visiting);
    });
});
