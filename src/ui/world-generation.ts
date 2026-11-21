import type { MatchOptions } from '../multiplayer/protocol';
import { DEFAULT_WORLD_HEIGHT, DEFAULT_WORLD_WIDTH, MAX_WORLD_DIMENSION, type LandscapeParameters } from '../world/options';

export const WORLD_GENERATION_TITLE = 'Generating world...';

/** Menu presets only. Terrain generation and game difficulty keep their existing owners. */
export type NewGameOptions = MatchOptions & {
  scenario?: import('../game/scenario-content').ScenarioId;
  width?: number; height?: number;
  parameters?: Partial<LandscapeParameters>;
  banditIntensity?: number;
  banditStrength?: number;
};
export const WORLD_SIZES = [
  { id: 'tiny', label: 'Tiny', width: 320, height: 256 },
  { id: 'small', label: 'Small', width: 348, height: 280 },
  { id: 'standard', label: 'Standard', width: DEFAULT_WORLD_WIDTH, height: DEFAULT_WORLD_HEIGHT },
  { id: 'large', label: 'Large', width: 448, height: 360 },
  { id: 'huge', label: 'Huge', width: MAX_WORLD_DIMENSION, height: 416 },
] as const;
export const BARBARIANS = [
  { label: 'No Barbarians', value: 0 }, { label: 'Sedentary', value: .5 },
  { label: 'Roaming', value: 1 }, { label: 'Restless', value: 2 }, { label: 'Raging', value: 3 },
] as const;
export const LAND_MASSES = [
  { id: 'pangaea', label: 'Pangaea', style: 'pangaea' },
  { id: 'continents', label: 'Continents', style: 'continents' },
  { id: 'archipelago', label: 'Archipelago', style: 'fractal' },
] as const;
export const CLIMATES = ['Arid', 'Normal', 'Wet'] as const;
export const TEMPERATURES = ['Warm', 'Temperate', 'Cool'] as const;
export interface WorldSetup {
  size: string;
  barbarians: number;
  landmass: typeof LAND_MASSES[number]['id'];
  water: number;
  climate: number;
  temperature: number;
}
export const initialWorldSetup = (): WorldSetup => ({ size: 'standard', barbarians: 1,
  landmass: 'continents', water: 70, climate: 1, temperature: 1 });

export function newGameOptions(base: MatchOptions, setup: WorldSetup): NewGameOptions {
  const size = WORLD_SIZES.find(size => size.id === setup.size) ?? { width: DEFAULT_WORLD_WIDTH, height: DEFAULT_WORLD_HEIGHT };
  const landmass = LAND_MASSES.find(mass => mass.id === setup.landmass)!;
  const parameters: Partial<LandscapeParameters> = {
    seaLevel: setup.water,
    climate: setup.climate,
    temperature: setup.temperature,
    ...(landmass.id === 'archipelago' ? { islandDensity: 1.8, islandSize: .65, coastRoughness: 1.4 } : {}),
  };
  return { ...base, style: landmass.style, width: size.width, height: size.height, parameters,
    banditIntensity: setup.barbarians };
}
