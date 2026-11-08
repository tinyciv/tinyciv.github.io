import { auxiliaryIconUrl } from '../game/auxiliary-art';
import { militaryActionIcon } from './military-action-icons';
import { horsemanIconUrl, stableIconUrl } from '../game/cavalry-art';
import { ballistaIconUrl, spearmanIconUrl } from '../game/siege-art';
import { characterIconUrl } from '../game/unit-sprites';
import { drawBuilding } from '../game/sprites';
import { punyWorldImage } from '../game/puny-world';
import { drawFarmField } from '../game/farm-art';
import { nativeHouseTier } from '../game/puny-building-art';
import { palaceArtHeight } from '../game/palace-sprite';
import { birdIconUrl, boarIconUrl } from '../game/wildlife-art';
import { merchantIconUrl } from '../game/merchant-art';
import { irrigationIconUrl } from '../game/irrigation-art';
import { dockIconUrl } from '../game/naval-art';
import { galleyIconUrl } from '../game/galley-art';
import { buildingKindForSelection, type BuildingKind, type HouseStyle } from '../game/types';

/** HUD pictures use the same source art as the world. */
const worldIcons: Record<string, [number, number]> = {
  food: [0, 28], wheat: [0, 28], gold: [1, 26], coins: [1, 26],
  hammer: [1, 27], tools: [1, 27], materials: [1, 27],
  road: [3, 2], wall: [17, 27], bridge: [22, 29], palisade: [17, 27], woodenTower: [7, 27],
  home: [7, 27], terrain: [0, 5],
  tower: [18, 29], camp: [4, 26], house: [5, 26], shack: [5, 26], cottage: [5, 27],
};
const labels: Record<string, string> = {
  heart: 'HP', sword: 'ATK', shield: 'DEF', close: '×', plus: '+',
};
const controlSymbols = new Set(['pause', 'play', 'compass', 'check', 'minus']);
const characters: Record<string, 'leader' | 'archer' | 'scout' | 'warrior' | 'swordsman' | 'slinger' | 'worker' | 'militia' | 'marauder'> = {
  supplyCart: 'worker', crown: 'leader', people: 'worker', population: 'worker',
  slinger: 'slinger', archer: 'archer', scout: 'scout', warrior: 'warrior', swordsman: 'swordsman', militia: 'militia', worker: 'worker', marauder: 'marauder',
};
const buildingIcons = new Map<string, string>();
let farmlandIcon: string | undefined;
function farmIconUrl(): string {
  if (farmlandIcon) return farmlandIcon;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 48;
  const context = canvas.getContext('2d')!;
  drawFarmField(context, 0, 0, 48, 0, { id: 1, camp: 0, faction: 0, x: 0, y: 0, planted: true, food: 1, nextHarvest: 30 });
  return farmlandIcon = canvas.toDataURL();
}
/** Every building portrait calls the world renderer, including gate clipping. */
export function buildingIconUrl(selection: BuildingKind | 'trail', color: string, tier = 1, gate = false, palaceLevel: 1 | 2 = 1): string {
  const kind = selection === 'trail' ? 'road' : buildingKindForSelection(selection);
  const key = `${selection}:${color}:${tier}:${gate}:${palaceLevel}`, cached = buildingIcons.get(key);
  if (cached) return cached;
  const tall = kind === 'tower' || kind === 'woodenTower';
  const large = kind === 'palace' || kind === 'fort' || kind === 'archeryRange' || kind === 'library';
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = tall ? 112 : kind === 'archeryRange' ? 32 : kind === 'palace' ? palaceArtHeight(palaceLevel) : 64;
  const context = canvas.getContext('2d')!;
  const links = { north: false, south: false, east: true, west: true };
  const passage = { north: true, south: true, east: false, west: false };
  drawBuilding(context, { id: 0, kind, roadStyle: selection === 'trail' ? 'trail' : undefined, houseLevel: tier, palaceLevel, faction: 0, x: 0, y: 0, hp: 100, maxHp: 100, capacity: 0 },
    0, tall ? 48 : 0, large ? 32 : 64, 0, color, links, gate ? passage : undefined);
  const url = canvas.toDataURL(); buildingIcons.set(key, url); return url;
}
export function icon(name: string, color = '#f34f59', houseStyle?: HouseStyle | number, armorLevel = 0): string {
  if (name === 'levy' || name === 'garrison') return militaryActionIcon(name, color);
  if (name === 'levyInfantry' || name === 'skirmisher') return `<img aria-hidden="true" alt="" class="icon character-icon" src="${auxiliaryIconUrl(name, color)}">`;
  if (name === 'infantryFormation') return '<svg aria-hidden="true" class="icon infantry-formation-icon" viewBox="0 0 32 32"><path fill="currentColor" d="M5 5h5v5H5zm9 0h5v5h-5zm9 0h5v5h-5zM5 14h5v5H5zm18 0h5v5h-5zM5 23h5v5H5zm9 0h5v5h-5zm9 0h5v5h-5z"/><path fill="#fff4bc" d="m16.5 12 4.5 4.5-4.5 4.5-4.5-4.5z"/></svg>';
  if (name === 'horseman' || name === 'horseArcher' || name === 'knight') return `<img aria-hidden="true" alt="" class="icon character-icon" src="${horsemanIconUrl(color, name)}">`;
  if (name === 'stable') return `<img aria-hidden="true" alt="" class="icon" src="${stableIconUrl(color)}">`;
  if (name === 'sailboat') return `<img aria-hidden="true" alt="" class="icon" src="${galleyIconUrl()}">`;
  if (name === 'dock') return `<img aria-hidden="true" alt="" class="icon" src="${dockIconUrl()}">`;
  if (name === 'spearman') return `<img aria-hidden="true" alt="" class="icon character-icon" src="${spearmanIconUrl(color)}">`;
  if (name === 'ballista') return `<img aria-hidden="true" alt="" class="icon" src="${ballistaIconUrl()}">`;
  if (name === 'irrigation') return `<img aria-hidden="true" alt="" class="icon" src="${irrigationIconUrl()}">`;
  if (name === 'boar') return `<img aria-hidden="true" alt="" class="icon" src="${boarIconUrl()}">`;
  if (name === 'marshBird') return `<img aria-hidden="true" alt="" class="icon" src="${birdIconUrl()}">`;
  if (name === 'merchant') return `<img aria-hidden="true" alt="" class="icon character-icon" src="${merchantIconUrl()}">`;
  if (name === 'cancel') return '<svg aria-hidden="true" class="icon" viewBox="0 0 32 32"><path d="M6 3L16 13L26 3L30 7L20 17L30 27L26 31L16 21L6 31L2 27L12 17L2 7Z" fill="#602725"/><path d="M7 3L16 12L25 3L29 7L20 16L29 25L25 29L16 20L7 29L3 25L12 16L3 7Z" fill="#e66b60"/><path d="M7 3L16 12L25 3L27 5L16 16L5 5Z" fill="#ff9a85"/></svg>';
  if (name === 'demolish') return '<svg aria-hidden="true" class="icon" viewBox="0 0 32 32"><path d="M16 8V5H23V2H27" fill="none" stroke="#ead397" stroke-width="2"/><path d="M4 10H11V28H4ZM12 8H20V30H12ZM21 10H28V28H21Z" fill="#9c3935" stroke="#3a2624" stroke-width="2"/><path d="M6 11V25M14 9V27M23 11V25" stroke="#eb8270" stroke-width="2"/><path d="M3 15H29V23H3Z" fill="#c6ad75" stroke="#463c2e" stroke-width="1.5"/><path d="M7 17H11M9 17V21M13 21V17L17 21V17M20 17H24M22 17V21" fill="none" stroke="#4c3830" stroke-width="1.2"/></svg>';
  if (name === 'clearTrees') return '<svg aria-hidden="true" class="icon" viewBox="0 0 32 32"><path d="M8 28L23 7" stroke="#a97b43" stroke-width="4"/><path d="M17 5L24 3L30 13L21 15Z" fill="#c4c9c5" stroke="#343c38" stroke-width="2"/></svg>';
  if (name === 'camp' && punyWorldImage()) return `<img aria-hidden="true" alt="" class="icon" src="${farmIconUrl()}">`;
  if (punyWorldImage() && ['fort', 'supplyDepot', 'house', 'home', 'well', 'monument', 'blacksmith', 'archeryRange', 'scoutLodge', 'healerShack', 'library', 'guardPost', 'palace', 'keep', 'tower', 'woodenTower', 'palisade', 'wall', 'bridge', 'road', 'trail', 'palisadeGate', 'wallGate', 'villageTent'].includes(name)) {
    const kind = name === 'keep' ? 'palace' : name === 'home' ? 'house' : name === 'palisadeGate' ? 'palisade' : name === 'wallGate' ? 'wall' : name as BuildingKind | 'trail';
    const tier = nativeHouseTier({ id: 0, houseLevel: typeof houseStyle === 'number' ? houseStyle : undefined, houseStyle: typeof houseStyle === 'string' ? houseStyle : undefined });
    const style = kind === 'palace' ? ' palace-icon' : ['tower', 'woodenTower', 'wall', 'palisade', 'palisadeGate', 'wallGate'].includes(name) ? ' defense-icon' : '';
    return `<img aria-hidden="true" alt="" class="icon${style}" src="${buildingIconUrl(kind, color, tier, name === 'palisadeGate' || name === 'wallGate', name === 'keep' ? 2 : 1)}">`;
  }
  if (name === 'retinue') return '<span aria-hidden="true" class="icon retinue-icon"></span>';
  if (characters[name]) return `<img aria-hidden="true" alt="" class="icon character-icon" src="${characterIconUrl(characters[name], color, armorLevel)}">`;
  const tile = worldIcons[name];
  if (tile) return `<span aria-hidden="true" class="icon atlas-icon" style="--tile-x:${tile[0]};--tile-y:${tile[1]}"></span>`;
  if (controlSymbols.has(name)) return `<span aria-hidden="true" class="icon control-symbol symbol-${name}"></span>`;
  return labels[name] ? `<span aria-hidden="true" class="icon text-icon">${labels[name]}</span>`
    : '<span aria-hidden="true" class="icon control-symbol symbol-dot"></span>';
}
