import { loadCavalryArt, horsemanIconUrl } from '../game/cavalry-art';
import { loadSiegeArt, ballistaIconUrl, spearmanIconUrl } from '../game/siege-art';
import type { ResearchBranchId } from '../game/types';
import { healerShackIconUrl, loadHealerShackArt } from '../game/healer-art';
import { characterIconUrl, loadPunyCharacters } from '../game/unit-sprites';

const RESEARCH_ICON_BRANCHES: readonly ResearchBranchId[] = [
  'woodenTower', 'wall', 'reinforcedDefenses', 'monument', 'coinage', 'urbanPlanning', 'scoutLodge',
  'blacksmith', 'metalTools', 'archeryRange', 'fletching', 'irrigation', 'grainStorage',
  'sailing',
];

/** Existing forged glyphs plus the native healer artwork for medicine. */
export function researchIconUrl(branch: ResearchBranchId): string {
  if (branch === 'engineering') return `${import.meta.env.BASE_URL}assets/ui/research/forged/metalTools.webp`;
  if (branch === 'compoundBow') return horsemanIconUrl('#df6262', 'horseArcher');
  if (branch === 'stirrups') return horsemanIconUrl('#df6262', 'knight');
  if (branch === 'horsebackRiding') return horsemanIconUrl('#df6262');
  if (branch === 'sailing') return `${import.meta.env.BASE_URL}assets/pixelhole-overworld/Sailboat.png`;
  if (branch === 'siegeEngines') return ballistaIconUrl();
  if (branch === 'metalCasting') return characterIconUrl('swordsman', '#df6262');
  if (branch === 'militaryTactics') return spearmanIconUrl('#df6262');
  if (branch === 'infantryDrill') return characterIconUrl('warrior', '#df6262', 1);
  if (branch === 'traditionalMedicine') return healerShackIconUrl();
  if (branch === 'supplyTrain') return characterIconUrl('worker', '#df6262', 0);
  if (branch === 'massLevy') return spearmanIconUrl('#df6262');
  return `${import.meta.env.BASE_URL}assets/ui/research/forged/${branch}.webp`;
}

let loading: Promise<void> | undefined;
export function loadResearchIcons(): Promise<void> {
  return loading ??= Promise.all([loadPunyCharacters(), loadCavalryArt(), loadHealerShackArt(), loadSiegeArt(), ...RESEARCH_ICON_BRANCHES.map(async branch => {
    const image = new Image(); image.src = researchIconUrl(branch);
    await image.decode();
    if (!image.naturalWidth || image.naturalWidth !== image.naturalHeight) throw new Error(`Invalid research icon: ${branch}`);
  })]).then(() => undefined);
}
