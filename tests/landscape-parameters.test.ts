import { STARTING_FACTION_COUNT, OPPOSING_FACTION_COUNT } from '../src/game/civilizations';
import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/world/generator';
import { DEFAULT_LANDSCAPE_PARAMETERS, LANDSCAPE_CONTROLS, resolveLandscapeParameters } from '../src/world/options';
import approvedPreset from './fixtures/fractal-gallery-20.json';

describe('landscape generation controls', () => {
  it('uses the complete approved gallery sample #20 as the new-world defaults', () => {
    expect(DEFAULT_LANDSCAPE_PARAMETERS).toEqual(approvedPreset.parameters);
    expect(resolveLandscapeParameters()).toEqual(approvedPreset.parameters);
    const world = generateWorld(approvedPreset.seed);
    expect(world.generationStyle).toBe(approvedPreset.style);
    expect(world.generationParameters).toEqual(approvedPreset.parameters);
  }, 15000);
  it('rejects invalid settings before generating and does not mutate shared defaults', () => {
    expect(resolveLandscapeParameters()).toEqual(DEFAULT_LANDSCAPE_PARAMETERS);
    for (const key of Object.keys(LANDSCAPE_CONTROLS)) {
      expect(() => resolveLandscapeParameters({ [key]: Infinity })).toThrow(RangeError);
      expect(() => resolveLandscapeParameters({ [key]: -100 })).toThrow(RangeError);
    }
    expect(() => resolveLandscapeParameters({ typo: 1 } as never)).toThrow(RangeError);
    expect(() => resolveLandscapeParameters(JSON.parse('{"__proto__": 1}'))).toThrow(RangeError);
    expect(() => resolveLandscapeParameters(JSON.parse('{"constructor": 1}'))).toThrow(RangeError);
    const custom = resolveLandscapeParameters({ forestThreshold: .6 });
    expect(custom.forestThreshold).toBe(.6);
    expect(DEFAULT_LANDSCAPE_PARAMETERS.forestThreshold).toBe(approvedPreset.parameters.forestThreshold);
  });

  it('stores complete reproducible settings and changes land cover for the same fractal seed', () => {
    const parameters = { forestThreshold: .6, lakeDensity: .6, reliefCoverage: .05, coastRoughness: .8 };
    const world = generateWorld('fractal-settings', 160, 128, { parameters });
    expect(world.generationStyle).toBe('fractal');
    expect(world.generationParameters).toEqual(resolveLandscapeParameters(parameters));
    expect(generateWorld('fractal-settings', 160, 128, { parameters: world.generationParameters })).toEqual(world);
    const lush = generateWorld('fractal-settings', 160, 128, { parameters: { ...parameters, forestThreshold: .48 } });
    const woods = (value: typeof world) => value.tiles.filter(tile => tile.overlay === 'forest').length;
    expect(woods(lush)).toBeGreaterThan(woods(world) * 1.3);
    expect(lush.spawns).toHaveLength(STARTING_FACTION_COUNT); expect(lush.secondarySpawns).toHaveLength(OPPOSING_FACTION_COUNT);
  }, 15000);

  it('reserves enough viable space for all towns on a tiny dry development map', () => {
    const world = generateWorld('ridge-size-0', 64, 64);
    expect(world.spawns).toHaveLength(STARTING_FACTION_COUNT); expect(world.secondarySpawns).toHaveLength(OPPOSING_FACTION_COUNT);
    const towns = [...world.spawns, ...world.secondarySpawns!];
    for (let i = 0; i < towns.length; i++) for (let j = 0; j < i; j++)
      expect(Math.hypot(towns[i].x - towns[j].x, towns[i].y - towns[j].y)).toBeGreaterThanOrEqual(7);
  });
});
