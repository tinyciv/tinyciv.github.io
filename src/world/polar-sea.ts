import { rustEngine } from '../game/rust-engine';

export const POLAR_SEA_LANE_WIDTH = rustEngine.polar_sea_lane_width();

export function isPolarSeaLane(y: number, height: number): boolean {
  const row = Math.floor(y);
  return row < POLAR_SEA_LANE_WIDTH || row >= height - POLAR_SEA_LANE_WIDTH;
}
