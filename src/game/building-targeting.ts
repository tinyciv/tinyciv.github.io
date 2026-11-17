import { rustEngine } from './rust-engine';
import type { Building } from './types';

/** Combat can damage a placed site even while its unfinished footprint is
 * waiting for a builder or temporarily absent from physical occupancy. */
export const buildingTargetable = (building: Building): boolean =>
  !!rustEngine.construction_targetable(building.hp);
