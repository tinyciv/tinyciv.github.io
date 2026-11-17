import { rustEngine } from './rust-engine';
/** Whole residents per house tier; explicit redevelopment/research beds are added separately. */
export const HOUSE_BASE_CAPACITIES = [2, 3, 4, 5] as const;
export const HOUSE_BUILD_GOLD = rustEngine.progression_constant(8);
export const HOUSE_BUILD_SECONDS = rustEngine.construction_duration(7);
