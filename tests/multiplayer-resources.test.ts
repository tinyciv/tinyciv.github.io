import { describe, expect, it } from 'vitest';
import { createDuelGame } from '../src/game/simulation';
import { applyGameCommand } from '../src/multiplayer/commands';
import { territory } from '../src/game/borders';
import { isVisible } from '../src/game/fog';
import { withPlayerFaction } from '../src/game/player-context';
import { markWorldChanged } from '../src/game/world-revisions';
import { buildingHeight, buildingWidth, type World } from '../src/game/types';

function fixture(actor = 0) {
    const world: World = { width: 64, height: 36, seed: 'resource-commands', source: 'test',
        spawns: [{ x: 8, y: 18 }, { x: 54, y: 18 }],
        tiles: Array.from({ length: 64 * 36 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .4,
            moisture: .5, food: 3, production: 0, gold: 0, variation: .5 })) };
    const state = createDuelGame(world), borders = territory(state);
    const cell = world.tiles.findIndex((_, i) => {
        const x = i % world.width, y = Math.floor(i / world.width);
        return borders.owners[i] === actor && withPlayerFaction(state, actor, () => isVisible(state, x + .5, y + .5))
            && !state.buildings.some(b => x >= b.x && y >= b.y && x < b.x + buildingWidth(b) && y < b.y + buildingHeight(b));
    });
    expect(cell).toBeGreaterThanOrEqual(0);
    state.world.tiles[cell].resource = 'copper'; markWorldChanged(state.world, 'appearance');
    return { state, cell, point: { x: cell % world.width, y: Math.floor(cell / world.width) } };
}

describe('authoritative resource development', () => {
    it.each([0, 1])('charges authenticated faction %s exactly once and ignores forged prices/owners', actor => {
        const { state, cell, point } = fixture(actor), gold = state.factions.map(f => f.gold);
        const result = applyGameCommand(state, actor, { type: 'develop-resource', ...point, faction: 1 - actor, cost: 0 });
        expect(result.ok, result.message).toBe(true);
        expect(state.world.tiles[cell].resourceDeveloped).toBe(true);
        expect(state.factions[actor].gold).toBe(gold[actor] - 50);
        expect(state.factions[1 - actor].gold).toBe(gold[1 - actor]);
        expect(applyGameCommand(state, actor, { type: 'develop-resource', ...point }).ok).toBe(false);
        expect(state.factions[actor].gold).toBe(gold[actor] - 50);
    });
    it('rejects enemy deposits, fractional coordinates, insufficient gold and ended matches', () => {
        const { state, cell, point } = fixture();
        expect(applyGameCommand(state, 1, { type: 'develop-resource', ...point }).ok).toBe(false);
        expect(applyGameCommand(state, 0, { type: 'develop-resource', x: point.x + .5, y: point.y }).ok).toBe(false);
        state.factions[0].gold = 49;
        expect(applyGameCommand(state, 0, { type: 'develop-resource', ...point }).ok).toBe(false);
        state.factions[0].gold = 500; state.gameOver = true;
        expect(applyGameCommand(state, 0, { type: 'develop-resource', ...point }).ok).toBe(false);
        expect(state.world.tiles[cell].resourceDeveloped).toBeUndefined();
    });
});
