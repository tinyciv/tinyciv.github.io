import { SCENARIOS, type ScenarioId } from './scenario-content';
import { parseGameSave } from './game-save';
import { publishFog } from './fog';
import { scheduleOpeningHarvests } from './farms';
import { rustEngine } from './rust-engine';
import { initializeStartingScoutTowers, migrateGame } from './simulation';
import { generateFertilityGrass } from '../world/fertility-native';
import { banditIntensity } from './bandit-intensity';
import { resetRaidDirector } from './raid-director';
import type { GameState } from './types';

/** Load a complete offline-built start. No world generation, city growth or
 * simulated warmup runs when the player selects a scenario. */
export async function createScenarioGame(id: ScenarioId, onProgress?: (progress: number, phase: string) => void): Promise<GameState> {
  const scenario = SCENARIOS.find(scenario => scenario.id === id);
  if (!scenario) throw new Error('Choose a scenario from the Scenarios menu.');
  let response: Response, bytes = new Uint8Array();
  onProgress?.(0, 'Downloading scenario');
  try {
    response = await fetch(`${import.meta.env.BASE_URL}scenarios/${id}.json.gz`);
    onProgress?.(.15, 'Downloading scenario');
    if (response.ok) bytes = new Uint8Array(await response.arrayBuffer());
  } catch (cause) {
    throw new Error(`Could not download ${scenario.name}. Check your connection and try again.`, { cause });
  }
  if (!response.ok) throw new Error(response.status === 404
    ? `${scenario.name} is missing from this game version. Reload the game or update it, then try again.`
    : `Could not download ${scenario.name}. Try again in a moment.`);
  let state: GameState;
  onProgress?.(.45, 'Reading scenario');
  try {
    // A host may already have decompressed the response.
    const compressed = bytes[0] === 0x1f && bytes[1] === 0x8b;
    const serialized = compressed
      ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
      : new TextDecoder().decode(bytes);
    onProgress?.(.7, 'Preparing cities');
    await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    state = parseGameSave(serialized);
  } catch (cause) {
    throw new Error(`${scenario.name} data could not be read. Reload the game and try again.`, { cause });
  }
  if (state.world.scenario !== id || state.scenarioPreparing) throw new Error(`${scenario.name} data is incomplete or mismatched. Reload the game and try again.`);
  // Use the current spawn limit when starting a pre-generated scenario.
  if (state.treasures) state.treasures = state.treasures.slice(0,
    rustEngine.exploration_treasure_target(state.world.width, state.world.height));
  onProgress?.(.85, 'Preparing cities');
  await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
  generateFertilityGrass(state.world);
  const refreshCamps = banditIntensity(state) > 0;
  if (refreshCamps) {
    // The scenario ships authored terrain and cities. Place its camps from
    // the current frontier rules before exposing the opening to the player.
    const campPacks = new Set(state.marauderPacks?.filter(pack => pack.raiderCamp !== undefined).map(pack => pack.id));
    state = { ...state,
      units: state.units.filter(unit => unit.marauderPack === undefined || !campPacks.has(unit.marauderPack)),
      buildings: state.buildings.filter(building => building.raiderCamp === undefined),
      marauderPacks: state.marauderPacks?.filter(pack => !campPacks.has(pack.id)),
    };
    if (state.fog?.buildings) state.fog.buildings = state.fog.buildings.filter(building => building.raiderCamp === undefined);
    delete state.raiderCamps;
    delete state.fogRaids;
    delete state.raiderCampPopulationRetryAt;
    delete state.roamingMaraudersVersion;
  }
  const game = migrateGame(state);
  if (refreshCamps) resetRaidDirector(game);
  scheduleOpeningHarvests(game);
  initializeStartingScoutTowers(game);
  publishFog(game);
  onProgress?.(1, 'Scenario ready');
  return game;
}
