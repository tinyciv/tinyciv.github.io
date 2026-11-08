import { recordNativeFrame } from './helpers/native-renderer';
import { entityStore } from '../src/game/entity-store';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { citySummaries, nextCityName } from '../src/game/cities';
import { CITY_FOOD_COLOR, CITY_GOLD_COLOR, CITY_RIBBON_HEIGHT, CITY_NAME_RIBBON_HEIGHT, drawCityRibbon } from '../src/game/city-ribbon';
import { drawCityPanelBackground, loadCityPanelArt } from '../src/game/city-panel-art';
import { createGame, diplomacyAction } from '../src/game/simulation';
import type { Building, Faction, GameState, Unit, World } from '../src/game/types';
import type { FogView } from '../src/game/fog';
import { withSimulationReads } from '../src/game/simulation-reads';
import { withCityPlanning, withCityPlanningMutation } from '../src/game/governor';

const building = (id: number, kind: Building['kind'], x: number, extra: Partial<Building> = {}): Building => ({
    id, kind, x, y: 10, faction: 0, hp: 100, maxHp: 100, capacity: 0, ...extra,
});
const warrior = (id: number, x: number, extra: Partial<Unit> = {}): Unit => ({
    id, kind: 'warrior', x, y: 12, faction: 0, hp: 100, morale: 100, attack: 20, defense: 4, speed: 3, range: 1,
    order: 'follow', cooldown: 0, lastCombat: 0, moving: false, facing: 0, attackTime: 0, ...extra,
});
const faction = (id = 0): Faction => ({ id, name: id ? 'Mosswood' : 'Willowhearth', color: '#397cc6', affinity: 100, relation: id ? 'peace' : 'self',
    food: 500, gold: 500, production: 0, population: 12, yields: { food: 4 * (.4 * 4 / 3) * (1 + .5) - 12, production: 0, gold: 12 * .7 - 1 - 37.5 }, nextRaid: 1000, defeated: false });
function world(): World { return { width: 70, height: 40, seed: 'city-ribbon-tests', source: 'test', spawns: [],
    tiles: Array.from({ length: 2800 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4, moisture: .6, food: 3, production: 1, gold: 0, variation: .3 })) }; }
function realm(): GameState {
    const w = world();
    const state: GameState = { world: w, units: [warrior(100, 12), warrior(101, 42)], factions: [faction()],
        buildings: [building(1, 'palace', 10, { cityName: 'Ravenna' }), building(2, 'palace', 40, { cityName: 'Carthage' }),
            building(3, 'house', 12, { capacity: 6, residents: 6 }), building(4, 'house', 42, { capacity: 8, residents: 6 }),
            building(5, 'camp', 16), building(6, 'camp', 46)],
        fields: [], time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
        buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: w.seed, rngState: 1 };
    for (const [camp, x] of [[5, 16], [6, 46]]) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        state.fields!.push({ id: state.fields!.length + 1, camp, faction: 0, x: x + dx, y: 10 + dy, planted: true, food: 0, nextHarvest: 30 });
        if (camp === 6) w.tiles[(10 + dy) * w.width + x + dx].terrain = 'desert';
    }
    return state;
}

