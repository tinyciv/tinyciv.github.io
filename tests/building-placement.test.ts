import { entityStore } from '../src/game/entity-store';
import { unlockBuildingResearch } from './helpers/research';
import { describe, expect, it } from 'vitest';
import { buildAt, createGame, getLeader, migrateGame } from '../src/game/simulation';
import { updateFog } from '../src/game/fog';
import { buildingSize, tileAt, type Building, type Overlay, type World } from '../src/game/types';
import { terrainYields } from '../src/world/generator';

function world(overlay: Overlay = 'none'): World {
  return { width: 40, height: 30, seed: 'building-clearings', source: 'placement fixture', spawns: [{ x: 7, y: 7 }],
    tiles: Array.from({ length: 1200 }, () => ({ terrain: 'grassland', overlay, elevation: .4, moisture: .7,
      ...terrainYields('grassland', overlay), variation: .5 })) };
}

describe('visible building clearings', () => {
  it.each<Overlay>(['forest', 'jungle', 'swamp'])('clears %s from starting buildings and keeps camp fields distinct', overlay => {
    const state = createGame(world(overlay));
    for (const building of state.buildings) {
      for (let dy = 0; dy < buildingSize(building); dy++) for (let dx = 0; dx < buildingSize(building); dx++)
        expect(tileAt(state.world, building.x + dx, building.y + dy)?.overlay).toBe('none');
    }
    const camps = state.buildings.filter(building => building.kind === 'camp');
    expect(camps.length).toBeGreaterThan(2);
    expect(camps.every(camp => state.fields!.filter(field => field.camp === camp.id).length === 1)).toBe(true);
    expect(new Set(state.fields!.map(field => `${field.x},${field.y}`)).size).toBe(camps.length);
    expect(state.world.tiles.some(tile => tile.overlay === overlay)).toBe(true);
  });

  it('clears tower and wall sites immediately without clearing a road tile', () => {
    const state = createGame(world()), leader = getLeader(state)!;
    state.factions.forEach(unlockBuildingResearch);
    state.factions[0].culture = 10000; // Isolate clearing rules from territorial expansion.
    entityStore(state).units.replace([leader]); leader.x = 14.5; leader.y = 13.5;
    entityStore(state).buildings.replace(state.buildings.filter(building => building.kind === 'palace')); state.fields = [];
    for (const x of [12, 14, 16]) {
      const tile = tileAt(state.world, x, 11)!;
      tile.overlay = 'forest'; Object.assign(tile, terrainYields(tile.terrain, 'forest'));
    }
    const wallTile = tileAt(state.world, 14, 11)!;
    wallTile.food += 1; // Retain an existing riverside yield bonus while clearing.
    updateFog(state);
    expect(buildAt(state, 'woodenTower', 12, 11).ok).toBe(true);
    expect(buildAt(state, 'wall', 14, 11).ok).toBe(true);
    entityStore(state).buildings.add({ id: 9999, kind: 'road', faction: 0, x: 17, y: 11, hp: 100, maxHp: 100, capacity: 0 });
    expect(buildAt(state, 'road', 16, 11).ok).toBe(true);
    expect(tileAt(state.world, 12, 11)?.overlay).toBe('none');
    expect(wallTile.overlay).toBe('none');
    expect(wallTile.food).toBe(terrainYields(wallTile.terrain, 'none').food + 1);
    expect(tileAt(state.world, 16, 11)?.overlay).toBe('forest');
    expect(state.buildings.find(building => building.kind === 'woodenTower')?.construction).toBeDefined();
  });

  it('clears vegetation from occupied building footprints while preserving roadside trees', () => {
    const state = createGame(world());
    const palace = state.buildings.find(building => building.kind === 'palace')!;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) tileAt(state.world, palace.x + dx, palace.y + dy)!.overlay = 'forest';
    const extra: Building[] = [
      { id: 9000, kind: 'road', faction: 0, x: 20, y: 20, hp: 100, maxHp: 100, capacity: 0 },
      { id: 9001, kind: 'wall', faction: 0, x: 22, y: 20, hp: 450, maxHp: 450, capacity: 0 },
      { id: 9002, kind: 'tower', faction: 0, x: 24, y: 20, hp: 1200, maxHp: 1200, capacity: 0 },
    ];
    entityStore(state).buildings.add(...extra);
    tileAt(state.world, 20, 20)!.overlay = 'forest';
    Object.assign(tileAt(state.world, 22, 20)!, { overlay: 'forest', elevation: .6 });
    Object.assign(tileAt(state.world, 24, 20)!, { overlay: 'forest', elevation: .8 });
    migrateGame(state);
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) expect(tileAt(state.world, palace.x + dx, palace.y + dy)?.overlay).toBe('none');
    expect(tileAt(state.world, 20, 20)?.overlay).toBe('forest');
    expect(tileAt(state.world, 22, 20)).toMatchObject({ overlay: 'none', elevation: .6 });
    expect(tileAt(state.world, 24, 20)).toMatchObject({ overlay: 'none', elevation: .8 });
  });
});
