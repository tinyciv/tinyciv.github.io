import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The Storybook harness must await exactly the art the game awaits before its
// first frame, or stories could silently render differently from the game.
describe('storybook scenario harness', () => {
  it('loads the same world art as src/main.ts', () => {
    const main = readFileSync('src/main.ts', 'utf8'), harness = readFileSync('stories/harness/assets.ts', 'utf8');
    const game = main.match(/const assets = \[([^\]]*)\]/)?.[1];
    const stories = harness.match(/GAME_ART_LOADERS = \[([^\]]*)\]/)?.[1];
    expect(game && stories).toBeTruthy();
    const names = (list: string) => list.split(',').map(entry => entry.trim().replace(/\(\)$/, '')).filter(Boolean)
      .filter(name => name !== 'renderer.initialize').sort();
    expect(names(stories!)).toEqual(names(game!));
  });
});