describe('palace cities', () => {
    it('uses a varied, nonrepeating Roman city list without consuming simulation randomness', () => {
        const state = realm(); entityStore(state).buildings.replace([]);
        const rng = state.rngState, names: string[] = [];
        for (let i = 0; i < 30; i++) {
            const name = nextCityName(state, 0); names.push(name);
            entityStore(state).buildings.add(building(i + 1, 'palace', i, { cityName: name }));
        }
        expect(names.slice(0, 5)).toEqual(['Roma', 'Ostia', 'Antium', 'Capua', 'Neapolis']);
        expect(new Set(names).size).toBe(30);
        expect(state.rngState).toBe(rng);
    });
    it('assigns local housing, residents, harvests and upkeep once rather than duplicating realm totals', () => {
        const state = realm(), cities = citySummaries(state);
        expect(cities.map(({ name, population, housing, food, gold }) => ({ name, population, housing, food, gold }))).toEqual([
            // Four fields per city: grassland produces .4×4/3 meals per cycle;
            // desert produces half as much, before six residents eat.
            { name: 'Ravenna', population: 6, housing: 6, food: expect.closeTo(4 * (.4 * 4 / 3) - 6), gold: expect.closeTo(3.7) },
            { name: 'Carthage', population: 6, housing: 8, food: expect.closeTo(4 * (.2 * 4 / 3) - 6), gold: expect.closeTo(-33.8) },
        ]);
        expect(cities.reduce((sum, city) => sum + city.population, 0)).toBe(state.factions[0].population);
        expect(cities.reduce((sum, city) => sum + city.food, 0)).toBeCloseTo(state.factions[0].yields.food);
        expect(cities.reduce((sum, city) => sum + city.gold, 0)).toBeCloseTo(state.factions[0].yields.gold);
    });

    it('excludes unfinished housing and palaces, raiders, unplanted fields and dead soldiers', () => {
        const state = realm();
        entityStore(state).buildings.add(building(7, 'house', 12, { capacity: 100, residents: 100, construction: { startedAt: 0, duration: 20 } }),
            building(8, 'palace', 13, { construction: { startedAt: 0, duration: 20 } }), building(9, 'palace', 45, { faction: -2 }));
        entityStore(state).units.add(warrior(102, 10, { hp: 0 }));
        state.fields!.push({ id: 30, x: 12, y: 12, camp: 5, faction: 0, planted: false, food: 0, nextHarvest: 30 });
        const cities = citySummaries(state);
        expect(cities).toHaveLength(2);
        expect(cities[0]).toMatchObject({ population: 6, housing: 6, food: expect.closeTo(4 * (.4 * 4 / 3) - 6), gold: expect.closeTo(3.7) });
    });

    it('accounts for temporarily unhoused residents without losing food consumption or tax income', () => {
        const state = realm(); entityStore(state).buildings.replace(state.buildings.filter(building => building.id !== 3));
        const cities = citySummaries(state);
        expect(cities[0]).toMatchObject({ population: 6, housing: 0, food: expect.closeTo(4 * (.4 * 4 / 3) - 6), gold: expect.closeTo(3.7) });
        expect(cities.reduce((sum, city) => sum + city.population, 0)).toBe(12);
    });

    it('charges a soldier to its surviving home city even when the soldier travels away', () => {
        const state = realm(); state.units[0].home = 3; state.units[0].x = 45;
        expect(citySummaries(state).map(city => city.gold)).toEqual([expect.closeTo(3.7), expect.closeTo(-33.8)]);
        state.buildings.find(building => building.id === 3)!.hp = 0;
        expect(citySummaries(state).map(city => city.gold)).toEqual([expect.closeTo(4.2), expect.closeTo(-34.3)]);
    });

    it('assigns settlement, tower and funded post-tier charges once to each local city', () => {
        const state = realm();
        entityStore(state).buildings.add(building(20, 'woodenTower', 13), building(21, 'woodenTower', 43),
            building(22, 'guardPost', 14, { guardPost: { level: 1, funded: true, nextUpkeepAt: 30 } }),
            building(23, 'guardPost', 44, { guardPost: { level: 2, funded: true, nextUpkeepAt: 30 } }),
            building(24, 'guardPost', 15, { guardPost: { funded: false, nextUpkeepAt: 30 } }),
            building(25, 'woodenTower', 45, { construction: { startedAt: 0, duration: 15 } }),
            building(26, 'guardPost', 15, { villageId: 1, guardPost: { funded: true, nextUpkeepAt: 30 } }));
        const before = JSON.stringify(state), cities = citySummaries(state);
        expect(cities.map(city => city.gold)).toEqual([expect.closeTo(-21.3), expect.closeTo(-68.8)]);
        expect(cities.reduce((sum, city) => sum + city.gold, 0)).toBeCloseTo(12 * .7 - 1 - 37.5 - 10 - 20 - 30);
        expect(JSON.stringify(state)).toBe(before);
    });

    it('updates local economic buckets exactly while retaining unaffected cities during live orders', () => {
        const state = realm(); state.world.revision = 0;
        const fresh = () => citySummaries(structuredClone(state));
        withSimulationReads(state, () => withCityPlanning(state, () => {
            let previous = citySummaries(state);
            expect(previous).toEqual(fresh());
            const localEdit = (edit: () => void) => withCityPlanningMutation(state, () => {
                edit();
                const current = citySummaries(state);
                expect(current).toEqual(fresh());
                expect(current[0]).not.toBe(previous[0]);
                expect(current[1]).toBe(previous[1]);
                previous = current;
            });
            localEdit(() => { state.fields![0].planted = false; });
            localEdit(() => { state.units[0].kind = 'knight'; });
            localEdit(() => { state.buildings[2].capacity++; });
            localEdit(() => entityStore(state).buildings.add(building(30, 'guardPost', 13,
                { guardPost: { funded: true, nextUpkeepAt: 30 } })));
            localEdit(() => { state.buildings.find(building => building.id === 30)!.guardPost!.funded = false; });
            localEdit(() => { state.fields![1].orchard = { startedAt: 0, readyAt: 5 }; });
            localEdit(() => { state.time = 5; });
            withCityPlanningMutation(state, () => {
                entityStore(state).buildings.add(building(31, 'library', 55,
                    { construction: { startedAt: state.time, duration: 30, waitingForBuilder: true } }));
                const current = citySummaries(state);
                expect(current).toEqual(fresh());
                expect(current[0]).toBe(previous[0]);
                expect(current[1]).toBe(previous[1]);
                state.factions[0].villageBonuses = { food: .2, trade: 0, construction: 0, research: 0 };
                expect(citySummaries(state)).toEqual(fresh());
            });
        }));
    });

    it('names new cities without changing RNG and persists distinct palace identities through confederation', () => {
        const w = world(); w.spawns = [{ x: 10, y: 20 }, { x: 50, y: 20 }];
        const state = createGame(w), palaces = state.buildings.filter(building => building.kind === 'palace');
        const original = palaces.map(palace => palace.cityName), rng = state.rngState;
        expect(original).toEqual(['Roma', 'Thebes']);
        expect(state.factions[0]).toMatchObject({ name: 'Roma', color: '#f34f59' });
        const civilizations = state.factions.filter(faction => faction.villageId === undefined);
        expect(new Set(civilizations.map(faction => faction.color)).size).toBe(civilizations.length);
        expect(nextCityName(state, 0)).toBe('Ostia'); expect(state.rngState).toBe(rng);
        const leader = state.units.find(unit => unit.kind === 'leader' && unit.faction === 0)!;
        leader.x = palaces[1].x - .5; leader.y = palaces[1].y + .5;
        state.factions[1].affinity = 200; state.factions[1].relation = 'peace';
        expect(diplomacyAction(state, 1, 'confederate').ok).toBe(true);
        expect(palaces.map(palace => palace.faction)).toEqual([0, 0]);
        expect(palaces.map(palace => palace.cityName)).toEqual(original);
        const cities = citySummaries(state);
        expect(cities.map(city => city.name)).toEqual(original);
        expect(cities.reduce((sum, city) => sum + city.food, 0)).toBeCloseTo(state.factions[0].yields.food);
        expect(cities.reduce((sum, city) => sum + city.gold, 0)).toBeCloseTo(state.factions[0].yields.gold);
    });
});

