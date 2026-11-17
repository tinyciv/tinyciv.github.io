import { loadFieldCannonArt } from '../../src/game/field-cannon-art';
import { loadExplorationArt } from '../../src/game/exploration-art';
import { loadPavedRoadArt } from '../../src/game/paved-road-art';
import { loadQuestArt } from '../../src/game/quest-art';
/**
 * The world-art loaders the game awaits before its first frame (src/main.ts,
 * the `assets` list). Keep this list identical to main.ts minus
 * `renderer.initialize()`; tests/storybook-harness.test.ts enforces that.
 */
import { loadLoyaltyArt } from '../../src/game/loyalty-art';
import { loadHandcartArt } from '../../src/game/handcart-art';
import { loadSupplyDepotArt } from '../../src/game/supply-depot-art';
import { loadHermitArt } from '../../src/game/hermit-art';
import { loadGameFonts } from '../../src/game/game-font';
import { loadPalaceSprite } from '../../src/game/palace-sprite';
import { loadFortArt } from '../../src/game/fort-art';
import { loadStoneWallTowerArt } from '../../src/game/stone-wall-tower-art';
import { loadPalisadeTowerArt } from '../../src/game/palisade-tower-art';
import { loadPunyCharacters } from '../../src/game/unit-sprites';
import { loadFarmArt } from '../../src/game/farm-art';
import { loadSaltPanArt } from '../../src/game/salt-pan-art';
import { loadResourceArt } from '../../src/game/resource-art';
import { loadFoodArt } from '../../src/game/food-art';
import { loadNavalArt } from '../../src/game/naval-art';
import { loadFishingArt } from '../../src/game/fishing-art';
import { loadCityPanelArt } from '../../src/game/city-panel-art';
import { loadCombatEffectArt } from '../../src/game/combat-effect-art';
import { loadBuildingDestructionArt } from '../../src/game/building-destruction-art';
import { loadConstructionArt } from '../../src/game/construction-art';
import { loadGeothermalArt } from '../../src/game/geothermal-art';
import { loadResearchIcons } from '../../src/ui/research-icons';
import { loadIrrigationArt } from '../../src/game/irrigation-art';
import { loadTreasureArt } from '../../src/game/treasure';
import { loadMonumentArt } from '../../src/game/monument-art';
import { loadStoneBridgeArt } from '../../src/game/stone-bridge-art';
import { loadCivicArt } from '../../src/game/civic-art';
import { loadBlacksmithArt } from '../../src/game/blacksmith-art';
import { loadPalisadeArt } from '../../src/game/palisade-art';
import { loadArcheryArt } from '../../src/game/archery-art';
import { loadLibraryArt } from '../../src/game/library-art';
import { loadScoutsLodgeArt } from '../../src/game/scout-art';
import { loadHealerShackArt } from '../../src/game/healer-art';
import { loadGuardPostArt } from '../../src/game/guard-post-art';
import { loadWildlifeArt } from '../../src/game/wildlife-art';
import { loadMerchantArt } from '../../src/game/merchant-art';
import { loadVegetationArt } from '../../src/game/vegetation-art';
import { loadPikemanArt } from '../../src/game/pikeman-art';
import { loadMusketmanArt } from '../../src/game/musketman-art';
import { loadBrigandArt } from '../../src/game/brigand-art';

export const GAME_ART_LOADERS = [loadFieldCannonArt, loadExplorationArt, loadPavedRoadArt, loadLoyaltyArt, loadHandcartArt, loadSupplyDepotArt, loadHermitArt, loadQuestArt, loadGameFonts, loadPalaceSprite, loadFortArt, loadStoneWallTowerArt, loadPalisadeTowerArt, loadPunyCharacters, loadFarmArt, loadSaltPanArt, loadResourceArt, loadFoodArt, loadNavalArt, loadFishingArt, loadCityPanelArt, loadCombatEffectArt, loadBuildingDestructionArt, loadConstructionArt, loadGeothermalArt, loadResearchIcons, loadIrrigationArt, loadTreasureArt, loadMonumentArt, loadStoneBridgeArt, loadCivicArt, loadPikemanArt, loadBrigandArt, loadMusketmanArt, loadBlacksmithArt, loadPalisadeArt, loadArcheryArt, loadLibraryArt, loadScoutsLodgeArt, loadHealerShackArt, loadGuardPostArt, loadWildlifeArt, loadMerchantArt, loadVegetationArt] as const;

let loading: Promise<void> | undefined;
/** Every loader memoizes itself; this resolves once all game art is ready. */
export function loadGameArt(): Promise<void> {
  return loading ??= Promise.all(GAME_ART_LOADERS.map(load => load())).then(() => undefined);
}
