import { describe, expect, it } from 'vitest';
import { OLIVE_RESOURCE_VARIANTS, TREE_FAMILIES, vegetationStump, vegetationVariant } from '../src/game/vegetation-art';
import type { Tile } from '../src/game/types';
import { punyAtlas } from './puny-atlas.js';

const tile = (changes: Partial<Tile> = {}): Tile => ({ terrain: 'desert', overlay: 'none', elevation: .4, moisture: .1, food: 0, production: 0, gold: 0, variation: 0, ...changes });

describe('varied native vegetation', () => {
  it('has a visible native stump for every generated tree family and size', () => {
    const atlas = punyAtlas(new URL('../public/assets/vegetation/medieval-nature.png', import.meta.url));
    for (const family of Object.keys(TREE_FAMILIES) as (keyof typeof TREE_FAMILIES)[]) {
      for (let i = 0; i < TREE_FAMILIES[family].length; i++) {
        const t = tile({ overlay: 'forest', treeClass: family, variation: i / 0x1000000 });
        const stump = vegetationStump(t)!;
        let count = 0, upper = 0;
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++)
          if (atlas.data[((stump.y + y) * atlas.width + stump.x + x) * 4 + 3]) { count++; if (y < 3) upper++; }
        expect(count).toBeGreaterThan(8); expect(count).toBeLessThan(130);
        expect(upper).toBe(0);
      }
    }
  });
  it('keeps coherent Medieval broadleaf silhouettes with stable selection', () => {
    const variants = new Set<string>(), sheets = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const t = tile({ terrain: 'grassland', overlay: 'forest', variation: i / 0x1000000 });
      const source = vegetationVariant(t)!;
      expect(vegetationVariant(t)).toEqual(source);
      variants.add(JSON.stringify(source)); sheets.add(source.sheet);
      expect(source.width).toBe(16); expect([16, 32]).toContain(source.height);
    }
    expect(variants.size).toBe(2);
    expect([...sheets]).toEqual(['medieval']);
  });

  it('uses only Medieval World trees for every climate and wild palm', () => {
    for (const terrain of ['grassland', 'desert', 'tundra'] as const)
      for (const overlay of ['forest', 'jungle'] as const)
        for (const palm of [false, true]) for (let i = 0; i < 100; i++) {
          const source = vegetationVariant(tile({ terrain, overlay, palm, variation: i / 0x1000000 }))!;
          expect(source.sheet).toBe('medieval');
          expect(source.width).toBe(16); expect([16, 32]).toContain(source.height);
        }
  });

  it('never mixes unrelated families within a generated climate class', () => {
    for (const family of Object.keys(TREE_FAMILIES) as (keyof typeof TREE_FAMILIES)[]) {
      const seen = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const source = vegetationVariant(tile({ terrain: family === 'snowy' ? 'tundra' : 'grassland', overlay: 'forest', treeClass: family, variation: i / 0x1000000 }))!;
        expect(TREE_FAMILIES[family]).toContainEqual(source);
        seen.add(JSON.stringify(source));
      }
      expect(seen.size).toBe(TREE_FAMILIES[family].length);
    }
  });

  it('reserves both original olive sizes for resources instead of ordinary forest generation', () => {
    expect(OLIVE_RESOURCE_VARIANTS.map(source => source.height)).toEqual([16, 32]);
    for (const family of Object.keys(TREE_FAMILIES) as (keyof typeof TREE_FAMILIES)[])
      for (let i = 0; i < 100; i++) {
        const source = vegetationVariant(tile({ overlay: 'forest', treeClass: family, variation: i / 0x1000000 }));
        expect(OLIVE_RESOURCE_VARIANTS).not.toContainEqual(source);
      }
  });

  it('leaves bare desert clear of cactus while retaining its native trees and palms', () => {
    for (let i = 0; i < 500; i++) {
      const desert = tile({ variation: i * 13 / 0x1000000 });
      expect(vegetationVariant(desert)).toBeUndefined();
      expect(TREE_FAMILIES.dry).toContainEqual(vegetationVariant({ ...desert, overlay: 'forest' }));
      expect(TREE_FAMILIES.tropical).toContainEqual(vegetationVariant({ ...desert, palm: true }));
    }
  });
});