class TextCanvas {
    fillStyle = ''; font = ''; labels: { text: string; x: number; y: number; color: string; font: string }[] = [];
    images: { x: number; y: number; width: number; height: number; source: number[] }[] = [];
    fillRect() {}
    save() {} restore() {} beginPath() {} fill() {} stroke() {} moveTo() {} lineTo() {}
    drawImage(_image: unknown, sx: number, sy: number, sw: number, sh: number, x: number, y: number, width: number, height: number) {
        this.images.push({ x, y, width, height, source: [sx, sy, sw, sh] });
    }
    measureText(text: string) { return { width: text.length * 7 }; }
    fillText(text: string, x: number, y: number) { this.labels.push({ text, x, y, color: this.fillStyle, font: this.font }); }
}
function imageBounds(images: { x: number; y: number; width: number; height: number }[]) {
    const x = Math.min(...images.map(image => image.x)), y = Math.min(...images.map(image => image.y));
    return { x, y, width: Math.max(...images.map(image => image.x + image.width)) - x,
        height: Math.max(...images.map(image => image.y + image.height)) - y };
}
function visibleFog(state: GameState): FogView {
    return { width: state.world.width, height: state.world.height, visible: new Uint8Array(2800).fill(1), explored: Array(2800).fill(1),
        sources: [], buildings: [...state.buildings], fields: [], revision: 1, explorationRevision: 1 };
}

function drawCities(state: GameState, fog: FogView, size = 32, ox = 0, oy = 0) {
    const frame = recordNativeFrame(state, { fog, size, ox, oy });
    const images = frame.images.filter(image => image.key.startsWith('city:'));
    return { labels: frame.texts.filter(text => text.key.startsWith('city:')),
        boxes: [...new Set(images.map(image => image.key))].map(key => imageBounds(images.filter(image => image.key === key))) };
}

