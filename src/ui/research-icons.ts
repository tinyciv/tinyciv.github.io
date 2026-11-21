import { loadCavalryArt, horsemanIconUrl } from '../game/cavalry-art';
import { loadSiegeArt, ballistaIconUrl, spearmanIconUrl } from '../game/siege-art';
import type { ResearchBranchId } from '../game/types';
import { healerShackIconUrl, loadHealerShackArt } from '../game/healer-art';
import { characterIconUrl, loadPunyCharacters } from '../game/unit-sprites';
import { colosseumIconUrl, loadCivicArt } from '../game/civic-art';
import { loadPikemanArt, pikemanIconUrl } from '../game/pikeman-art';
import { runtimeArtUrl } from '../game/runtime-art';
import { SCIENCE_ICON_URL } from './science-icon';

const RESEARCH_ICON_BRANCHES: readonly ResearchBranchId[] = [
  'woodenTower', 'wall', 'reinforcedDefenses', 'monument', 'coinage', 'urbanPlanning', 'scoutLodge',
  'blacksmith', 'metalTools', 'archeryRange', 'fletching', 'irrigation', 'grainStorage',
  'sailing', 'whaling', 'militaryScience', 'officerCorps', 'animalHusbandry',
];

/** Existing forged glyphs plus the native healer artwork for medicine. */
export function researchIconUrl(branch: ResearchBranchId): string {
  if (branch === 'animalHusbandry') return `${import.meta.env.BASE_URL}assets/runtime/ui/resources/food.webp`;
  // Reuse the approved imagegen retinue command artwork.
  if (branch === 'officerCorps') return `${import.meta.env.BASE_URL}assets/runtime/ui/forged/retinue-actions-pixel.webp`;
  if (branch === 'cropRotation') return `${import.meta.env.BASE_URL}assets/runtime/ui/research/forged/grainStorage.webp`;
  if (branch === 'ironPlows') return `${import.meta.env.BASE_URL}assets/runtime/ui/research/forged/metalTools.webp`;
  if (branch === 'commerce') return `${import.meta.env.BASE_URL}assets/runtime/ui/research/forged/coinage.webp`;
  if (branch === 'drainage') return `${import.meta.env.BASE_URL}assets/runtime/ui/research/forged/irrigation.webp`;
  if (branch === 'militaryScience') return `${import.meta.env.BASE_URL}assets/runtime/ui/military-academy.webp`;
  if (branch === 'fieldCannon') return `${import.meta.env.BASE_URL}assets/runtime/ui/field-cannon.webp`;
  if (branch === 'whaling') return `${import.meta.env.BASE_URL}assets/runtime/ui/whaling.webp`;
  if (branch === 'lateenSails' || branch === 'navalEngineering') return `${import.meta.env.BASE_URL}assets/runtime/ui/naval/${branch === 'lateenSails' ? 'caravel' : 'frigate'}.webp`;
  if (branch === 'culturalIdentity') return `${import.meta.env.BASE_URL}assets/runtime/ui/resources/culture.webp`;
  if (branch === 'gunpowder') return `${import.meta.env.BASE_URL}assets/runtime/ui/research/forged/blacksmith.webp`;
  if (branch === 'roadBuilding') return `${import.meta.env.BASE_URL}assets/runtime/ui/research/forged/wall.webp`;
  if (branch === 'engineering') return `${import.meta.env.BASE_URL}assets/runtime/ui/research/forged/metalTools.webp`;
  if (branch === 'compoundBow') return horsemanIconUrl('#df6262', 'horseArcher');
  if (branch === 'stirrups') return horsemanIconUrl('#df6262', 'knight');
  if (branch === 'horsebackRiding') return horsemanIconUrl('#df6262');
  if (branch === 'sailing') return runtimeArtUrl(`${import.meta.env.BASE_URL}assets/pixelhole-overworld/Sailboat.png`);
  if (branch === 'siegeEngines') return ballistaIconUrl();
  if (branch === 'metalCasting') return characterIconUrl('swordsman', '#df6262');
  if (branch === 'militaryTactics') return spearmanIconUrl('#df6262');
  if (branch === 'infantryDrill') return characterIconUrl('warrior', '#df6262', 1);
  if (branch === 'traditionalMedicine') return healerShackIconUrl();
  if (branch === 'supplyTrain') return characterIconUrl('worker', '#df6262', 0);
  if (branch === 'massLevy') return spearmanIconUrl('#df6262');
  if (branch === 'urbanMilitia') return pikemanIconUrl('#df6262');
  if (branch === 'populism') return colosseumIconUrl();
  return `${import.meta.env.BASE_URL}assets/runtime/ui/research/forged/${branch}.webp`;
}

async function loadScienceArt(): Promise<void> {
  const image = new Image();
  image.src = SCIENCE_ICON_URL;
  await image.decode();
  if (image.naturalWidth !== 28 || image.naturalHeight !== 28) throw new Error('Invalid Science icon.');
}

let loading: Promise<void> | undefined;
export function loadResearchIcons(): Promise<void> {
  return loading ??= Promise.all([loadScienceArt(), loadCivicArt(), loadPikemanArt(), loadPunyCharacters(), loadCavalryArt(), loadHealerShackArt(), loadSiegeArt(), ...RESEARCH_ICON_BRANCHES.map(async branch => {
    const image = new Image(); image.src = researchIconUrl(branch);
    await image.decode();
    // Icon slots use object-fit: contain, so rectangular artwork is valid.
    if (!image.naturalWidth || !image.naturalHeight) throw new Error(`Invalid research icon: ${branch}`);
  })]).then(() => undefined);
}
