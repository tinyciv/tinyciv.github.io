import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { drawResearchBars, RESEARCH_BAR_GAP, RESEARCH_BAR_HEIGHT, RESEARCH_BAR_WIDTH } from '../src/game/research-bar';
import { RESEARCH_BRANCHES, researchStatus, updateResearch } from '../src/game/research';
import { grantIncome } from '../src/game/resource-income';
import { CITY_GOLD_COLOR } from '../src/game/city-ribbon';
import type { Building, GameState } from '../src/game/types';
import type { FogView } from '../src/game/fog';

const library = (id: number, faction = 0): Building => ({ id, kind: 'library', x: 10 + id * 3, y: 10, faction,
    hp: 250, maxHp: 250, capacity: 0 });
function fixture(): GameState {
    return { world: { width: 32, height: 24, seed: 'research-bar', source: 'test', spawns: [], tiles: [] },
        buildings: [library(1)], units: [], fields: [],
        factions: [0, 1].map(id => ({ id, name: `Faction ${id}`, color: '#d54b42', affinity: 100, relation: id ? 'war' : 'self',
            food: 500, gold: 2000, production: 0, population: 20, yields: { food: 0, production: 0, gold: 0 }, nextRaid: Infinity, defeated: false })),
        time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
        buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: 'research-bar', rngState: 1 };
}
function visibleFog(state: GameState): FogView {
    return { width: 32, height: 24, visible: new Uint8Array(768).fill(1), explored: Array(768).fill(1),
        sources: [], buildings: [...state.buildings], fields: [], revision: 1, explorationRevision: 1 };
}
class BarCanvas {
    fillStyle = ''; boxes: { x: number; y: number; width: number; height: number }[] = [];
    fills: { x: number; y: number; width: number; height: number; color: string }[] = [];
    save() {} restore() {} beginPath() {} fill() {} stroke() {}
    roundRect(x: number, y: number, width: number, height: number) { this.boxes.push({ x, y, width, height }); }
    fillRect(x: number, y: number, width: number, height: number) { this.fills.push({ x, y, width, height, color: this.fillStyle }); }
}
function render(state: GameState, fog = visibleFog(state), size = 32, ox = 0, oy = 0): BarCanvas {
    const c = new BarCanvas();
    drawResearchBars(c as unknown as CanvasRenderingContext2D, state, fog, ox, oy, size, 1600, 1000);
    return c;
}

describe('library research progress indicator', () => {
    it('shows the automatic project, advances only with income, and hides when the tree is complete', () => {
        const state = fixture();
        expect(render(state).boxes).toHaveLength(1);
        expect(render(state).fills).toHaveLength(0);
        const cost = researchStatus(state, 0).required;
        grantIncome(state.factions[0], { gold: cost * 2 }, state);
        expect(render(state).fills).toHaveLength(0); updateResearch(state,30);
        const half = render(state);
        expect(half.fills[0]).toMatchObject({ width: (RESEARCH_BAR_WIDTH - 2) / 2, color: CITY_GOLD_COLOR });
        state.paused = true; updateResearch(state, 60);
        expect(render(state)).toEqual(half);
        state.paused = false; updateResearch(state, 60);
        expect(render(state)).toEqual(half);
        state.factions[0].research!.levels = Object.fromEntries(RESEARCH_BRANCHES.map(branch => [branch.id, 1]));
        expect(render(state).boxes).toHaveLength(0);
    });

    it('uses the resolved priority, retaining points when an earlier project is resumed', () => {
        const state = fixture(); grantIncome(state.factions[0], { gold: researchStatus(state, 0).required }, state);
        updateResearch(state,30); const quarter = render(state);
        state.factions[0].research!.priorities = ['irrigation'];
        expect(render(state).boxes).toHaveLength(1);
        expect(render(state).fills).toHaveLength(0);
        state.factions[0].research!.priorities = [];
        expect(render(state)).toEqual(quarter);
    });

    it('does not expose enemy research, remembered libraries, construction sites or destroyed libraries', () => {
        const state = fixture(), fog = visibleFog(state);
        entityStore(state).buildings.add(library(2, 1), { ...library(3), construction: { startedAt: 0, duration: 90 } }, { ...library(4), hp: 0 });
        for (const faction of state.factions) grantIncome(faction, { gold: 20 }, state);
        expect(render(state, fog).boxes).toHaveLength(1);
        fog.visible.fill(0);
        expect(render(state, fog).boxes).toHaveLength(0);
        fog.visible[10 * fog.width + state.buildings[1].x] = 1;
        expect(render(state, fog).boxes).toHaveLength(0);
        fog.visible.fill(1); state.buildings[0].faction = 1;
        expect(render(state, fog).boxes).toHaveLength(0);
    });

    it('attaches to the roof center at every zoom while keeping a small screen-sized bar', () => {
        const state = fixture(); grantIncome(state.factions[0], { gold: 20 }, state);
        for (const size of [16, 32, 64]) {
            const c = render(state, visibleFog(state), size, 17, 23), b = state.buildings[0];
            expect(c.boxes).toEqual([{ x: 17 + (b.x + 1) * size - RESEARCH_BAR_WIDTH / 2 + .5,
                y: 23 + b.y * size - RESEARCH_BAR_GAP - RESEARCH_BAR_HEIGHT + .5,
                width: RESEARCH_BAR_WIDTH - 1, height: RESEARCH_BAR_HEIGHT - 1 }]);
        }
        expect(render(state, visibleFog(state), 32, -2000).boxes).toHaveLength(0);
    });

    it('shares one income-funded project across player libraries and hides it after defeat', () => {
        const state = fixture(); entityStore(state).buildings.add(library(2));
        grantIncome(state.factions[0], { gold: researchStatus(state, 0).required }, state);
        updateResearch(state,30); const c = render(state);
        expect(c.boxes).toHaveLength(2);
        expect(c.fills.map(fill => fill.width)).toEqual(Array(2).fill((RESEARCH_BAR_WIDTH - 2) / 4));
        state.factions[0].defeated = true; expect(render(state).boxes).toHaveLength(0);
        state.factions[0].defeated = false; state.gameOver = true; expect(render(state).boxes).toHaveLength(0);
    });
});
