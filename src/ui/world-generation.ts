import type { MatchOptions } from '../multiplayer/protocol';
import type { LandscapeParameters } from '../world/options';

export const WORLD_GENERATION_TITLE = 'Generating world...';

/** Menu presets only. Terrain generation and game difficulty keep their existing owners. */
export type NewGameOptions = MatchOptions & {
  scenario?: import('../game/scenario-content').ScenarioId;
  width?: number; height?: number;
  parameters?: Partial<LandscapeParameters>;
  banditIntensity?: number;
};
export const WORLD_SIZES = [
  { id: 'tiny', label: 'Tiny', width: 160, height: 128 },
  { id: 'small', label: 'Small', width: 174, height: 140 },
  { id: 'standard', label: 'Standard', width: 187, height: 150 },
  { id: 'large', label: 'Large', width: 224, height: 180 },
  { id: 'huge', label: 'Huge', width: 260, height: 208 },
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
export const AGES = ['3 Billion', '4 Billion', '5 Billion'] as const;
export interface WorldSetup {
  size: string;
  barbarians: number | 'random';
  landmass: typeof LAND_MASSES[number]['id'] | 'random';
  water: number;
  climate: number;
  temperature: number;
  age: number;
  randomEnvironment: boolean;
}
export const initialWorldSetup = (): WorldSetup => ({ size: 'standard', barbarians: 1,
  landmass: 'continents', water: 70, climate: 1, temperature: 1, age: 1, randomEnvironment: false });

/** Resolve Random once at submission, so retries reuse the same concrete options. */
export function newGameOptions(base: MatchOptions, setup: WorldSetup): NewGameOptions {
  const pick = <T>(values: readonly T[]): T => values[Math.floor(Math.random() * values.length)];
  const size = WORLD_SIZES.find(size => size.id === setup.size) ?? pick(WORLD_SIZES);
  const landmass = LAND_MASSES.find(mass => mass.id === setup.landmass) ?? pick(LAND_MASSES);
  const climate = setup.randomEnvironment ? pick([0, 1, 2]) : setup.climate;
  const temperature = setup.randomEnvironment ? pick([0, 1, 2]) : setup.temperature;
  const age = setup.randomEnvironment ? pick([0, 1, 2]) : setup.age;
  const water = setup.landmass === 'random' ? pick([60, 70, 80]) : setup.water;
  const parameters: Partial<LandscapeParameters> = {
    seaLevel: water,
    age: age + 3,
    climate,
    temperature,
    ...(landmass.id === 'archipelago' ? { islandDensity: 1.8, islandSize: .65, coastRoughness: 1.4 } : {}),
  };
  return { ...base, style: landmass.style, width: size.width, height: size.height, parameters,
    banditIntensity: setup.barbarians === 'random' ? pick(BARBARIANS).value : setup.barbarians };
}
