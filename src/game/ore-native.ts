import { rustEngine } from './rust-engine';
import type { ResourceWorkKind } from './types';

/** Mirror native work rewards; no income is awarded by presentation reads. */
export const oreWorkYield = (resource: ResourceWorkKind, cells: number): number =>
  rustEngine.ore_work_yield(resource === 'copper' ? 1 : resource === 'iron' ? 2 : resource === 'gold' ? 3 : 0, cells);
