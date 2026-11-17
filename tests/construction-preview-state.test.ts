import { describe, expect, it } from 'vitest';
import { constructionPreviewState } from '../src/game/construction-preview-state';
import { denseConstructionFixture } from './helpers/construction-preview';
import { markWorldChanged } from '../src/game/world-revisions';
import { structureChangeRevision } from '../src/game/simulation-reads';
import { entityStore } from '../src/game/entity-store';

describe('persistent construction transactions', () => {
  it('restores speculative cells and incorporates source edits while retaining private navigation identities', () => {
    const source = denseConstructionFixture(), farm = source.buildings.find(building => building.kind === 'camp')!;
    const field = source.fields![0];
    farm.villageId = 55; field.claimedBy = 9; source.casualties = [];
    const draft = constructionPreviewState(source, true), world = draft.world, tiles = world.tiles;
    const copy = draft.buildings.find(building => building.id === farm.id)!, plot = draft.fields![0];
    copy.x += 1; plot.x += 1;
    tiles[0] = { ...tiles[0], overlay: 'forest' };
    markWorldChanged(world, 'sight', [0]);
    source.world.tiles[1].terrain = 'lake'; markWorldChanged(source.world, 'geometry', [1]);
    delete farm.villageId; delete field.claimedBy; delete source.casualties;
    const before = structureChangeRevision(draft), reset = constructionPreviewState(source, true);
    expect(reset).toBe(draft); expect(reset.world).toBe(world); expect(reset.world.tiles).toBe(tiles);
    expect(reset.buildings.find(building => building.id === farm.id)).toBe(copy);
    expect(copy.x).toBe(farm.x); expect(plot.x).toBe(field.x);
    expect(copy).not.toHaveProperty('villageId'); expect(plot).not.toHaveProperty('claimedBy');
    expect(reset).not.toHaveProperty('casualties');
    expect(tiles[0]).toBe(source.world.tiles[0]); expect(tiles[1].terrain).toBe('lake');
    expect(structureChangeRevision(reset)).toBeGreaterThan(before);
    expect(entityStore(reset).buildings.get(farm.id)).toBe(copy);
  });

  it('falls back to a full exact restore after unlocated source and draft terrain edits', () => {
    const source = denseConstructionFixture(), draft = constructionPreviewState(source, true);
    draft.world.tiles[10] = { ...draft.world.tiles[10], terrain: 'lake' };
    draft.world.revision = (draft.world.revision ?? 0) + 1;
    source.world.tiles[20].overlay = 'forest';
    source.world.revision = (source.world.revision ?? 0) + 1;
    const reset = constructionPreviewState(source, true);
    expect(reset).toBe(draft);
    expect(reset.world.tiles).toEqual(source.world.tiles);
    expect(reset.world.tiles).not.toBe(source.world.tiles);
  });
});
