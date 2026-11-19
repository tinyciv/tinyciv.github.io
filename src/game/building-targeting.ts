import { BUILDING_KIND_CODES } from './entity-store';
import { rustEngine } from './rust-engine';
import { constructionSiteHidden, type Building } from './types';

/** A visible construction site can be attacked before its footprint becomes solid. */
export const buildingTargetable = (building: Building): boolean =>
  !constructionSiteHidden(building) && !!rustEngine.civic_building_targetable(BUILDING_KIND_CODES[building.kind], building.hp);

/** Control objectives keep their allegiance until troops take them. */
export const buildingFollowsTerritory = (building: Building): boolean =>
  !!rustEngine.civic_building_removable(BUILDING_KIND_CODES[building.kind]);
