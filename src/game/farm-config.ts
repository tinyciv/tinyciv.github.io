import { rustEngine } from './rust-engine';
/** A farm order buys one crop tile, with the 30% growth-cost increase. */
export const FARM_BUILD_GOLD = rustEngine.progression_constant(7);
export const FARM_BUILD_SECONDS = rustEngine.construction_duration(6);
