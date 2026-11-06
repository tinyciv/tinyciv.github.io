import type { World } from '../../src/game/types';
import type { LandformFamily, WorldGenerationStyle } from '../../src/world/options';

export interface DeltaRecord {
  id: number; mouth: number; discharge: number; cells: number[]; marshCells: number[];
  waterCells: number[]; distributaries: number[][];
  bounds: { x: number; y: number; width: number; height: number };
}
export type DeltaWorld = World & { riverDeltas?: DeltaRecord[] };
export interface ReviewRecord {
  id: string; name: string; seed: string; family: LandformFamily; style: WorldGenerationStyle;
  width: number; height: number; generationMs: number; deltaCount: number; marshTiles: number;
  compressedWorld: string; compressedBefore: string;
}
export const REVIEW_WORLDS: Pick<ReviewRecord, 'id' | 'name' | 'seed' | 'family' | 'style'>[] = [
  { id: '1', name: 'Alder lowlands', seed: 'ALDER-DELTA', family: 'river-basin', style: 'fractal' },
  { id: '2', name: 'Silver estuaries', seed: 'SILVER-DELTA', family: 'rolling-uplands', style: 'continents' },
  { id: '3', name: 'Reed coast', seed: 'REED-COAST', family: 'dissected-plateau', style: 'fractal' },
  { id: '4', name: 'Bracken mouths', seed: 'BRACKEN-ESTUARY', family: 'folded-range', style: 'continents' },
];
