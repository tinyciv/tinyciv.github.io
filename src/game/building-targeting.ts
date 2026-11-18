import { BUILDING_KIND_CODES } from './entity-store';
import { rustEngine } from './rust-engine';
import type { Building } from './types';

/** Combat can damage a placed site even while its unfinished footprint is
 * waiting for a builder or temporarily absent from physical occupancy. */
export const buildingTargetable = (building: Building): boolean =>
  !!rustEngine.civic_building_targetable(BUILDING_KIND_CODES[building.kind], building.hp);

/** Control objectives keep their allegiance until troops take them. */
export const buildingFollowsTerritory = (building: Building): boolean =>
  !!rustEngine.civic_building_removable(BUILDING_KIND_CODES[building.kind]);