describe('city ribbon presentation', () => {
    beforeAll(async () => {
        vi.stubGlobal('Image', class { naturalWidth = 103; naturalHeight = 20; src = ''; async decode() {} });
        try { await loadCityPanelArt(); } finally { vi.unstubAllGlobals(); }
    });
    it.each(['war', 'peace'] as const)('shows another faction city name without population, housing or income during %s', relation => {
        const state = realm(), other = faction(1); other.relation = relation; state.factions.push(other);
        const palace = state.buildings[1]; palace.faction = 1;
        state.buildings.find(building => building.id === 4)!.faction = 1;
        const context = drawCities(state, visibleFog(state), 32, 7, 11);
        expect(context.labels.map(label => label.text)).toEqual(['Ravenna', '12 / 6', '-9', '+7', '75', 'Carthage']);
        const enemyBox = context.boxes[1];
        expect(enemyBox.height).toBe(CITY_NAME_RIBBON_HEIGHT);
        expect(enemyBox.y + enemyBox.height).toBe(11 + palace.y * 32 - 6);

        // A captured city immediately gains the player's normal two-line display.
        palace.faction = 0;
        const captured = drawCities(state, visibleFog(state));
        expect(captured.labels).toHaveLength(10);
        expect(captured.boxes[1].height).toBe(CITY_RIBBON_HEIGHT);
    });

    it('shows local counts and signed green/gold rates above the palace at fixed screen size', () => {
        const state = realm(), fog = visibleFog(state);
        for (const size of [24, 64]) {
            const context = drawCities(state, fog, size);
            expect(context.labels.slice(0, 4).map(label => label.text)).toEqual(['Ravenna', '6 / 6', '-4', '+4']);
            expect(context.labels[2].color).toBe(CITY_FOOD_COLOR); expect(context.labels[3].color).toBe(CITY_GOLD_COLOR);
            const top = 10 * size - 6 - CITY_RIBBON_HEIGHT;
            expect(context.labels[0].y).toBe(top + 17);
            expect(context.labels.slice(1, 4).map(label => label.y)).toEqual(Array(3).fill(top + 40));
            expect(context.boxes[0].height).toBe(CITY_RIBBON_HEIGHT);
        }
    });

    it('does not reveal current city stats through explored fog', () => {
        const state = realm(), fog = visibleFog(state);
        fog.visible.fill(0);
        // Even when remembered buildings and explored land remain, no live stats appear.
        expect(drawCities(state, fog).labels).toHaveLength(0);
        fog.visible[10 * fog.width + 10] = 1;
        expect(drawCities(state, fog).labels.map(label => label.text)).toEqual(['Ravenna', '6 / 6', '-4', '+4', '75']);
    });

    it('truncates a long city name while preserving population and signed income columns', () => {
        const context = new TextCanvas(), city = citySummaries(realm())[0];
        city.name = 'New Constantinople on the Southern Frontier'; city.food = -12; city.gold = 19;
        drawCityRibbon(context as unknown as CanvasRenderingContext2D, city, 200, 100, 290);
        expect(context.labels[0].text).toMatch(/…$/);
        expect(context.labels.slice(1).map(label => label.text)).toEqual(['6 / 6', '-12', '+19', '75']);
        expect(imageBounds(context.images).width).toBeLessThanOrEqual(290);
    });

    it('fits dense signed statistics inside the frame using Pixel Operator for every label', () => {
        const context = new TextCanvas(), city = citySummaries(realm())[0];
        city.population = 1234; city.housing = 1600; city.food = -1234; city.gold = 5678;
        drawCityRibbon(context as unknown as CanvasRenderingContext2D, city, 200, 100);
        const bounds = imageBounds(context.images);
        expect(bounds.width % 2).toBe(0);
        expect(context.labels.every(label => label.font.includes('"Pixel Operator"'))).toBe(true);
        expect(context.labels.map(label => label.font.match(/\d+px/)?.[0])).toEqual(['18px', ...Array(4).fill('20px')]);
        expect(context.labels.slice(1).map(label => label.text)).toEqual(['1234 / 1600', '-1234', '+5678', '75']);
        for (const label of context.labels) {
            expect(label.x).toBeGreaterThanOrEqual(bounds.x + 12);
            expect(label.x + context.measureText(label.text).width).toBeLessThanOrEqual(bounds.x + bounds.width - 12);
        }
    });

    it.each([CITY_NAME_RIBBON_HEIGHT, CITY_RIBBON_HEIGHT])('preserves corners and whole 2× source pixels at %spx height', height => {
        for (const width of [38, 120, 300]) {
            const context = new TextCanvas();
            drawCityPanelBackground(context as unknown as CanvasRenderingContext2D, 0, 0, width, height);
            expect(imageBounds(context.images)).toEqual({ x: 0, y: 0, width, height });
            expect(context.images.reduce((area, image) => area + image.width * image.height, 0)).toBe(width * height);
            for (const image of context.images) {
                expect(image.source.every(Number.isInteger)).toBe(true);
                expect(image.width).toBe(image.source[2] * 2); expect(image.height).toBe(image.source[3] * 2);
            }
            expect(context.images.slice(-4).map(image => image.source)).toEqual([[0, 0, 6, 5], [97, 0, 6, 5], [0, 15, 6, 5], [97, 15, 6, 5]]);
        }
    });
});
