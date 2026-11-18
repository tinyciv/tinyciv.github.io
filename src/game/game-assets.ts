import { loadMilitaryAcademyArt } from './military-academy-art';
import { loadFieldCannonArt } from './field-cannon-art';
import { loadCannonFireArt } from './cannon-fire-art';
import { loadShellImpactArt } from './shell-impact-art';
import { loadExplorationArt } from './exploration-art';
import { loadRefugeeArt } from './refugee-art';
import { loadPavedRoadArt } from './paved-road-art';
import { loadLoyaltyArt } from './loyalty-art';
import { loadHandcartArt } from './handcart-art';
import { loadSupplyDepotArt } from './supply-depot-art';
import { loadHermitArt } from './hermit-art';
import { loadQuestArt } from './quest-art';
import { loadGameFonts } from './game-font';
import { loadPalaceSprite } from './palace-sprite';
import { loadFortArt } from './fort-art';
import { loadStoneWallTowerArt } from './stone-wall-tower-art';
import { loadPalisadeTowerArt } from './palisade-tower-art';
import { loadPunyCharacters } from './unit-sprites';
import { loadFarmArt } from './farm-art';
import { loadSaltPanArt } from './salt-pan-art';
import { loadResourceArt } from './resource-art';
import { loadFoodArt } from './food-art';
import { loadNavalArt } from './naval-art';
import { loadFishingArt } from './fishing-art';
import { loadCityPanelArt } from './city-panel-art';
import { loadCombatEffectArt } from './combat-effect-art';
import { loadBuildingDestructionArt } from './building-destruction-art';
import { loadConstructionArt } from './construction-art';
import { loadGeothermalArt } from './geothermal-art';
import { loadResearchIcons } from '../ui/research-icons';
import { loadIrrigationArt } from './irrigation-art';
import { loadTreasureArt } from './treasure';
import { loadMonumentArt } from './monument-art';
import { loadStoneBridgeArt } from './stone-bridge-art';
import { loadCivicArt } from './civic-art';
import { loadPikemanArt } from './pikeman-art';
import { loadBrigandArt } from './brigand-art';
import { loadMusketmanArt } from './musketman-art';
import { loadBlacksmithArt } from './blacksmith-art';
import { loadPalisadeArt } from './palisade-art';
import { loadArcheryArt } from './archery-art';
import { loadLibraryArt } from './library-art';
import { loadScoutsLodgeArt } from './scout-art';
import { loadHealerShackArt } from './healer-art';
import { loadGuardPostArt } from './guard-post-art';
import { loadWildlifeArt } from './wildlife-art';
import { loadMerchantArt } from './merchant-art';
import { loadVegetationArt } from './vegetation-art';
import { loadMeadowArt } from './meadow-art';
import type { Renderer } from './renderer';

/** Shared startup artwork; the viewer uses the same assets as the game. */
export function loadGameAssets(renderer: Renderer): Promise<void>[] {
  return [
    loadMilitaryAcademyArt(),
    loadFieldCannonArt(),
    loadCannonFireArt(),
    loadShellImpactArt(),
    loadExplorationArt(),
    loadRefugeeArt(),
    loadPavedRoadArt(),
    loadLoyaltyArt(),
    loadHandcartArt(),
    loadSupplyDepotArt(),
    loadHermitArt(),
    loadQuestArt(),
    loadGameFonts(),
    renderer.initialize(),
    loadPalaceSprite(),
    loadFortArt(),
    loadStoneWallTowerArt(),
    loadPalisadeTowerArt(),
    loadPunyCharacters(),
    loadFarmArt(),
    loadSaltPanArt(),
    loadResourceArt(),
    loadFoodArt(),
    loadNavalArt(),
    loadFishingArt(),
    loadCityPanelArt(),
    loadCombatEffectArt(),
    loadBuildingDestructionArt(),
    loadConstructionArt(),
    loadGeothermalArt(),
    loadResearchIcons(),
    loadIrrigationArt(),
    loadTreasureArt(),
    loadMonumentArt(),
    loadStoneBridgeArt(),
    loadCivicArt(),
    loadPikemanArt(),
    loadBrigandArt(),
    loadMusketmanArt(),
    loadBlacksmithArt(),
    loadPalisadeArt(),
    loadArcheryArt(),
    loadLibraryArt(),
    loadScoutsLodgeArt(),
    loadHealerShackArt(),
    loadGuardPostArt(),
    loadWildlifeArt(),
    loadMerchantArt(),
    loadVegetationArt(),
    loadMeadowArt(),
  ];
}
