import type { BuildingKind, BuildSelection } from '../game/types';

export type BuildMenu = 'build' | 'fortifications';

/** Building letters are scoped to their menu; movement keys stay available. */
export const BUILD_OPTIONS: readonly { kind: Exclude<BuildSelection, 'clearTrees'>; key: string; label: string }[] = [
  { kind: 'road', key: 'r', label: 'Road' },
  { kind: 'irrigation', key: 'u', label: 'Irrigation' },
  { kind: 'camp', key: 'g', label: 'Farm' },
  { kind: 'palisade', key: 'o', label: 'Palisade' },
  { kind: 'wall', key: 'p', label: 'Wall' },
  { kind: 'woodenTower', key: 't', label: 'Wood tower' },
  { kind: 'observationPost', key: 'i', label: 'Observation post' },
  { kind: 'guardPost', key: 'g', label: 'Guard post' },
  { kind: 'fort', key: 'v', label: 'Fort' },
  { kind: 'supplyDepot', key: 'z', label: 'Supply depot' },
  { kind: 'ballista', key: 'l', label: 'Ballista' },
  { kind: 'house', key: 'h', label: 'House' },
  { kind: 'bridge', key: 'v', label: 'Bridge' },
  { kind: 'dock', key: 't', label: 'Dock' },
  { kind: 'well', key: 'l', label: 'Well' },
  { kind: 'monument', key: 'm', label: 'Monument' },
  { kind: 'blacksmith', key: 'k', label: 'Blacksmith' },
  { kind: 'archeryRange', key: 'j', label: 'Archery range' },
  { kind: 'scoutLodge', key: 'o', label: 'Scouts’ Lodge' },
  { kind: 'healerShack', key: 'p', label: 'Healer’s shack' },
  { kind: 'stable', key: 'y', label: 'Stable' },
  { kind: 'library', key: 'i', label: 'Library' },
  { kind: 'palace', key: 'n', label: 'Settlement' },
];

export function buildMenuForSelection(kind: BuildSelection): BuildMenu | null {
  if (kind === 'clearTrees') return null;
  return ['fort', 'wall', 'palisade', 'woodenTower', 'tower', 'guardPost', 'ballista', 'observationPost'].includes(kind) ? 'fortifications' : 'build';
}

export const buildOptionsForMenu = (menu: BuildMenu) => BUILD_OPTIONS.filter(option => buildMenuForSelection(option.kind) === menu);

/** Building letters are scoped to the open menu. Clear is handled as an area tool. */
export function buildSelectionForKey(key: string, menu: BuildMenu | null): BuildSelection | undefined {
  key = key.toLowerCase();
  return menu ? buildOptionsForMenu(menu).find(option => option.key === key)?.kind : undefined;
}

export function supportsBuildStroke(kind: BuildSelection): boolean {
  return kind === 'road' || kind === 'irrigation' || kind === 'wall' || kind === 'palisade' || kind === 'bridge' || kind === 'clearTrees';
}

export function buildLabel(kind: BuildSelection): string {
  if (kind === 'clearTrees') return 'Clear trees';
  return BUILD_OPTIONS.find(option => option.kind === kind)?.label ?? kind.charAt(0).toUpperCase() + kind.slice(1);
}
