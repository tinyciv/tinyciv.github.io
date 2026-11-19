import type { BuildingKind, BuildSelection } from '../game/types';
import { isSiteBuilding, SITE_DEFINITIONS } from '../game/site-types';

export type BuildMenu = 'build' | 'fortifications';

/** Building letters are scoped to their menu; movement keys stay available. */
export const BUILD_OPTIONS: readonly { kind: Exclude<BuildSelection, 'clearTrees'>; key?: string; label: string }[] = [
  { kind: 'road', key: 'r', label: 'Road' },
  { kind: 'irrigation', key: 'u', label: 'Irrigation' },
  { kind: 'camp', key: 'g', label: 'Farm' },
  { kind: 'granary', key: 'e', label: 'Granary' },
  { kind: 'palisade', key: 'o', label: 'Palisade' },
  { kind: 'wall', key: 'p', label: 'Wall' },
  { kind: 'woodenTower', key: 't', label: 'Wood tower' },
  { kind: 'observationPost', key: 'i', label: 'Observation post' },
  { kind: 'guardPost', key: 'g', label: 'Guard post' },
  { kind: 'fort', key: 'v', label: 'Fort' },
  { kind: 'supplyDepot', key: 'z', label: 'Supply depot' },
  { kind: 'ballista', key: 'l', label: 'Ballista' },
  { kind: 'foundry', key: 'f', label: 'Foundry' },
  { kind: 'siegeCannon', key: 'n', label: 'Siege cannon' },
  { kind: 'house', key: 'h', label: 'House' },
  { kind: 'apartments', key: 'a', label: 'Apartments' },
  { kind: 'hospital', key: 'd', label: 'Hospital' },
  { kind: 'factory', key: 'f', label: 'Factory' },
  { kind: 'bridge', key: 'v', label: 'Bridge' },
  { kind: 'dock', key: 't', label: 'Dock' },
  { kind: 'whalingPost', key: 'w', label: 'Whaling post' },
  { kind: 'shipyard', key: 's', label: 'Shipyard' },
  { kind: 'well', key: 'l', label: 'Well' },
  { kind: 'fountain', label: 'Fountain' },
  { kind: 'monument', key: 'm', label: 'Monument' },
  { kind: 'blacksmith', key: 'k', label: 'Blacksmith' },
  { kind: 'archeryRange', key: 'j', label: 'Archery range' },
  { kind: 'scoutLodge', key: 'o', label: 'Scouts’ Lodge' },
  { kind: 'healerShack', key: 'p', label: 'Healer’s shack' },
  { kind: 'stable', key: 'y', label: 'Stable' },
  { kind: 'forum', key: 'q', label: 'Forum' },
  { kind: 'marketplace', key: 'z', label: 'Marketplace' },
  { kind: 'library', key: 'i', label: 'Library' },
  { kind: 'colosseum', key: 'x', label: 'Colosseum' },
  { kind: 'militaryAcademy', key: 'm', label: 'Military Academy' },
  { kind: 'barracks', key: 'x', label: 'Barracks' },
  { kind: 'palace', key: 'n', label: 'Town' },
];

export function buildMenuForSelection(kind: BuildSelection): BuildMenu | null {
  if (kind === 'clearTrees' || kind === 'scoutTower' || isSiteBuilding(kind)) return null;
  return ['fort', 'wall', 'palisade', 'woodenTower', 'tower', 'guardPost', 'ballista', 'siegeCannon', 'observationPost', 'barracks', 'foundry', 'militaryAcademy'].includes(kind) ? 'fortifications' : 'build';
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
  if (kind === 'goldMine') return 'Gold mine';
  if (kind === 'scoutTower') return 'Scout tower';
  if (kind === 'frontierVillage') return 'Village';
  const site = Object.values(SITE_DEFINITIONS).find(site => site.building === kind);
  if (site) return site.label;
  return BUILD_OPTIONS.find(option => option.kind === kind)?.label ?? kind.charAt(0).toUpperCase() + kind.slice(1);
}
