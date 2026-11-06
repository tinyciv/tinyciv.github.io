import { describe, expect, it } from 'vitest';
import { BUILD_OPTIONS, buildLabel, buildMenuForSelection, buildOptionsForMenu, buildSelectionForKey, supportsBuildStroke } from '../src/ui/build-controls';

describe('construction keyboard controls', () => {
  it('separates buildings from walls, towers and guard posts', () => {
    expect(buildOptionsForMenu('fortifications').map(option => option.kind)).toEqual(['palisade', 'wall', 'woodenTower', 'observationPost', 'guardPost', 'fort', 'ballista']);
    const buildings = buildOptionsForMenu('build');
    expect(buildings).toHaveLength(16);
    expect(buildings.some(option => ['wall', 'woodenTower', 'guardPost', 'clearTrees'].includes(option.kind))).toBe(false);
    expect(buildSelectionForKey('g', 'build')).toBe('camp');
    expect(buildSelectionForKey('t', 'build')).toBe('dock');
    expect(buildSelectionForKey('f', 'build')).toBeUndefined();
    expect(buildSelectionForKey('f', 'fortifications')).toBeUndefined();
    expect(buildSelectionForKey('p', 'build')).toBe('healerShack');
    expect(buildSelectionForKey('p', 'fortifications')).toBe('wall');
    expect(buildSelectionForKey('g', 'fortifications')).toBe('guardPost');
    expect(buildSelectionForKey('l', 'fortifications')).toBe('ballista');
    expect(buildSelectionForKey('v', 'fortifications')).toBe('fort');
    expect(buildSelectionForKey('z', 'build')).toBe('supplyDepot');
  });

  it('reserves building letters for their menu without consuming movement or menu keys', () => {
    for (const option of BUILD_OPTIONS) {
      expect(buildSelectionForKey(option.key, null)).toBeUndefined();
      expect(buildSelectionForKey(option.key.toUpperCase(), buildMenuForSelection(option.kind))).toBe(option.kind);
    }
    for (const menu of [null, 'build', 'fortifications'] as const) {
      for (const key of ['w', 'a', 's', 'd', 'W', 'A', 'S', 'D', 'ArrowUp', 'b', 'f', 'Home'])
        expect(buildSelectionForKey(key, menu)).toBeUndefined();
    }
    for (const menu of ['build', 'fortifications'] as const) {
      const choices = buildOptionsForMenu(menu);
      expect(new Set(choices.map(option => option.key)).size).toBe(choices.length);
    }
  });

  it('leaves C to the unified area tool and keeps internal tree drag support', () => {
    for (const menu of [null, 'build', 'fortifications'] as const)
      expect(buildSelectionForKey('C', menu)).toBeUndefined();
    expect(buildMenuForSelection('clearTrees')).toBeNull();
    expect(BUILD_OPTIONS.some(option => (option.kind as string) === 'clearTrees')).toBe(false);
    expect(buildLabel('clearTrees')).toBe('Clear trees');
    expect(supportsBuildStroke('clearTrees')).toBe(true);
  });

  it('leaves all empty numbered slots unassigned', () => {
    for (const menu of [null, 'build', 'fortifications'] as const)
      for (const key of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'])
        expect(buildSelectionForKey(key, menu)).toBeUndefined();
    expect(buildMenuForSelection('wall')).toBe('fortifications');
    expect(buildMenuForSelection('bridge')).toBe('build');
  });

  it('displays Settlement everywhere the internal palace kind is labelled', () => {
    expect(buildLabel('palace')).toBe('Settlement');
    expect(buildSelectionForKey('N', 'build')).toBe('palace');
    expect(buildLabel('palisade')).toBe('Palisade');
  });

  it('drags routes and walls but places ordinary buildings as single sites', () => {
    expect(BUILD_OPTIONS.filter(option => supportsBuildStroke(option.kind)).map(option => option.kind)).toEqual(['road', 'irrigation', 'palisade', 'wall', 'bridge']);
    for (const kind of ['camp', 'house', 'woodenTower', 'monument', 'blacksmith', 'guardPost'] as const)
      expect(supportsBuildStroke(kind)).toBe(false);
  });
});
