import { describe, expect, it } from 'vitest';
import { armorVisualLevel } from '../src/game/armor-art';
import { EQUIPMENT_MULTIPLIERS, MAX_EQUIPMENT_LEVEL } from '../src/game/equipment';
import { BLACKSMITH_UPGRADE_COSTS } from '../src/game/blacksmith';
import { unitKey } from '../src/game/native-art';
import type { Unit } from '../src/game/types';

describe('equipment progression and shield presentation', () => {
  it('retains the first three tiers and prices all six upgrades separately', () => {
    expect(MAX_EQUIPMENT_LEVEL).toBe(6);
    expect(EQUIPMENT_MULTIPLIERS).toEqual([1, 1.15, 1.3, 1.5, 1.7, 1.9, 2.1]);
    expect(BLACKSMITH_UPGRADE_COSTS).toEqual([200, 400, 600, 800, 1000, 1200]);
    expect(EQUIPMENT_MULTIPLIERS.length).toBe(MAX_EQUIPMENT_LEVEL + 1);
    expect(BLACKSMITH_UPGRADE_COSTS.length).toBe(MAX_EQUIPMENT_LEVEL);
  });

  it('maps higher combat tiers to the approved legionary shield without indexing missing art', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(armorVisualLevel)).toEqual([0, 1, 2, 3, 3, 3, 3]);
  });

  it.each(['leader', 'warrior', 'archer', 'scout'] as const)('shares identical tier-III-through-VI raster cache keys for %s sprites', kind => {
    const unit: Unit = { id: 1, kind, faction: 0, x: 1, y: 1, hp: 100, morale: 100,
      attack: 17, defense: 4, speed: 3, range: 1, order: 'hold', cooldown: 0, lastCombat: -60,
      moving: false, facing: 0, attackTime: 0, armorLevel: 3 };
    const key = unitKey(unit, 0, '#ee3434');
    for (const armorLevel of [4, 5, 6] as const) expect(unitKey({ ...unit, armorLevel }, 0, '#ee3434')).toBe(key);
    expect(unitKey({ ...unit, armorLevel: 2 }, 0, '#ee3434')).not.toBe(key);
  });
});
